"""Abre uma cópia isolada de um repositório Git local, preservando seu histórico."""
from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException

from . import git_service, storage

# Fora desta pasta, caminhos enviados pelo navegador nunca são aceitos.
PROJECT_ROOT = Path(os.getenv('NEXUS_PROJECT_ROOT', str(Path.home() / 'Documents' / 'PROJETOS')))
MAX_GIT_BYTES = 100 * 1024 * 1024


def open_local(source_path: str) -> tuple[str, list[str]]:
    allowed = PROJECT_ROOT.resolve()
    source = Path(source_path).expanduser().resolve()
    if source == allowed or not source.is_relative_to(allowed) or not source.is_dir():
        raise HTTPException(403, f'Selecione um repositório dentro de {allowed}')
    if storage.WORKSPACE.resolve().is_relative_to(source):
        raise HTTPException(400, 'Não é possível importar uma pasta que contém o workspace do Nexus.')
    if not (source / '.git').is_dir():
        raise HTTPException(400, 'A pasta selecionada não contém um repositório .git comum.')
    meta_bytes = 0
    for file in (source / '.git').rglob('*'):
        if file.is_symlink():
            raise HTTPException(400, 'Repositórios com links simbólicos no .git não são aceitos.')
        if file.is_file():
            meta_bytes += file.stat().st_size
            if meta_bytes > MAX_GIT_BYTES:
                raise HTTPException(413, 'Histórico Git maior que 100 MB. Use um ZIP para esse projeto.')
    project_id = uuid.uuid4().hex
    destination = storage.WORKSPACE / project_id
    total = 0
    count = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        git_service._git(destination.parent, 'clone', '--no-local', '--no-checkout', '--', str(source), str(destination), timeout=60)
        # Monta a árvore a partir dos arquivos atuais sem executar código do projeto.
        for current, dirs, names in os.walk(source, followlinks=False):
            # Não percorre node_modules, .git, ambientes virtuais ou pastas vinculadas.
            dirs[:] = [name for name in dirs if name.lower() not in storage.SKIP_DIRS
                       and not (Path(current) / name).is_symlink()]
            for filename in names:
                file = Path(current) / filename
                if file.is_symlink() or not file.is_file():
                    continue
                relative = file.relative_to(source).as_posix()
                if storage.safe_name(relative) is None:
                    continue
                size = file.stat().st_size
                if size > storage.MAX_FILE_BYTES:
                    continue
                count += 1
                total += size
                if count > storage.MAX_FILES or total > storage.MAX_PROJECT_BYTES:
                    raise HTTPException(413, 'Projeto local excede o limite de 800 arquivos ou 60 MB de código.')
                dest_file = destination / relative
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(file, dest_file)
        files = storage.list_files(destination)
        if not files:
            raise HTTPException(400, 'Não foram encontrados arquivos de código compatíveis.')
        return project_id, files
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise
