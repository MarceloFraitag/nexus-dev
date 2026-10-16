import type { Health, Message, Revision } from './types';

const API = 'http://127.0.0.1:8000';
const editHeaders = { 'Content-Type': 'application/json', 'X-Nexus-Local': '1' };

// Todas as requisições usam o mesmo tratamento de erro.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init);
  let result: { detail?: string } & T;
  try { result = await response.json(); }
  catch { throw new Error('Resposta inválida do servidor'); }
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `Erro HTTP ${response.status}`);
  return result;
}

export type ChatPayload = {
  project_id: string; message: string; selected_files: string[];
  history: { role: Message['role']; content: string }[];
  model: string; temperature: number; num_ctx: 2048 | 4096 | 8192; num_predict: number;
};

export type ChatEvent =
  | { type: 'start'; files_used: string[]; model: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; elapsed_ms: number; first_token_ms: number | null; tokens: number; tokens_per_second: number | null }
  | { type: 'error'; message: string };

// Cada linha NDJSON chega enquanto o Ollama ainda está escrevendo.
export async function streamChat(body: ChatPayload, signal: AbortSignal, onEvent: (event: ChatEvent) => void): Promise<void> {
  const response = await fetch(`${API}/api/chat/stream`, {
    method: 'POST', headers: editHeaders, body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(typeof result.detail === 'string' ? result.detail : `Erro HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('O navegador não conseguiu receber a resposta progressiva');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ChatEvent;
        if (event.type === 'error') throw new Error(event.message);
        onEvent(event);
        if (event.type === 'done') completed = true;
      }
    }
    if (!completed) throw new Error('A transmissão terminou antes da resposta ficar pronta');
  } finally {
    reader.releaseLock();
  }
}

export type SearchHit = { path: string; line: number; snippet: string };
export type Diagnostics = { files: number; total_bytes: number; languages: Record<string, number>; git_available: boolean; note: string };
export type Proposal = { path: string; content: string; summary: string; expected_sha256: string };

export type ToolCommand = 'python-version' | 'node-version' | 'git-version' | 'ollama-ps';
export type ToolResult = { command: ToolCommand; exit_code: number; output: string };

export type GitChange = { path: string; index: string; worktree: string; staged: boolean };
export type GitStatus = { initialized: boolean; branch: string | null; changes: GitChange[] };
export type GitCommitInfo = { hash: string; date: string; message: string };
export type CompletionBody = { project_id: string; path: string; prefix: string; suffix: string; model: string };

export const api = {
  completion: (body: CompletionBody, signal: AbortSignal) =>
    request<{ text: string; model: string }>('/api/completions', {
      method: 'POST', headers: editHeaders, body: JSON.stringify(body), signal,
    }),
  gitStatus: (id: string) => request<GitStatus>(`/api/projects/${id}/git/status`),
  gitInit: (id: string) => request<GitStatus>(`/api/projects/${id}/git/init`, { method: 'POST', headers: editHeaders }),
  gitDiff: (id: string, path: string, staged: boolean) => request<{ path: string; diff: string; staged: boolean }>(
    `/api/projects/${id}/git/diff?path=${encodeURIComponent(path)}&staged=${staged}`),
  gitStage: (id: string, path: string, add: boolean) => request<GitStatus>(
    `/api/projects/${id}/git/${add ? 'stage' : 'unstage'}`, { method: 'POST', headers: editHeaders, body: JSON.stringify({ path }) }),
  gitStageAll: (id: string) => request<GitStatus>(`/api/projects/${id}/git/stage-all`, {
    method: 'POST', headers: editHeaders,
  }),
  gitCommit: (id: string, message: string, author: string, email: string) => request<GitStatus>(
    `/api/projects/${id}/git/commit`, { method: 'POST', headers: editHeaders, body: JSON.stringify({ message, author, email }) }),
  gitHistory: (id: string) => request<{ commits: GitCommitInfo[] }>(`/api/projects/${id}/git/history`),
  importLocal: (path: string) => request<{ project_id: string; filename: string; files: string[] }>(
    '/api/projects/local', { method: 'POST', headers: editHeaders, body: JSON.stringify({ path }) }),
  health: () => request<Health>('/api/health'),
  tool: (command: ToolCommand) => request<ToolResult>('/api/tools/run', { method: 'POST', headers: editHeaders, body: JSON.stringify({ command }) }),
  importZip: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<{ project_id: string; filename: string; files: string[] }>('/api/projects', {
      method: 'POST', headers: { 'X-Nexus-Local': '1' }, body,
    });
  },
  files: (id: string) => request<{ files: string[] }>(`/api/projects/${id}/files`),
  file: (id: string, path: string) => request<{ path: string; content: string; sha256: string }>(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  save: (id: string, path: string, content: string, expected_sha256: string) => request<{ content: string; sha256: string; saved: boolean }>(
    `/api/projects/${id}/file`, { method: 'PUT', headers: editHeaders, body: JSON.stringify({ path, content, expected_sha256 }) },
  ),
  revisions: (id: string, path: string) => request<{ revisions: Revision[] }>(`/api/projects/${id}/history?path=${encodeURIComponent(path)}`),
  restore: (id: string, path: string, revision: string, expected_sha256: string) => request<{ content: string; sha256: string }>(
    `/api/projects/${id}/restore`, { method: 'POST', headers: editHeaders, body: JSON.stringify({ path, revision, expected_sha256 }) },
  ),
  search: (id: string, query: string) => request<{ results: SearchHit[] }>(`/api/projects/${id}/search?q=${encodeURIComponent(query)}`),
  diagnostics: (id: string) => request<Diagnostics>(`/api/projects/${id}/diagnostics`),
  proposal: (body: { project_id: string; path: string; instruction: string; expected_sha256: string; model: string; temperature: number }) =>
    request<Proposal>('/api/proposals', { method: 'POST', headers: editHeaders, body: JSON.stringify(body) }),
};
