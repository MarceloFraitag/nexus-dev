"""Importação, leitura e versões de arquivos do workspace local."""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import stat
import tempfile
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / "workspace"
BACKUPS = ROOT / "backups"
WORKSPACE.mkdir(exist_ok=True)
BACKUPS.mkdir(exist_ok=True)

MAX_ZIP_BYTES = 25 * 1024 * 1024
MAX_PROJECT_BYTES = 60 * 1024 * 1024
MAX_FILES = 800
MAX_FILE_BYTES = 200_000
MAX_REVISIONS = 20
ALLOWED = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".scss",
    ".json", ".md", ".go", ".sql", ".java", ".cs", ".c", ".cpp",
    ".h", ".rs", ".php", ".rb", ".sh", ".ps1", ".yaml", ".yml",
    ".toml", ".xml", ".txt", ".vue", ".svelte", ".dart", ".kt",
}
SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", ".next", "venv", ".venv",
    "__pycache__", "coverage", "target", ".idea", ".vscode", "__macosx",
}
PRIVATE_NAMES = {
    ".env", ".npmrc", ".pypirc", "id_rsa", "id_ed25519", "credentials.json",
    "secrets.json", "config.json.secret", "known_hosts", "authorized_keys",
}
_lock = threading.RLock()


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def safe_name(name: str) -> PurePosixPath | None:
    # Não aceita caminhos que possam escapar da pasta do projeto.
    if not name or name.startswith(("/", "\\")) or "\\" in name or "\x00" in name:
        return None
    if re.match(r"^[a-zA-Z]:", name):
        return None
    # Também evita nomes que falhariam ao extrair no Windows.
    if len(name) > 240 or any(char in name for char in '<>:"|?*'):
        return None
    path = PurePosixPath(name)
    for part in path.parts:
        base = part.split('.')[0].upper()
        if len(part) > 120 or part.endswith((' ', '.')) or base in {'CON', 'PRN', 'AUX', 'NUL'} or re.fullmatch(r'(COM|LPT)[1-9]', base):
            return None
    if any(p in ("", ".", "..") for p in name.split("/")):
        return None
    if any(part.lower() in SKIP_DIRS for part in path.parts):
        return None
    if path.name.lower() in PRIVATE_NAMES or any(p.lower().startswith(".env") for p in path.parts):
        return None
    if path.suffix.lower() not in ALLOWED:
        return None
    return path


def project_dir(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", project_id):
        raise HTTPException(400, "Identificador de projeto inválido")
    folder = WORKSPACE / project_id
    if not folder.is_dir():
        raise HTTPException(404, "Projeto não encontrado")
    return folder


def target_file(project_id: str, name: str) -> Path:
    root = project_dir(project_id)
    path = safe_name(name)
    if path is None:
        raise HTTPException(400, "Caminho de arquivo inválido")
    target = (root / str(path)).resolve()
    if not target.is_relative_to(root.resolve()) or not target.is_file():
        raise HTTPException(404, "Arquivo não encontrado")
    return target


def list_files(folder: Path) -> list[str]:
    found = []
    for file in folder.rglob("*"):
        if file.is_file() and not file.is_symlink():
            name = file.relative_to(folder).as_posix()
            if safe_name(name) and file.stat().st_size <= MAX_FILE_BYTES:
                found.append(name)
    return sorted(found)[:MAX_FILES]


def unpack_project(data: bytes) -> tuple[str, list[str]]:
    if len(data) > MAX_ZIP_BYTES:
        raise HTTPException(413, "ZIP acima do limite de 25 MB")
    project_id = uuid.uuid4().hex
    folder = WORKSPACE / project_id
    folder.mkdir()
    total = 0
    completed = False
    seen: set[str] = set()
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_FILES:
                raise HTTPException(413, "ZIP com entradas demais (máximo 800)")
            for info in entries:
                name = safe_name(info.filename)
                if info.is_dir() or name is None:
                    continue
                # Ignora links simbólicos e outros tipos especiais do ZIP.
                kind = (info.external_attr >> 16) & 0o170000
                if kind not in (0, stat.S_IFREG):
                    continue
                key = str(name).lower()
                if key in seen:
                    raise HTTPException(400, "ZIP contém arquivos com nomes repetidos")
                seen.add(key)
                if info.file_size > MAX_FILE_BYTES:
                    continue
                total += info.file_size
                if total > MAX_PROJECT_BYTES:
                    raise HTTPException(413, "Arquivos descompactados excedem 60 MB")
                target = folder / str(name)
                target.parent.mkdir(parents=True, exist_ok=True)
                # Copia com limite real, mesmo se o tamanho informado no ZIP estiver errado.
                with archive.open(info) as source, target.open("wb") as output:
                    content = source.read(MAX_FILE_BYTES + 1)
                    if len(content) > MAX_FILE_BYTES:
                        raise HTTPException(413, f"Arquivo muito grande: {name}")
                    if b"\x00" in content[:4096]:
                        target.unlink()
                        continue
                    output.write(content)
        names = list_files(folder)
        if not names:
            raise HTTPException(400, "O ZIP não tem arquivos de código compatíveis")
        completed = True
        return project_id, names
    except (zipfile.BadZipFile, OSError, RuntimeError, EOFError) as exc:
        raise HTTPException(400, "ZIP inválido ou danificado") from exc
    finally:
        if not completed:
            shutil.rmtree(folder, ignore_errors=True)


def read_content(project_id: str, name: str) -> dict:
    target = target_file(project_id, name)
    data = target.read_bytes()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "Arquivo acima do limite do editor")
    return {"path": name, "content": data.decode("utf-8", errors="replace"), "sha256": digest(data)}


def _history_file(project_id: str) -> Path:
    return BACKUPS / project_id / "index.json"


def history(project_id: str, path: str) -> list[dict]:
    target_file(project_id, path)
    file = _history_file(project_id)
    records = json.loads(file.read_text(encoding="utf-8")) if file.exists() else []
    return [record for record in records if record["path"] == path]


def write_content(project_id: str, path: str, content: str, expected: str) -> dict:
    payload = content.encode("utf-8")
    if len(payload) > MAX_FILE_BYTES:
        raise HTTPException(413, "O arquivo não pode ultrapassar 200 KB")
    with _lock:
        target = target_file(project_id, path)
        old = target.read_bytes()
        if digest(old) != expected:
            raise HTTPException(409, "O arquivo foi alterado. Reabra antes de salvar.")
        if old == payload:
            return {**read_content(project_id, path), "saved": False}
        backup_dir = BACKUPS / project_id
        backup_dir.mkdir(parents=True, exist_ok=True)
        revision = uuid.uuid4().hex
        (backup_dir / f"{revision}.bak").write_bytes(old)
        index = _history_file(project_id)
        records = json.loads(index.read_text(encoding="utf-8")) if index.exists() else []
        records.insert(0, {
            "id": revision, "path": path, "timestamp": datetime.now(timezone.utc).isoformat(),
            "sha256": digest(old), "bytes": len(old),
        })
        # Guarda as últimas versões e remove backups antigos sem mexer no arquivo atual.
        matching = [r for r in records if r["path"] == path]
        for stale in matching[MAX_REVISIONS:]:
            (backup_dir / f"{stale['id']}.bak").unlink(missing_ok=True)
            records.remove(stale)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as temp:
            temporary = Path(temp.name)
            temp.write(payload)
        try:
            os.replace(temporary, target)
            index.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
        finally:
            temporary.unlink(missing_ok=True)
        return {**read_content(project_id, path), "saved": True, "revision": revision}


def restore_revision(project_id: str, path: str, revision: str, expected: str) -> dict:
    if not re.fullmatch(r"[a-f0-9]{32}", revision):
        raise HTTPException(400, "Versão inválida")
    revisions = history(project_id, path)
    if not any(record["id"] == revision for record in revisions):
        raise HTTPException(404, "Versão não encontrada")
    content = (BACKUPS / project_id / f"{revision}.bak").read_bytes().decode("utf-8")
    return write_content(project_id, path, content, expected)
