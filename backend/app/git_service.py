"""Operações Git permitidas no workspace isolado do Nexus."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from fastapi import HTTPException

from . import storage

GIT_TIMEOUT = 15
MAX_OUTPUT = 150_000


def _git(folder: Path, *args: str, timeout: int = GIT_TIMEOUT) -> str:
    binary = shutil.which('git')
    if not binary:
        raise HTTPException(503, 'Git não encontrado no PATH. Instale o Git para Windows.')
    env = os.environ.copy()
    env.update({'GIT_TERMINAL_PROMPT': '0', 'GIT_OPTIONAL_LOCKS': '0', 'GIT_CONFIG_NOSYSTEM': '1'})
    # Não executa hooks nem monitores definidos no repositório importado.
    command = [binary, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + str(storage.ROOT / '.disabled-hooks'),
               '-c', 'credential.helper=', '-C', str(folder), *args]
    try:
        process = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 timeout=timeout, env=env, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(503, 'Não foi possível concluir o comando Git.') from exc
    stdout = process.stdout[:MAX_OUTPUT].decode('utf-8', errors='replace')
    stderr = process.stderr[:1200].decode('utf-8', errors='replace').strip()
    if process.returncode:
        raise HTTPException(409, f'Git: {stderr or stdout[:500] or "operação recusada"}')
    return stdout


def repo_root(project_id: str) -> Path:
    folder = storage.project_dir(project_id)
    if not (folder / '.git').is_dir():
        raise HTTPException(409, 'Este projeto ainda não tem Git. Clique em INICIAR GIT.')
    return folder


def init(project_id: str) -> dict:
    folder = storage.project_dir(project_id)
    if (folder / '.git').exists():
        raise HTTPException(409, 'Git já inicializado neste projeto.')
    _git(folder, 'init', '-b', 'main')
    # Arquivos privados e temporários não entram no repositório por acidente.
    ignore = folder / '.git' / 'info' / 'exclude'
    with ignore.open('a', encoding='utf-8') as output:
        output.write('\nnode_modules/\n.venv/\n.env\n.env.*\ndist/\nbuild/\n__pycache__/\n')
    return status(project_id)


def status(project_id: str) -> dict:
    folder = storage.project_dir(project_id)
    if not (folder / '.git').is_dir():
        return {'initialized': False, 'branch': None, 'changes': []}
    branch = _git(folder, 'branch', '--show-current').strip() or '(HEAD destacado)'
    output = _git(folder, 'status', '--porcelain=v1', '-z', '--untracked-files=all').split('\x00')
    changes = []
    i = 0
    while i < len(output):
        item = output[i]
        i += 1
        if not item or len(item) < 4:
            continue
        code, path = item[:2], item[3:]
        if code[0] in 'RC' or code[1] in 'RC':
            i += 1  # O segundo nome de um rename/copy vem logo depois.
        if storage.safe_name(path) is None:
            continue
        changes.append({'path': path, 'index': code[0], 'worktree': code[1],
                        'staged': code[0] not in (' ', '?')})
    return {'initialized': True, 'branch': branch, 'changes': changes[:storage.MAX_FILES]}


def _checked_path(project_id: str, path: str) -> Path:
    folder = repo_root(project_id)
    if not storage.safe_name(path):
        raise HTTPException(400, 'Caminho inválido para Git.')
    target = (folder / path).resolve()
    if not target.is_relative_to(folder.resolve()):
        raise HTTPException(400, 'Caminho fora do projeto.')
    # Aceita arquivos removidos, mas nunca caminhos arbitrários fora dos itens do status.
    if path not in {c['path'] for c in status(project_id)['changes']}:
        raise HTTPException(404, 'Arquivo não está na lista de alterações do Git.')
    return target


def diff(project_id: str, path: str, staged: bool = False) -> dict:
    folder = repo_root(project_id)
    _checked_path(project_id, path)
    args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color']
    if staged:
        args.append('--cached')
    args.extend(['--', path])
    result = _git(folder, *args)
    if not result and not staged:
        # Arquivos novos ainda não rastreados não aparecem no git diff.
        target = folder / path
        if target.is_file() and target.stat().st_size <= storage.MAX_FILE_BYTES:
            result = '(arquivo novo; prepare o arquivo para visualizar o diff)'
    return {'path': path, 'diff': result[:MAX_OUTPUT], 'staged': staged}


def stage(project_id: str, path: str, add: bool) -> dict:
    folder = repo_root(project_id)
    _checked_path(project_id, path)
    if add:
        # Somente caminhos individuais validados; não usa shell nem 'git add -A'.
        _git(folder, 'add', '--', path)
    else:
        try:
            _git(folder, 'rev-parse', '--verify', '--quiet', 'HEAD')
        except HTTPException:
            _git(folder, 'rm', '--cached', '--ignore-unmatch', '--', path)
        else:
            _git(folder, 'restore', '--staged', '--', path)
    return status(project_id)


def stage_all(project_id: str) -> dict:
    folder = repo_root(project_id)
    paths = [change['path'] for change in status(project_id)['changes'] if not change['staged']]
    # Divide a lista para não atingir o limite de argumentos do Windows.
    for start in range(0, len(paths), 30):
        _git(folder, 'add', '--', *paths[start:start + 30])
    return status(project_id)


def commit(project_id: str, message: str, author: str, email: str) -> dict:
    folder = repo_root(project_id)
    if not (1 <= len(message.strip()) <= 120) or '\n' in message or '\r' in message:
        raise HTTPException(422, 'Mensagem do commit deve ter até 120 caracteres e uma linha.')
    if not (1 <= len(author.strip()) <= 100) or any(c in author for c in '\r\n<>'):
        raise HTTPException(422, 'Informe um nome de autor válido.')
    if not re.fullmatch(r'[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+', email):
        raise HTTPException(422, 'Informe um e-mail de autor válido.')
    if not any(change['staged'] for change in status(project_id)['changes']):
        raise HTTPException(409, 'Prepare pelo menos um arquivo antes do commit.')
    # Define o autor só nesta execução, sem mudar a configuração global do Git.
    _git(folder, '-c', f'user.name={author.strip()}', '-c', f'user.email={email}',
         'commit', '-m', message.strip(), '--no-verify', timeout=25)
    return status(project_id)


def history(project_id: str) -> dict:
    folder = repo_root(project_id)
    # Repositórios sem commits ainda não têm histórico.
    if not (folder / '.git' / 'HEAD').exists():
        return {'commits': []}
    try:
        out = _git(folder, 'log', '-15', '--date=short', '--format=%h%x09%ad%x09%s')
    except HTTPException:
        return {'commits': []}
    return {'commits': [{'hash': c[0], 'date': c[1], 'message': c[2]} for line in out.splitlines()
                        if (c := line.split('\t', 2)) and len(c) == 3]}
