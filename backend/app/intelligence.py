"""Busca local e seleção dos arquivos mais úteis para cada pergunta."""
from __future__ import annotations

import re
from pathlib import Path

from . import storage

STOP_WORDS = {
    "para", "como", "com", "que", "uma", "das", "dos", "isso", "esse", "essa",
    "onde", "qual", "quando", "quero", "pode", "fazer", "arquivo", "arquivos",
    "projeto", "codigo", "código", "sobre", "este", "esta", "the", "and", "for",
    "from", "what", "there", "mais", "less", "meu", "minha", "neste",
}


def terms(question: str) -> list[str]:
    words = re.findall(r"[\w.-]{3,}", question.lower(), flags=re.UNICODE)
    return list(dict.fromkeys(word for word in words if word not in STOP_WORDS))[:24]


def search(folder: Path, query: str, limit: int = 45) -> list[dict]:
    """Busca literal sem executar código, com limite por arquivo e por resultado."""
    query = query.strip().casefold()
    if len(query) < 2 or len(query) > 120:
        return []
    matches = []
    for path in storage.list_files(folder):
        if len(matches) >= limit:
            break
        file = folder / path
        if query in path.casefold():
            matches.append({"path": path, "line": 0, "snippet": "Nome do arquivo"})
        lines = file.read_bytes()[:64_000].decode("utf-8", errors="replace").splitlines()
        for number, line in enumerate(lines, start=1):
            if len(matches) >= limit:
                break
            if query in line.casefold():
                matches.append({"path": path, "line": number, "snippet": line.strip()[:180]})
    return matches


def pick_files(project_id: str, message: str, selected: list[str], max_chars: int = 18_000) -> tuple[list[str], str]:
    """Prioriza a seleção do usuário; sem seleção, ranqueia por nomes e conteúdo."""
    folder = storage.project_dir(project_id)
    paths = storage.list_files(folder)
    chosen = list(dict.fromkeys(path for path in selected if path in paths))[:8]
    if not chosen:
        keywords = terms(message)
        scores = []
        for path in paths:
            lowercase = path.casefold()
            score = sum(6 for word in keywords if word in lowercase)
            basename = Path(path).name.lower()
            if basename in {"readme.md", "package.json", "pyproject.toml", "requirements.txt"}:
                score += 1
            if keywords:
                sample = (folder / path).read_bytes()[:12_000].decode("utf-8", errors="replace").casefold()
                score += 4 * sum(min(sample.count(word), 4) for word in keywords)
            scores.append((score, path))
        scores.sort(key=lambda pair: (-pair[0], len(pair[1]), pair[1]))
        chosen = [path for _, path in scores[:5]]

    fragments = []
    included = []
    remaining = max_chars
    for path in chosen:
        if remaining < 300:
            break
        content = storage.read_content(project_id, path)["content"]
        excerpt = content[:min(remaining, 6000)]
        fragments.append(f"<arquivo caminho={path!r}>\n{excerpt}\n</arquivo>")
        included.append(path)
        remaining -= len(excerpt)
    return included, "\n\n".join(fragments)
