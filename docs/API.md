# Nexus Dev V0.5 — rotas HTTP

API local: `http://127.0.0.1:8000`. Documentação interativa: `/docs`.

As rotas que modificam estado ou iniciam computação (`POST`, `PUT`) exigem o cabeçalho `X-Nexus-Local: 1` e rejeitam `Origin` fora da lista local autorizada. **Isto não substitui autenticação para uso em rede.**

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/api/health` | Estado do servidor e modelos locais |
| POST | `/api/projects` | Importa ZIP de código |
| GET | `/api/projects/{id}/files` | Lista arquivos |
| GET | `/api/projects/{id}/file?path=...` | Lê conteúdo e hash |
| PUT | `/api/projects/{id}/file` | Grava somente com SHA atual |
| GET | `/api/projects/{id}/history?path=...` | Lista backups |
| POST | `/api/projects/{id}/restore` | Restaura revisão com SHA atual |
| GET | `/api/projects/{id}/export` | Exporta arquivos salvos |
| GET | `/api/projects/{id}/search?q=...` | Busca literal limitada |
| GET | `/api/projects/{id}/diagnostics` | Resumo do ZIP importado |
| POST | `/api/chat` | Resposta completa, compatível com V0.3 |
| POST | `/api/chat/stream` | Eventos NDJSON `start`, `delta`, `done` ou `error` |
| POST | `/api/proposals` | Propõe conteúdo completo de um arquivo, sem gravar |
| POST | `/api/tools/run` | Diagnóstico com comando predefinido |

### Streaming

Envie `project_id`, `message`, `selected_files` (0–8), `history`, `model`, `temperature`, `num_ctx` (2048, 4096 ou 8192) e `num_predict` (128–2048). O corpo da resposta tem uma linha JSON por evento.

- `start`: arquivo(s) usados e modelo;
- `delta`: trecho em `text`;
- `done`: `elapsed_ms`, `first_token_ms`, `tokens`, `tokens_per_second`;
- `error`: texto curto sobre a falha.

Erros anteriores à geração são respostas HTTP com `detail`; erros durante o streaming são eventos `error`.

### Propostas

`POST /api/proposals`: `{project_id, path, instruction, expected_sha256, model, temperature}`. Retorna `{path, content, summary, expected_sha256}`. O servidor verifica a versão do arquivo antes e depois da geração e **não escreve conteúdo nenhum**. A confirmação final ocorre na rota de salvar já existente.

### Comandos predefinidos

`POST /api/tools/run` com `{ "command": "python-version" }`. Aceita somente `python-version`, `node-version`, `git-version`, `ollama-ps`. Os comandos são chamados por executável/argumentos fixos, sem shell, com limite de 8 segundos. Não permite executar scripts do usuário.


### Git V0.5

| Método | Rota | Função |
| --- | --- | --- |
| POST | `/api/projects/local` | Clona um repositório local permitido para o workspace isolado |
| GET | `/api/projects/{id}/git/status` | Branch e arquivos modificados |
| POST | `/api/projects/{id}/git/init` | Inicia o Git na cópia importada por ZIP |
| GET | `/api/projects/{id}/git/diff?path=...&staged=false` | Diff de um arquivo permitido |
| POST | `/api/projects/{id}/git/stage` | Prepara um arquivo (`{"path":"src/app.py"}`) |
| POST | `/api/projects/{id}/git/unstage` | Retira um arquivo do stage |
| POST | `/api/projects/{id}/git/stage-all` | Prepara todas as alterações de arquivos permitidos |
| POST | `/api/projects/{id}/git/commit` | Commit de arquivos preparados (`message`, `author`, `email`) |
| GET | `/api/projects/{id}/git/history` | Últimos 15 commits |

O endpoint de importação local só aceita projetos dentro de `NEXUS_PROJECT_ROOT` (padrão: `~/Documents/PROJETOS`). Copia o repositório; não modifica a origem. Não existem operações de push ou shell arbitrário.

### Autocomplete V0.5

`POST /api/completions` com `{project_id, path, prefix, suffix, model}`. O Ollama retorna uma sugestão curta (`{text, model}`). Prefixo limitado a 3500 caracteres e sufixo a 1200; geração limitada a 96 tokens com contexto de 2048 tokens. Nenhum arquivo é salvo nessa operação.
