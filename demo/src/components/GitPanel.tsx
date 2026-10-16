import { useCallback, useEffect, useState } from 'react';
import { Check, GitBranch, GitCommitHorizontal, History, LoaderCircle, Plus, RefreshCw, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import type { GitCommitInfo, GitStatus } from '../lib/api';

type Props = {
  projectId: string;
  refreshKey: number;
  hasUnsavedChanges: boolean;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
  onOpenFile: (path: string) => void;
};

export function GitPanel({ projectId, refreshKey, hasUnsavedChanges, onError, onNotice, onOpenFile }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [history, setHistory] = useState<GitCommitInfo[]>([]);
  const [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem('nexus.git.author') || '');
  const [email, setEmail] = useState(() => localStorage.getItem('nexus.git.email') || '');
  const [showHistory, setShowHistory] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) { setStatus(null); setHistory([]); return; }
    const next = await api.gitStatus(projectId);
    setStatus(next);
    setPreview(null);
    setHistory(next.initialized ? (await api.gitHistory(projectId)).commits : []);
  }, [projectId]);

  useEffect(() => { void reload().catch(onError); }, [reload, refreshKey]);

  async function act(action: () => Promise<GitStatus>, notice: string) {
    setBusy(true);
    try {
      const result = await action();
      setStatus(result);
      setHistory(result.initialized ? (await api.gitHistory(projectId)).commits : []);
      setPreview(null);
      onNotice(notice);
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  async function showDiff(path: string, staged: boolean) {
    setBusy(true);
    try {
      const result = await api.gitDiff(projectId, path, staged);
      setPreview({ path, text: result.diff || 'Nenhuma diferença nesta área.' });
    } catch (error) { onError(error); }
    finally { setBusy(false); }
  }

  function makeCommit() {
    if (hasUnsavedChanges) { onError(new Error('Revise e salve os arquivos abertos antes do commit.')); return; }
    if (!message.trim() || !author.trim() || !email.trim()) {
      onError(new Error('Preencha a mensagem, seu nome e o e-mail do commit.'));
      return;
    }
    localStorage.setItem('nexus.git.author', author);
    localStorage.setItem('nexus.git.email', email);
    void act(() => api.gitCommit(projectId, message, author, email), 'Commit criado no Git do workspace.');
    setMessage('');
  }

  if (!projectId) return <div className="git-placeholder">Importe um projeto para utilizar o Git.</div>;
  if (!status) return <div className="git-placeholder"><LoaderCircle size={16} className="spin"/> Carregando Git...</div>;
  return <div className="git-panel">
    <div className="git-panel-title"><GitBranch size={16}/> SOURCE CONTROL
      <button aria-label="Atualizar Git" title="Atualizar Git" disabled={busy} onClick={() => void reload().catch(onError)}><RefreshCw size={14}/></button>
    </div>
    {!status.initialized ? <div className="git-setup">
      <p>Este workspace ainda não tem um repositório Git.</p>
      <button disabled={busy} onClick={() => void act(() => api.gitInit(projectId), 'Repositório Git criado no workspace.')}>
        <Plus size={14}/> INICIAR GIT
      </button>
      <small>O Git será criado somente na cópia isolada do Nexus, sem alterar a pasta original.</small>
    </div> : <>
      <div className="git-branch"><GitBranch size={13}/> {status.branch}<span>{status.changes.length} alterações</span></div>
      {status.changes.some(c => !c.staged) && <button className="git-stage-all" disabled={busy || hasUnsavedChanges}
        onClick={() => void act(() => api.gitStageAll(projectId), 'Arquivos compatíveis preparados para commit.')}>
        <Plus size={13}/> PREPARAR TODAS AS ALTERAÇÕES
      </button>}
      <div className="git-changes">{status.changes.length ? status.changes.map(change => <div className="git-change" key={change.path}>
        <div><span className={change.staged ? 'git-staged' : 'git-modified'}>{change.index === '?' ? '?' : change.index !== ' ' ? change.index : change.worktree}</span>
          <button title={`Abrir ${change.path}`} onClick={() => onOpenFile(change.path)}>{change.path}</button>
        </div>
        <div className="git-change-actions">
          <button disabled={busy} title={change.staged ? 'Ver diff preparado' : 'Ver diff'} onClick={() => void showDiff(change.path, change.staged)}>DIFF</button>
          {change.staged
            ? <button disabled={busy || hasUnsavedChanges} title="Remover do stage" onClick={() => void act(() => api.gitStage(projectId, change.path, false), `Unstage: ${change.path}`)}><Undo2 size={13}/></button>
            : <button disabled={busy || hasUnsavedChanges} title="Preparar arquivo" onClick={() => void act(() => api.gitStage(projectId, change.path, true), `Stage: ${change.path}`)}><Plus size={14}/></button>}
        </div>
      </div>) : <p className="git-clean"><Check size={14}/> Nenhuma alteração pendente.</p>}</div>
      {preview && <div className="git-diff-box"><div><strong>DIFF // {preview.path}</strong><button onClick={() => setPreview(null)}>FECHAR</button></div><pre>{preview.text}</pre></div>}
      <div className="git-commit-form">
        <strong><GitCommitHorizontal size={14}/> NOVO COMMIT</strong>
        <input value={message} onChange={e => setMessage(e.target.value)} placeholder="Mensagem do commit" maxLength={120}/>
        <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="Seu nome no Git" maxLength={100}/>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Seu e-mail no Git" maxLength={150}/>
        <button disabled={busy || hasUnsavedChanges || !status.changes.some(c => c.staged)} onClick={makeCommit}>
          {busy ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>} COMMIT DAS ALTERAÇÕES PREPARADAS
        </button>
        <small>Commit local. Push e comandos destrutivos ficam desativados.</small>
      </div>
      <div className="git-history"><button onClick={() => setShowHistory(v => !v)}><History size={13}/> HISTÓRICO ({history.length})</button>
        {showHistory && (history.length ? history.map(commit => <div key={commit.hash}><code>{commit.hash}</code><span>{commit.message}<small>{commit.date}</small></span></div>) : <p>Nenhum commit ainda.</p>)}
      </div>
    </>}
  </div>;
}
