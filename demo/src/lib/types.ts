export type ThemeName = 'night-city' | 'cyber-2077';
export type Performance = { elapsed_ms: number; first_token_ms: number | null; tokens: number; tokens_per_second: number | null };
export type Message = { role: 'user' | 'assistant'; text: string; files?: string[]; performance?: Performance };
export type ProjectFile = { path: string; content: string; sha256: string; savedContent: string };
export type LogEntry = { time: string; type: 'ok' | 'warn' | 'info'; message: string };
export type TreeNode = { name: string; path: string; file: boolean; children: TreeNode[] };
export type Revision = { id: string; path: string; timestamp: string; sha256: string; bytes: number };
export type Health = { status: string; model: string; ollama_connected: boolean; models: string[]; version: string };
