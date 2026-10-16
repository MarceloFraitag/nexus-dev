import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import CoreWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Carrega os workers pelo Vite; o editor não depende de uma CDN.
self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
    return new CoreWorker();
  },
};

loader.config({ monaco });

const options = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '667D88', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'F67BFF' },
    { token: 'string', foreground: 'E5B56C' },
    { token: 'number', foreground: '9BD8FF' },
  ],
  colors: {
    'editor.background': '#19191F',
    'editor.foreground': '#D9E6F5',
    'editor.lineHighlightBackground': '#2A1F4638',
    'editorLineNumber.foreground': '#57647B',
    'editorLineNumber.activeForeground': '#B89AFF',
    'editor.selectionBackground': '#A834F24B',
    'editorCursor.foreground': '#B89AFF',
    'editorGutter.background': '#19191F',
    'editorIndentGuide.background1': '#33364D',
  },
};

monaco.editor.defineTheme('nexus-night', options);
monaco.editor.defineTheme('nexus-2077', {
  ...options,
  rules: [
    { token: 'comment', foreground: '899480', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'FC5C69' },
    { token: 'string', foreground: 'EED46B' },
    { token: 'number', foreground: '52E9D1' },
  ],
  colors: {
    ...options.colors,
    'editor.background': '#101313',
    'editor.foreground': '#F3F0D8',
    'editor.lineHighlightBackground': '#FFE60013',
    'editorLineNumber.foreground': '#6B715C',
    'editorLineNumber.activeForeground': '#FCEA00',
    'editor.selectionBackground': '#FFF20044',
    'editorCursor.foreground': '#FCEA00',
    'editorGutter.background': '#101313',
  },
});

export { monaco };
