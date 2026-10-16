import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ value, label = false }: { value: string; label?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  }
  return <button className="icon-button mini" title="Copiar" aria-label="Copiar conteúdo" onClick={() => void copy()}>
    {copied ? <Check size={13}/> : <Copy size={13}/>} {label && (copied ? 'COPIADO' : 'COPIAR')}
  </button>;
}

function inlinePieces(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const tokens = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let start = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = tokens.exec(text))) {
    if (start < match.index) parts.push(text.slice(start, match.index));
    if (match[2]) parts.push(<strong key={i++}>{match[2]}</strong>);
    else if (match[3]) parts.push(<code className="inline-code" key={i++}>{match[3]}</code>);
    else if (match[4]) parts.push(<a key={i++} href={match[5]} target="_blank" rel="noopener noreferrer">{match[4]}</a>);
    start = tokens.lastIndex;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

// Monta o Markdown com elementos React, sem aceitar HTML vindo do modelo.
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      const lang = line.match(/^\s*```([\w+-]*)/)?.[1] || 'código';
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      nodes.push(<div className="md-code" key={nodes.length}>
        <div className="md-code-head"><span>{lang.toUpperCase()}</span><CopyButton value={code.join('\n')} label/></div>
        <pre><code>{code.join('\n')}</code></pre>
      </div>);
      index++;
    } else if (/^\s*#{1,4}\s/.test(line)) {
      nodes.push(<h3 key={nodes.length}>{inlinePieces(line.replace(/^\s*#{1,4}\s*/, ''))}</h3>);
      index++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[index])) {
        items.push(lines[index++].replace(/^\s*([-*]|\d+\.)\s/, ''));
      }
      const children = items.map((item, i) => <li key={i}>{inlinePieces(item)}</li>);
      nodes.push(ordered ? <ol key={nodes.length}>{children}</ol> : <ul key={nodes.length}>{children}</ul>);
    } else if (!line.trim()) index++;
    else {
      const paragraph = [line];
      index++;
      while (index < lines.length && lines[index].trim() && !/^\s*(#{1,4}\s|```|[-*]\s|\d+\.\s)/.test(lines[index])) {
        paragraph.push(lines[index++]);
      }
      nodes.push(<p key={nodes.length}>{paragraph.map((item, i) => <React.Fragment key={i}>{i > 0 && <br/>}{inlinePieces(item)}</React.Fragment>)}</p>);
    }
  }
  return <div className="markdown">{nodes}</div>;
}
