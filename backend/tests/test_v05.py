"""Git e autocomplete com operações reais no workspace de teste."""
import io
import subprocess
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import main, storage, local_import


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, 'WORKSPACE', tmp_path / 'workspace')
    monkeypatch.setattr(storage, 'BACKUPS', tmp_path / 'backups')
    monkeypatch.setattr(local_import, 'PROJECT_ROOT', tmp_path / 'projetos')
    storage.WORKSPACE.mkdir()
    storage.BACKUPS.mkdir()
    local_import.PROJECT_ROOT.mkdir()
    return TestClient(main.app)


def imported(client):
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, 'w') as archive:
        archive.writestr('src/main.py', "print('v1')\n")
        archive.writestr('README.md', '# Projeto')
    response = client.post('/api/projects', files={'file': ('p.zip', memory.getvalue())}, headers={'X-Nexus-Local': '1'})
    assert response.status_code == 200
    return response.json()['project_id']


def test_git_init_stage_commit_and_diff(client):
    project = imported(client)
    url = f'/api/projects/{project}/git'
    headers = {'X-Nexus-Local': '1'}
    assert client.get(url + '/status').json()['initialized'] is False
    initialized = client.post(url + '/init', headers=headers)
    assert initialized.status_code == 200, initialized.text
    assert initialized.json()['branch'] == 'main'
    assert any(x['path'] == 'src/main.py' for x in initialized.json()['changes'])
    stage = client.post(url + '/stage', headers=headers, json={'path': 'src/main.py'})
    assert stage.status_code == 200, stage.text
    assert any(x['staged'] for x in stage.json()['changes'])
    diff = client.get(url + '/diff', params={'path': 'src/main.py', 'staged': True})
    assert '+print' in diff.json()['diff']
    commit = client.post(url + '/commit', headers=headers, json={
        'message': 'Primeiro commit', 'author': 'Dev Teste', 'email': 'dev@example.org',
    })
    assert commit.status_code == 200, commit.text
    history = client.get(url + '/history').json()['commits']
    assert history[0]['message'] == 'Primeiro commit'
    old = client.get(f'/api/projects/{project}/file', params={'path': 'src/main.py'}).json()
    saved = client.put(f'/api/projects/{project}/file', headers=headers, json={
        'path': 'src/main.py', 'expected_sha256': old['sha256'], 'content': "print('v2')\n",
    })
    assert saved.status_code == 200
    changed = client.get(url + '/status').json()['changes']
    assert any(c['path'] == 'src/main.py' and c['worktree'] == 'M' for c in changed)
    assert '-print' in client.get(url + '/diff', params={'path': 'src/main.py'}).json()['diff']
    unstage = client.post(url + '/unstage', headers=headers, json={'path': 'src/main.py'})
    assert unstage.status_code == 200  # Sem itens no index, deve ser inofensivo.


def test_git_initial_unstage_and_path_guards(client):
    project = imported(client)
    url = f'/api/projects/{project}/git'
    headers = {'X-Nexus-Local': '1'}
    client.post(url + '/init', headers=headers)
    assert client.post(url + '/stage', headers=headers, json={'path': 'src/main.py'}).status_code == 200
    assert client.post(url + '/unstage', headers=headers, json={'path': 'src/main.py'}).status_code == 200
    assert client.post(url + '/stage', headers=headers, json={'path': '../secrets.py'}).status_code in (400, 404)
    assert client.post(url + '/commit', headers=headers, json={
        'message': 'Sem stage', 'author': 'X', 'email': 'dev@example.org',
    }).status_code == 409
    assert client.post(url + '/stage', json={'path': 'src/main.py'}).status_code == 403


def test_local_repository_is_copied_not_modified(client):
    source = local_import.PROJECT_ROOT / 'app'
    source.mkdir()
    subprocess.run(['git', 'init', '-b', 'main', str(source)], check=True, capture_output=True)
    (source / 'main.py').write_text("print('original')\n", encoding='utf-8')
    subprocess.run(['git', '-C', str(source), 'add', 'main.py'], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(source), '-c', 'user.name=Teste', '-c', 'user.email=teste@example.org',
                    'commit', '-m', 'Base'], check=True, capture_output=True)
    (source / 'main.py').write_text("print('alterado')\n", encoding='utf-8')
    response = client.post('/api/projects/local', headers={'X-Nexus-Local': '1'}, json={'path': str(source)})
    assert response.status_code == 200, response.text
    project = response.json()['project_id']
    assert client.get(f'/api/projects/{project}/git/history').json()['commits'][0]['message'] == 'Base'
    assert client.get(f'/api/projects/{project}/file', params={'path': 'main.py'}).json()['content'] == "print('alterado')\n"
    assert (source / 'main.py').read_text() == "print('alterado')\n"
    assert client.post('/api/projects/local', headers={'X-Nexus-Local': '1'},
                       json={'path': str(storage.WORKSPACE)}).status_code == 403


def test_completion_no_write(client, monkeypatch):
    project = imported(client)

    async def models():
        return ['qwen2.5-coder:1.5b']
    monkeypatch.setattr(main, 'local_models', models)

    class Response:
        def raise_for_status(self): pass
        def json(self): return {'response': "    return sum(values) / len(values)"}

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): return Response()

    monkeypatch.setattr(main.httpx, 'AsyncClient', FakeClient)
    payload = {'project_id': project, 'path': 'src/main.py', 'prefix': 'def media(values):\n',
               'suffix': '\n', 'model': 'qwen2.5-coder:1.5b'}
    response = client.post('/api/completions', json=payload, headers={'X-Nexus-Local': '1'})
    assert response.status_code == 200, response.text
    assert 'return sum' in response.json()['text']
    assert client.get(f'/api/projects/{project}/file', params={'path': 'src/main.py'}).json()['content'] == "print('v1')\n"
    assert client.post('/api/completions', json={**payload, 'model': 'fake'},
                       headers={'X-Nexus-Local': '1'}).status_code == 400


def test_stage_all_safely_ignores_private_files(client):
    project = imported(client)
    url = f'/api/projects/{project}/git'
    headers = {'X-Nexus-Local': '1'}
    client.post(url + '/init', headers=headers)
    workspace = storage.project_dir(project)
    (workspace / '.env').write_text('SECRET=hidden', encoding='utf-8')
    result = client.post(url + '/stage-all', headers=headers)
    assert result.status_code == 200, result.text
    assert any(c['path'] == 'README.md' and c['staged'] for c in result.json()['changes'])
    assert '.env' not in [c['path'] for c in result.json()['changes']]
