"""Testes de importação, edição, segurança e histórico."""
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import main, storage


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "WORKSPACE", tmp_path / "workspace")
    monkeypatch.setattr(storage, "BACKUPS", tmp_path / "backups")
    storage.WORKSPACE.mkdir()
    storage.BACKUPS.mkdir()
    return TestClient(main.app)


def zip_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return stream.getvalue()


def import_zip(client, files):
    response = client.post("/api/projects", files={"file": ("project.zip", zip_bytes(files), "application/zip")}, headers={"X-Nexus-Local": "1"})
    return response


def test_import_read_save_restore(client):
    uploaded = import_zip(client, {"src/app.py": "print('ok')\n", "readme.md": "# A"})
    assert uploaded.status_code == 200
    project = uploaded.json()["project_id"]
    assert uploaded.json()["files"] == ["readme.md", "src/app.py"]
    original = client.get(f"/api/projects/{project}/file", params={"path": "src/app.py"}).json()
    response = client.put(f"/api/projects/{project}/file", headers={"X-Nexus-Local": "1"}, json={
        "path": "src/app.py", "content": "print('novo')\n", "expected_sha256": original["sha256"]
    })
    assert response.status_code == 200
    assert response.json()["saved"]
    assert client.get(f"/api/projects/{project}/file", params={"path": "src/app.py"}).json()["content"] == "print('novo')\n"
    records = client.get(f"/api/projects/{project}/history", params={"path": "src/app.py"}).json()["revisions"]
    assert len(records) == 1
    restored = client.post(f"/api/projects/{project}/restore", headers={"X-Nexus-Local": "1"}, json={
        "path": "src/app.py", "revision": records[0]["id"], "expected_sha256": response.json()["sha256"],
    })
    assert restored.status_code == 200
    assert restored.json()["content"] == original["content"]


def test_rejects_stale_hash_and_path_traversal(client):
    project = import_zip(client, {"src/app.py": "hey"}).json()["project_id"]
    headers = {"X-Nexus-Local": "1"}
    stale = client.put(f"/api/projects/{project}/file", headers=headers, json={
        "path": "src/app.py", "content": "changed", "expected_sha256": "0" * 64,
    })
    assert stale.status_code == 409
    outside = client.get(f"/api/projects/{project}/file", params={"path": "../outside.py"})
    assert outside.status_code in (400, 404)
    outside = client.get(f"/api/projects/{project}/file", params={"path": "src/../../outside.py"})
    assert outside.status_code in (400, 404)


def test_rejects_cross_site_writes(client):
    no_header = client.post("/api/projects", files={"file": ("project.zip", zip_bytes({"a.py": "ok"}), "application/zip")})
    assert no_header.status_code == 403
    external = client.post("/api/projects", headers={"X-Nexus-Local": "1", "Origin": "https://site-externo.example"}, files={"file": ("project.zip", zip_bytes({"a.py": "ok"}), "application/zip")})
    assert external.status_code == 403


def test_filters_sensitive_files_and_skips_large_files(client):
    project = import_zip(client, {".env": "password=secret", "node_modules/pkg/index.js": "ignore", "main.py": "ok", "huge.py": "a" * 200_001})
    assert project.status_code == 200
    assert project.json()["files"] == ["main.py"]


def test_import_rejects_duplicate_names(client):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("a.py", "foo")
        archive.writestr("a.py", "bar")
    response = client.post("/api/projects", files={"file": ("x.zip", stream.getvalue(), "application/zip")}, headers={"X-Nexus-Local": "1"})
    assert response.status_code == 400


def test_health_when_ollama_is_offline(client, monkeypatch):
    async def no_models():
        raise __import__("httpx").ConnectError("offline")
    monkeypatch.setattr(main, "local_models", no_models)
    result = client.get("/api/health")
    assert result.status_code == 200
    assert result.json()["ollama_connected"] is False


def test_export_contains_saved_changes(client):
    project = import_zip(client, {"code.py": "before"}).json()["project_id"]
    original = client.get(f"/api/projects/{project}/file", params={"path": "code.py"}).json()
    client.put(f"/api/projects/{project}/file", headers={"X-Nexus-Local": "1"}, json={
        "path": "code.py", "content": "after", "expected_sha256": original["sha256"],
    })
    exported = client.get(f"/api/projects/{project}/export")
    assert exported.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert archive.namelist() == ["code.py"]
        assert archive.read("code.py") == b"after"


def test_chat_uses_selected_files_and_history(client, monkeypatch):
    project = import_zip(client, {"main.py": "print('main')", "other.py": "print('other')"}).json()["project_id"]
    async def models():
        return ["qwen2.5-coder:7b"]
    class MockResponse:
        def raise_for_status(self):
            pass
        def json(self):
            return {"message": {"content": "Sugestão de melhoria."}}
    received = {}
    class MockHttpx:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, url, json):
            received.update(json)
            return MockResponse()
    monkeypatch.setattr(main, "local_models", models)
    monkeypatch.setattr(main.httpx, "AsyncClient", MockHttpx)
    result = client.post("/api/chat", headers={"X-Nexus-Local": "1"}, json={
        "project_id": project, "message": "Analise este código",
        "selected_files": ["other.py", "missing.py"],
        "history": [{"role": "user", "content": "Contexto anterior"}],
    })
    assert result.status_code == 200
    assert result.json()["files_used"] == ["other.py"]
    assert "print('other')" in received["messages"][-1]["content"]
    assert "print('main')" not in received["messages"][-1]["content"]
    assert received["messages"][1]["content"] == "Contexto anterior"
