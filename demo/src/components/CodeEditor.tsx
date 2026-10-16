import { useEffect, useRef } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type { ProjectFile, ThemeName } from '../lib/types';
import { languageFor } from '../lib/tree';
import '../lib/monaco';
import { configureInline, registerInlineSuggestions } from '../lib/completions';

const editorOptions = {
  fontFamily: "'Cascadia Code', 'Consolas', monospace",
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  smoothScrolling: true,
  tabSize: 2,
  padding: { top: 16, bottom: 16 },
  renderWhitespace: 'selection' as const,
  bracketPairColorization: { enabled: true },
  wordWrap: 'on' as const,
  lineNumbersMinChars: 3,
};

export function CodeEditor({ file, theme, fontSize, onChange, onSave, projectId, completionEnabled, completionAutomatic, completionModel, onInlineReady }: {
  file: ProjectFile | undefined; theme: ThemeName; fontSize: number;
  onChange: (value: string) => void; onSave: () => void;
  projectId: string; completionEnabled: boolean; completionAutomatic: boolean; completionModel: string;
  onInlineReady?: (trigger: (() => void) | null) => void;
}) {
  useEffect(() => {
    registerInlineSuggestions();
    configureInline({ projectId, path: file?.path || '', enabled: completionEnabled,
      automatic: completionAutomatic, model: completionModel });
    return () => configureInline({ projectId: '', path: '', enabled: false,
      automatic: false, model: completionModel });
  }, [projectId, file?.path, completionEnabled, completionAutomatic, completionModel]);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    // Ctrl+Alt+Espaço pede uma sugestão sem precisar ativar o modo automático.
    const trigger = () => editor.trigger('nexus', 'editor.action.inlineSuggest.trigger', {});
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Space, trigger);
    onInlineReady?.(trigger);
  };
  if (!file) return <div className="editor-empty">
    <div className="empty-ghost">{'{ / }'}</div>
    <span className="eyebrow">// AGUARDANDO ENTRADA</span>
    <h2>Código na tela.<br/><em>Controle nas suas mãos.</em></h2>
    <p>Importe um ZIP e abra um arquivo para editar. O Nexus nunca salva sem sua confirmação.</p>
    <div className="empty-shortcut"><kbd>CTRL</kbd> + <kbd>S</kbd> pré-visualiza alterações</div>
  </div>;
  return <Editor
    path={file.path}
    language={languageFor(file.path)}
    theme={theme === 'night-city' ? 'nexus-night' : 'nexus-2077'}
    value={file.content}
    onChange={value => onChange(value ?? '')}
    onMount={handleMount}
    loading={<div className="editor-loading">CARREGANDO EDITOR...</div>}
    options={{ ...editorOptions, fontSize, inlineSuggest: { enabled: completionEnabled,
      mode: 'subwordSmart', suppressSuggestions: false } }}
  />;
}

export function CompareEditor({ file, theme }: { file: ProjectFile; theme: ThemeName }) {
  return <DiffEditor
    language={languageFor(file.path)}
    original={file.savedContent}
    modified={file.content}
    theme={theme === 'night-city' ? 'nexus-night' : 'nexus-2077'}
    options={{ ...editorOptions, readOnly: true, renderSideBySide: true }}
  />;
}
