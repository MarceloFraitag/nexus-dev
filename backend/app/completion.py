"""Sugestões pequenas de código para o Monaco, sem gravar arquivos."""
from __future__ import annotations

import asyncio
import re

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field

from . import storage

DEFAULT_COMPLETION_MODEL = 'qwen2.5-coder:1.5b'
_single_generation = asyncio.Semaphore(1)


class CompletionRequest(BaseModel):
    project_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    path: str = Field(min_length=1, max_length=500)
    prefix: str = Field(min_length=1, max_length=3500)
    suffix: str = Field(default='', max_length=1200)
    model: str = Field(default=DEFAULT_COMPLETION_MODEL, min_length=1, max_length=120)


def clean_suggestion(text: str, prefix: str) -> str:
    """Remove cercas Markdown e trechos que já foram digitados."""
    text = re.sub(r'^```[^\n]*\n|\n?```\s*$', '', text.strip('\r\n'))
    if text.startswith(prefix[-100:]) and prefix[-100:]:
        text = text[len(prefix[-100:]):]
    # Nunca aceita instruções de outra conversa como trecho de código.
    if '```' in text or '\x00' in text:
        return ''
    return text[:1200]


async def generate(data: CompletionRequest, ollama_url: str, available_models: list[str]) -> dict:
    storage.target_file(data.project_id, data.path)
    if data.model not in available_models:
        raise HTTPException(400, f'Modelo {data.model} não instalado. Execute: ollama pull {data.model}')
    if _single_generation.locked():
        raise HTTPException(429, 'Autocomplete ocupado. Tente novamente em instantes.')
    prompt = (
        'Complete o código exatamente a partir do cursor. Escreva SOMENTE o código novo, '
        'sem Markdown, explicações ou repetição das linhas anteriores. '
        'Prefira uma continuação curta, de até 4 linhas.\n'
        f'Arquivo: {data.path}\n'
        '<antes_do_cursor>\n' + data.prefix[-3000:] + '\n</antes_do_cursor>\n'
        '<depois_do_cursor>\n' + data.suffix[:850] + '\n</depois_do_cursor>\n'
        'Continuação exata no cursor:\n'
    )
    async with _single_generation:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=4.0)) as client:
                response = await client.post(f'{ollama_url}/api/generate', json={
                    'model': data.model, 'prompt': prompt, 'stream': False,
                    'options': {'temperature': 0.1, 'num_ctx': 2048, 'num_predict': 96,
                                'stop': ['```', '</depois_do_cursor>', '</antes_do_cursor>']},
                    'keep_alive': '2m',
                })
                response.raise_for_status()
                suggestion = clean_suggestion(str(response.json().get('response', '')), data.prefix)
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(502, 'O Ollama não conseguiu gerar o autocomplete.') from exc
    return {'text': suggestion, 'model': data.model}
