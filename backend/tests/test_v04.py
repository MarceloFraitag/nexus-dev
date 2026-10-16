"""Verifica busca, contexto, streaming, propostas e diagnóstico."""
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import intelligence, main, storage


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "WORKSPACE", tmp_path / "workspace")
    monkeypatch.setattr(storage, "BACKUPS", tmp_path / "backups")
    storage.WORKSPACE.mkdir()
    storage.BACKUPS.mkdir()
    return TestClient(main.app)


def imported(client, files):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as container:
        for name, content in files.items():
            container.writestr(name, content)
    response = client.post("/api/projects", files={"file": ("code.zip", archive.getvalue())}, headers={"X-Nexus-Local": "1"})
    assert response.status_code == 200
    return response.json()["project_id"]


def test_search_and_diagnostics(client):
    project = imported(client, {"src/login.py": "def login():\n    print('login')\n", "doc.md": "# Project"})
    hits = client.get(f"/api/projects/{project}/search", params={"q": "login"}).json()["results"]
    assert any(hit["path"] == "src/login.py" and hit["line"] == 1 for hit in hits)
    assert client.get(f"/api/projects/{project}/search", params={"q": "a"}).json()["results"] == []
    summary = client.get(f"/api/projects/{project}/diagnostics").json()
    assert summary["files"] == 2
    assert summary["languages"][".py"] == 1
    assert summary["git_available"] is False


def test_context_prioritizes_related_files(client):
    project = imported(client, {"src/auth.py": "def login(): pass", "lib/math.py": "add = 2", "README.md": "# Docs"})
    included, text = intelligence.pick_files(project, "Corrija o login da autenticação", [])
    assert included[0] == "src/auth.py"
    assert "def login" in text
    manual, _ = intelligence.pick_files(project, "login", ["lib/math.py", "missing.py"])
    assert manual == ["lib/math.py"]


def test_streaming_protocol(client, monkeypatch):
    project = imported(client, {"main.py": "print('ok')"})
    async def models():
        return ["qwen2.5-coder:7b"]
    monkeypatch.setattr(main, "local_models", models)
    seen = {}

    class Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        def raise_for_status(self): pass
        async def aiter_lines(self):
            yield json.dumps({"message": {"content": "Olá "}, "done": False})
            yield json.dumps({"message": {"content": "mundo"}, "done": False})
            yield json.dumps({"done": True, "eval_count": 10, "eval_duration": 1_000_000_000})

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        def stream(self, method, url, json):
            seen.update(json)
            return Stream()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = client.post("/api/chat/stream", headers={"X-Nexus-Local": "1"}, json={
        "project_id": project, "message": "Explique o código", "num_ctx": 2048,
    })
    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [item["type"] for item in events] == ["start", "delta", "delta", "done"]
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Olá mundo"
    assert events[-1]["tokens_per_second"] == 10.0
    assert seen["options"]["num_ctx"] == 2048
    assert seen["keep_alive"] == "15m"
    assert seen["stream"] is True


def test_proposal_requires_review_and_does_not_change_file(client, monkeypatch):
    project = imported(client, {"app.py": "print('before')"})
    original = client.get(f"/api/projects/{project}/file", params={"path": "app.py"}).json()

    async def models(): return ["qwen2.5-coder:7b"]
    monkeypatch.setattr(main, "local_models", models)

    class Response:
        def raise_for_status(self): pass
        def json(self): return {"message": {"content": json.dumps({"content": "print('after')", "summary": "Texto sugerido"})}}

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def post(self, url, json): return Response()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    result = client.post("/api/proposals", headers={"X-Nexus-Local": "1"}, json={
        "project_id": project, "path": "app.py", "instruction": "Altere a mensagem para after",
        "expected_sha256": original["sha256"],
    })
    assert result.status_code == 200
    assert result.json()["content"] == "print('after')"
    still_original = client.get(f"/api/projects/{project}/file", params={"path": "app.py"}).json()
    assert still_original == original
    conflict = client.post("/api/proposals", headers={"X-Nexus-Local": "1"}, json={
        "project_id": project, "path": "app.py", "instruction": "Altere esta mensagem",
        "expected_sha256": "0" * 64,
    })
    assert conflict.status_code == 409


def test_safe_tools_are_explicitly_limited(client):
    response = client.post('/api/tools/run', headers={'X-Nexus-Local': '1'}, json={'command': 'python-version'})
    assert response.status_code == 200
    assert 'Python' in response.json()['output']
    arbitrary = client.post('/api/tools/run', headers={'X-Nexus-Local': '1'}, json={'command': 'rm -rf /'})
    assert arbitrary.status_code == 422
    unauthorized = client.post('/api/tools/run', json={'command': 'python-version'})
    assert unauthorized.status_code == 403
