import { monaco } from './monaco';
import { api } from './api';

export type InlineSettings = {
  projectId: string;
  path: string;
  enabled: boolean;
  automatic: boolean;
  model: string;
};

let settings: InlineSettings = { projectId: '', path: '', enabled: false, automatic: false, model: 'qwen2.5-coder:1.5b' };
let registered = false;

export function configureInline(next: InlineSettings) {
  settings = next;
}

// Um provedor atende todos os editores; o caminho ativo decide quando a IA pode sugerir.
export function registerInlineSuggestions() {
  if (registered) return;
  registered = true;
  const languages = ['python', 'javascript', 'typescript', 'json', 'html', 'css', 'go', 'rust', 'java', 'cpp', 'csharp', 'php', 'ruby', 'shell', 'yaml'];
  for (const language of languages) {
    monaco.languages.registerInlineCompletionsProvider(language, {
      async provideInlineCompletions(model, position, context, token) {
        const current = settings;
        if (!current.enabled || !current.projectId || !current.path) return { items: [] };
        if (!current.automatic && context.triggerKind === 0) return { items: [] };
        if (model.uri.path.replace(/^\//, '') !== current.path) return { items: [] };
        const controller = new AbortController();
        const disposable = token.onCancellationRequested(() => controller.abort());
        try {
          if (current.automatic) {
            // Espera uma pausa na digitação antes de ocupar o Ollama.
            await new Promise<void>((resolve, reject) => {
              const timeout = window.setTimeout(resolve, 700);
              controller.signal.addEventListener('abort', () => {
                window.clearTimeout(timeout);
                reject(new Error('cancelado'));
              }, { once: true });
            });
          }
          if (token.isCancellationRequested) return { items: [] };
          const value = model.getValue();
          const offset = model.getOffsetAt(position);
          const prefix = value.slice(Math.max(0, offset - 3000), offset);
          if (!prefix.trim()) return { items: [] };
          const suffix = value.slice(offset, offset + 850);
          const result = await api.completion({
            project_id: current.projectId, path: current.path,
            prefix, suffix, model: current.model,
          }, controller.signal);
          if (token.isCancellationRequested || !result.text || settings.path !== current.path) return { items: [] };
          return { items: [{ insertText: result.text, range: new monaco.Range(
            position.lineNumber, position.column, position.lineNumber, position.column,
          ) }] };
        } catch {
          // Falha ou cancelamento de autocomplete não interfere na edição normal.
          return { items: [] };
        } finally {
          disposable.dispose();
        }
      },
      freeInlineCompletions() {},
    });
  }
}
