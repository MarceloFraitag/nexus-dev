import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Clock3, Code2, Download,
  StopCircle, WandSparkles, Gauge, FileSearch,
  Cpu, FileCode2, Folder, FolderOpen, GitBranch, History, Layers3,
  LoaderCircle, MessageSquareText, Moon, Plus, RefreshCw, RotateCcw,
  Save, Search, Send, Settings2, ShieldCheck, Sparkles, SquareTerminal,
  Sun, UploadCloud, X,
} from 'lucide-react';
const CodeEditor = lazy(() => import('./components/CodeEditor').then(module => ({ default: module.CodeEditor })));
const CompareEditor = lazy(() => import('./components/CodeEditor').then(module => ({ default: module.CompareEditor }))); 
import { GitPanel } from './components/GitPanel';
import { CopyButton, Markdown } from './components/Markdown';
import { api, streamChat } from './lib/api';
import type { ChatEvent, Diagnostics, Proposal, SearchHit, ToolCommand, ToolResult } from './lib/api';
import { fileTree, languageFor } from './lib/tree';
import type { Health, LogEntry, Message, ProjectFile, Revision, ThemeName, TreeNode } from './lib/types';
import { exportDemo } from './lib/demo';
import './style.css';
import './minimal.css';
import { ResizeHandle } from './components/ResizeHandle';

const WELCOME: Message = {
  role: 'assistant',
  text: '### Seu próximo projeto começa aqui.\n\nExplore o **Nexus Dev — Minimal Cyberpunk**. Abra um arquivo, edite e revise as alterações.\n\n**Demo pública:** conversa, autocomplete e Git são simulados. As alterações ficam nesta aba e são descartadas ao recarregar. Nenhum código é executado.',
};
const EMPTY_HEALTH: Health = { status: 'offline', model: 'qwen2.5-coder:7b', ollama_connected: false, models: [], version: '0.6.0' };
const initialPreference = <T,>(key: string, fallback: T): T => {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
};

function App() {
  const uploadRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const inlineTrigger = useRef<(() => void) | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [projectId, setProjectId] = useState(() => 'demo');
  const [projectName, setProjectName] = useState(() => 'Projeto de exemplo');
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [tabs, setTabs] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => {
    const id = 'demo';
    if (!id) return [WELCOME];
    const saved = initialPreference<Message[]>(`nexus-demo.chat.${id}`, [WELCOME]);
    return Array.isArray(saved) && saved.length ? saved : [WELCOME];
  });
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [health, setHealth] = useState<Health>(EMPTY_HEALTH);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [toolOutput, setToolOutput] = useState<ToolResult | null>(null);
  const [toolBusy, setToolBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [activeNav, setActiveNav] = useState('projeto');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleTab, setConsoleTab] = useState<'events' | 'context' | 'diagnostics'>('events');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [theme, setTheme] = useState<ThemeName>(() => initialPreference('nexus-demo.theme', 'night-city'));
  const [glow, setGlow] = useState(() => initialPreference('nexus-demo.glow', false));
  const [fontSize, setFontSize] = useState(() => initialPreference('nexus-demo.font', 13));
  const [temperature, setTemperature] = useState(() => initialPreference('nexus-demo.temperature', 0.2));
  const [numCtx, setNumCtx] = useState<2048 | 4096 | 8192>(() => initialPreference('nexus-demo.numCtx', 4096));
  const [numPredict, setNumPredict] = useState(() => initialPreference('nexus-demo.numPredict', 1024));
  const [model, setModel] = useState(() => localStorage.getItem('nexus-demo.model') || '');
  const [completionEnabled, setCompletionEnabled] = useState(() => initialPreference('nexus-demo.inline.enabled', true));
  const [completionAutomatic, setCompletionAutomatic] = useState(() => initialPreference('nexus-demo.inline.automatic', false));
  const [completionModel, setCompletionModel] = useState(() => initialPreference('nexus-demo.inline.model', 'qwen2.5-coder:1.5b'));
  const [gitRefreshKey, setGitRefreshKey] = useState(0);

  const [explorerOpen, setExplorerOpen] = useState(() => initialPreference('nexus-demo.layout.explorer', true));
  const [focus, setFocus] = useState<'split' | 'editor' | 'chat'>('split');
  const [mobileView, setMobileView] = useState('chat');
  const [explorerWidth, setExplorerWidth] = useState(() => Math.max(200, Math.min(380, Number(initialPreference('nexus-demo.layout.explorerWidth', 240)) || 240)));
  const [chatWidth, setChatWidth] = useState(() => Math.max(300, Math.min(800, Number(initialPreference('nexus-demo.layout.chatWidth', 440)) || 440)));
  const [consoleHeight, setConsoleHeight] = useState(190);
  useEffect(() => {
    localStorage.setItem('nexus-demo.layout.explorer', JSON.stringify(explorerOpen));
    localStorage.setItem('nexus-demo.layout.explorerWidth', JSON.stringify(explorerWidth));
    localStorage.setItem('nexus-demo.layout.chatWidth', JSON.stringify(chatWidth));
  }, [explorerOpen, explorerWidth, chatWidth]);

  const tree = useMemo(() => fileTree(files), [files]);
  const activeFile = tabs.find(tab => tab.path === activePath);
  const dirty = tabs.filter(tab => tab.content !== tab.savedContent);
  const modelOnline = health.models.includes(model || health.model);

  function log(message: string, type: LogEntry['type'] = 'info') {
    setLogs(previous => [...previous.slice(-99), { time: new Date().toLocaleTimeString('pt-BR'), type, message }]);
  }

  // Guarda apenas preferências e histórico de conversa no navegador local.
  useEffect(() => { localStorage.setItem('nexus-demo.theme', JSON.stringify(theme)); }, [theme]);
  useEffect(() => { localStorage.setItem('nexus-demo.glow', JSON.stringify(glow)); }, [glow]);
  useEffect(() => { localStorage.setItem('nexus-demo.font', JSON.stringify(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem('nexus-demo.temperature', JSON.stringify(temperature)); }, [temperature]);
  useEffect(() => { localStorage.setItem('nexus-demo.numCtx', JSON.stringify(numCtx)); }, [numCtx]);
  useEffect(() => { localStorage.setItem('nexus-demo.numPredict', JSON.stringify(numPredict)); }, [numPredict]);
  useEffect(() => { if (model) localStorage.setItem('nexus-demo.model', model); }, [model]);
  useEffect(() => { localStorage.setItem('nexus-demo.inline.enabled', JSON.stringify(completionEnabled)); }, [completionEnabled]);
  useEffect(() => { localStorage.setItem('nexus-demo.inline.automatic', JSON.stringify(completionAutomatic)); }, [completionAutomatic]);
  useEffect(() => { localStorage.setItem('nexus-demo.inline.model', JSON.stringify(completionModel)); }, [completionModel]);
  useEffect(() => {
    if (projectId) {
      localStorage.setItem('nexus-demo.project.id', projectId);
      localStorage.setItem('nexus-demo.project.name', projectName);
    }
  }, [projectId, projectName]);
  useEffect(() => {
    // Evita gravar o histórico no navegador a cada token recebido.
    if (projectId && !busy) localStorage.setItem(`nexus-demo.chat.${projectId}`, JSON.stringify(messages.slice(-40)));
  }, [projectId, messages, busy]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.length) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.length]);

  async function checkHealth() {
    try {
      const result = await api.health();
      setHealth(result);
      setModel(previous => previous || result.model);
    } catch { setHealth(EMPTY_HEALTH); }
  }
  useEffect(() => {
    void checkHealth();
    const interval = window.setInterval(() => void checkHealth(), 20_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => { chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: busy ? 'auto' : 'smooth' }); }, [messages, busy]);

  // Reabre o último projeto depois de atualizar a página, se ainda existir no backend.
  useEffect(() => {
    if (!projectId) return;
    void api.files(projectId).then(result => {
      setFiles(result.files);
      setExpanded([...new Set(result.files.flatMap(path => foldersOf(path)))]);
    }).catch(() => {
      localStorage.removeItem('nexus-demo.project.id');
      localStorage.removeItem('nexus-demo.project.name');
      setProjectId('');
      setProjectName('SEM PROJETO');
    });
  }, []);

  function foldersOf(path: string) {
    const parts = path.split('/');
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  }

  async function importProject(file?: File) {
    if (!file || busy || proposing) return;
    if (dirty.length && !window.confirm('Há alterações sem salvar. Quer importar outro projeto e descartá-las?')) return;
    setBusy(true);
    setError('');
    log(`Importando ${file.name}`);
    try {
      const result = await api.importZip(file);
      setProjectId(result.project_id);
      setGitRefreshKey(x => x + 1);
      setProjectName(file.name.replace(/\.zip$/i, ''));
      setFiles(result.files);
      setSelected([]);
      setSearchHits([]);
      setDiagnostics(null);
      setGlobalQuery('');
      setTabs([]);
      setActivePath('');
      setExpanded([...new Set(result.files.flatMap(foldersOf))]);
      setMessages([{ role: 'assistant', text: `### Importação concluída\n\n**${file.name}** contém ${result.files.length} arquivos disponíveis. Você já pode abrir e editar arquivos ou solicitar uma análise.` }]);
      log(`${result.files.length} arquivos importados para o workspace local.`, 'ok');
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  async function importLocalRepository() {
    if (busy || proposing) return;
    if (dirty.length && !window.confirm('Descartar alterações não salvas antes de abrir outro projeto?')) return;
    const path = window.prompt('Cole o caminho completo da pasta Git. Ela precisa estar em Documents\\PROJETOS (ou NEXUS_PROJECT_ROOT).\nO Nexus abrirá uma CÓPIA, sem alterar o original.');
    if (!path?.trim()) return;
    setBusy(true);
    try {
      const result = await api.importLocal(path.trim());
      setProjectId(result.project_id);
      setProjectName(result.filename);
      setFiles(result.files);
      setSelected([]); setSearchHits([]); setDiagnostics(null); setGlobalQuery('');
      setTabs([]); setActivePath(''); setExpanded([...new Set(result.files.flatMap(foldersOf))]);
      setMessages([{ role: 'assistant', text: `Repositório **${result.filename}** copiado para o workspace do Nexus. O histórico Git foi preservado; o original não será modificado.` }]);
      setGitRefreshKey(x => x + 1);
      setActiveNav('git');
      log(`Repositório ${result.filename} importado com histórico Git.`, 'ok');
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  function showError(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    setError(detail);
    log(detail, 'warn');
  }

  async function refreshFiles() {
    if (!projectId) return;
    try {
      const result = await api.files(projectId);
      setFiles(result.files);
      setSelected(previous => previous.filter(path => result.files.includes(path)));
      log('Lista de arquivos atualizada.', 'ok');
    } catch (cause) { showError(cause); }
  }

  async function openFile(path: string) {
    if (tabs.some(tab => tab.path === path)) {
      setActivePath(path);
      setMobileView('editor');
      setFocus(previous => previous === 'chat' ? 'editor' : previous);
      return;
    }
    if (!projectId) return;
    try {
      const data = await api.file(projectId, path);
      const newTab: ProjectFile = { ...data, savedContent: data.content };
      setTabs(previous => [...previous, newTab]);
      setActivePath(path);
      setMobileView('editor');
      setFocus(previous => previous === 'chat' ? 'editor' : previous);
      log(`Arquivo aberto: ${path}`);
    } catch (cause) { showError(cause); }
  }

  function closeTab(path: string) {
    const current = tabs.find(tab => tab.path === path);
    if (current && current.content !== current.savedContent && !window.confirm(`Descartar alterações em ${path}?`)) return;
    const remaining = tabs.filter(tab => tab.path !== path);
    setTabs(remaining);
    if (activePath === path) setActivePath(remaining[remaining.length - 1]?.path || '');
  }

  function updateContent(content: string) {
    setTabs(previous => previous.map(tab => tab.path === activePath ? { ...tab, content } : tab));
  }

  function askToSave() {
    if (activeFile && activeFile.content !== activeFile.savedContent) setCompareOpen(true);
  }

  async function saveActiveFile() {
    if (!projectId || !activeFile || saving) return;
    setSaving(true);
    try {
      const result = await api.save(projectId, activeFile.path, activeFile.content, activeFile.sha256);
      setTabs(previous => previous.map(tab => tab.path === activeFile.path ? {
        ...tab, content: result.content, savedContent: result.content, sha256: result.sha256,
      } : tab));
      setCompareOpen(false);
      setGitRefreshKey(x => x + 1);
      log(`Alterações salvas em ${activeFile.path}. Backup registrado.`, 'ok');
    } catch (cause) { showError(cause); }
    finally { setSaving(false); }
  }

  async function openHistory() {
    if (!projectId || !activeFile) return;
    try {
      const response = await api.revisions(projectId, activeFile.path);
      setRevisions(response.revisions);
      setHistoryOpen(true);
    } catch (cause) { showError(cause); }
  }

  async function restore(id: string) {
    if (!projectId || !activeFile) return;
    if (activeFile.content !== activeFile.savedContent) {
      setError('Salve ou descarte suas alterações antes de restaurar uma versão.');
      return;
    }
    if (!window.confirm('Restaurar esta versão? O estado atual também terá um backup.')) return;
    setSaving(true);
    try {
      const response = await api.restore(projectId, activeFile.path, id, activeFile.sha256);
      setTabs(previous => previous.map(tab => tab.path === activeFile.path ? {
        ...tab, content: response.content, savedContent: response.content, sha256: response.sha256,
      } : tab));
      setHistoryOpen(false);
      setGitRefreshKey(x => x + 1);
      log(`Versão restaurada: ${activeFile.path}`, 'ok');
    } catch (cause) { showError(cause); }
    finally { setSaving(false); }
  }

  function updateLastAssistant(update: (message: Message) => Message) {
    setMessages(previous => previous.map((message, index) =>
      index === previous.length - 1 && message.role === 'assistant' ? update(message) : message));
  }

  async function sendMessage(text = prompt) {
    const question = text.trim();
    if (!question || !projectId || busy) return;
    const controller = new AbortController();
    chatAbort.current = controller;
    const conversation = messages.filter(m => !(m.role === 'assistant' && m.text === WELCOME.text)).slice(-6);
    setPrompt('');
    setBusy(true);
    setMessages(previous => [...previous, { role: 'user', text: question }, { role: 'assistant', text: '' }]);
    log('Resposta progressiva iniciada.');
    let started = false;
    let pending = '';
    let frame = 0;
    // Junta tokens de uma mesma atualização de tela para não travar o Markdown.
    const flush = () => {
      frame = 0;
      const text = pending;
      pending = '';
      if (text) updateLastAssistant(message => ({ ...message, text: message.text + text }));
    };
    try {
      await streamChat({
        project_id: projectId, message: question, selected_files: selected,
        history: conversation.map(msg => ({ role: msg.role, content: msg.text.slice(0, 1200) })),
        model: model || health.model, temperature, num_ctx: numCtx, num_predict: numPredict,
      }, controller.signal, (event: ChatEvent) => {
        if (event.type === 'start') {
          started = true;
          updateLastAssistant(message => ({ ...message, files: event.files_used }));
        } else if (event.type === 'delta') {
          pending += event.text;
          if (!frame) frame = window.requestAnimationFrame(flush);
        } else if (event.type === 'done') {
          if (frame) window.cancelAnimationFrame(frame);
          flush();
          const performance = { elapsed_ms: event.elapsed_ms, first_token_ms: event.first_token_ms,
            tokens: event.tokens, tokens_per_second: event.tokens_per_second };
          updateLastAssistant(message => ({ ...message, performance }));
          log(`Resposta: ${(event.elapsed_ms / 1000).toFixed(1)}s · ${event.tokens_per_second ?? '?'} tokens/s`, 'ok');
        }
      });
    } catch (cause) {
      if (frame) window.cancelAnimationFrame(frame);
      flush();
      if (controller.signal.aborted) {
        updateLastAssistant(message => ({ ...message, text: message.text || 'Resposta cancelada.' }));
        log('Geração interrompida pelo usuário.', 'warn');
      } else {
        showError(cause);
        updateLastAssistant(message => ({ ...message, text: message.text || 'Não foi possível obter a resposta.' }));
        if (!started) setPrompt(question);
      }
    } finally {
      if (frame) window.cancelAnimationFrame(frame);
      flush();
      if (chatAbort.current === controller) chatAbort.current = null;
      setBusy(false);
    }
  }

  async function searchProject() {
    if (!projectId || globalQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const response = await api.search(projectId, globalQuery);
      setSearchHits(response.results);
      log(`Busca: ${response.results.length} ocorrência(s) encontradas.`, 'ok');
    } catch (cause) { showError(cause); }
    finally { setSearching(false); }
  }

  async function inspectProject() {
    if (!projectId) return;
    try {
      setDiagnostics(await api.diagnostics(projectId));
      setConsoleTab('diagnostics');
      setConsoleOpen(true);
      log('Diagnóstico do projeto atualizado.', 'ok');
    } catch (cause) { showError(cause); }
  }

  async function runTool(command: ToolCommand) {
    if (toolBusy) return;
    setToolBusy(true);
    try {
      const result = await api.tool(command);
      setToolOutput(result);
      log(`Diagnóstico ${command}: código de saída ${result.exit_code}`, result.exit_code === 0 ? 'ok' : 'warn');
    } catch (cause) { showError(cause); }
    finally { setToolBusy(false); }
  }

  async function suggestChange() {
    if (!projectId || !activeFile || proposing || busy) return;
    if (activeFile.content !== activeFile.savedContent) {
      setError('Salve ou descarte suas alterações antes de gerar um patch.');
      return;
    }
    const instruction = window.prompt(`O que a IA deve modificar em ${activeFile.path}?`);
    if (!instruction?.trim()) return;
    setProposing(true);
    try {
      const result = await api.proposal({
        project_id: projectId, path: activeFile.path, instruction: instruction.trim(),
        expected_sha256: activeFile.sha256, model: model || health.model, temperature: 0.1,
      });
      setProposal(result);
      log(`Sugestão recebida: ${activeFile.path}. Nenhum arquivo foi modificado.`, 'ok');
    } catch (cause) { showError(cause); }
    finally { setProposing(false); }
  }

  function loadProposal() {
    if (!proposal || !activeFile || proposal.path !== activeFile.path || proposal.expected_sha256 !== activeFile.sha256) {
      setError('O arquivo mudou. Gere uma nova sugestão.');
      return;
    }
    const nextContent = proposal.content;
    setTabs(previous => previous.map(tab => tab.path === proposal.path ? { ...tab, content: nextContent } : tab));
    setProposal(null);
    setCompareOpen(true);
    log(`Patch carregado no editor para revisão: ${activeFile.path}`);
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setExplorerOpen(true); setMobileView('files'); setActiveNav('projeto');
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function exportProject() {
    exportDemo();
  }

  function toggleSelected(path: string) {
    setSelected(previous => previous.includes(path) ? previous.filter(x => x !== path) : [...previous, path].slice(0, 8));
  }

  function navigate(section: string) {
    setActiveNav(section);
    if (section === 'projeto' || section === 'git') { setExplorerOpen(true); setMobileView('files'); }
    if (section === 'chat' || section === 'editor') {
      setMobileView(section);
      setFocus(previous => previous === 'split' ? previous : section);
    }
    if (section === 'atividade') { setMobileView('editor'); setFocus('editor'); }

    if (section === 'chat') chatRef.current?.focus();
    if (section === 'editor') editorRef.current?.focus();
    if (section === 'git') setGitRefreshKey(x => x + 1);
    if (section === 'atividade') { setConsoleOpen(true); void inspectProject(); }
    if (section === 'config') setSettingsOpen(true);
  }

  function renderTree(nodes: TreeNode[], depth = 0): React.ReactNode {
    const match = (node: TreeNode): boolean => node.path.toLowerCase().includes(filter.toLowerCase()) || node.children.some(match);
    return nodes.map(node => {
      if (filter && !match(node)) return null;
      const opened = filter ? true : expanded.includes(node.path);
      return <React.Fragment key={node.path}>
        <div className={`tree-item ${node.file && activePath === node.path ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 12 }}>
          {node.file ? <>
            <input type="checkbox" title="Incluir no contexto" aria-label={`Analisar ${node.path}`} checked={selected.includes(node.path)} onChange={() => toggleSelected(node.path)}/>
            <button className="tree-name" title={node.path} onClick={() => void openFile(node.path)}><FileCode2 size={14} className="file-icon"/><span>{node.name}</span></button>
          </> : <button className="tree-name directory" onClick={() => setExpanded(prev => opened ? prev.filter(p => p !== node.path) : [...prev, node.path])}>
            {opened ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
            {opened ? <FolderOpen size={14}/> : <Folder size={14}/>}
            <span>{node.name}</span>
          </button>}
        </div>
        {!node.file && opened && renderTree(node.children, depth + 1)}
      </React.Fragment>;
    });
  }

  return <div className={`nexus minimal theme-${theme} ${glow ? 'with-glow' : 'without-glow'}`}>
    <div className="ambient ambient-left"/><div className="ambient ambient-right"/><div className="scan-lines"/>
    <aside className="rail">
      <div className="logo"><div className="logo-word">NEXUS<span>DEV</span></div><div className="logo-subtitle">LOCAL AI DEVELOPMENT SYSTEM</div></div>
      <div className="rail-label">// SYSTEM INDEX</div>
      <nav aria-label="Navegação">
        <button aria-label="Projeto" className={activeNav === 'projeto' ? 'nav-active' : ''} onClick={() => navigate('projeto')}><Layers3 size={17}/> PROJETO</button>
        <button aria-label="Abrir editor" className={activeNav === 'editor' ? 'nav-active' : ''} onClick={() => navigate('editor')}><Code2 size={17}/> EDITOR</button>
        <button aria-label="Git" className={activeNav === 'git' ? 'nav-active' : ''} onClick={() => navigate('git')}><GitBranch size={17}/> SOURCE CONTROL</button>
        <button aria-label="Abrir conversa" className={activeNav === 'chat' ? 'nav-active' : ''} onClick={() => navigate('chat')}><MessageSquareText size={17}/> NEXUS AI</button>
        <button aria-label="Atividade" className={activeNav === 'atividade' ? 'nav-active' : ''} onClick={() => navigate('atividade')}><SquareTerminal size={17}/> ATIVIDADE</button>
        <button aria-label="Configurações" className={activeNav === 'config' ? 'nav-active' : ''} onClick={() => navigate('config')}><Settings2 size={17}/> AJUSTES</button>
      </nav>
      <div className="rail-decoration"><div className="city-mark">{theme === 'night-city' ? <>NIGHT<br/><span>CITY</span></> : <>NIGHT<br/><span>CORP</span></>}</div><span>PROTOCOL // 05</span></div>
      <div className="rail-status"><div className="micro-label">DEMONSTRAÇÃO</div>
        <div className={`status-line ${modelOnline ? 'good' : 'offline'}`}><span className="dot"/>{modelOnline ? 'DEMO NO NAVEGADOR' : 'MODELO DESCONECTADO'}</div>
        <small>{model || health.model}</small>
        <button className="refresh-link" onClick={() => void checkHealth()}><RefreshCw size={11}/> ATUALIZAR ESTADO</button>
      </div>
      <div className="rail-footer">NEXUS DEV // V0.6</div>
    </aside>

    <div className="workbench">
      <div className="topline">
        <div className="topline-id"><span className="orb"/> NEXUS DEV <ChevronRight size={12}/> {theme === 'night-city' ? 'NIGHT CITY' : '2077 PROTOCOL'} <span className="top-version">V0.6</span></div>
        <div className="topline-right">
          <button className="theme-switch" title="Alternar tema" onClick={() => setTheme(t => t === 'night-city' ? 'cyber-2077' : 'night-city')}>
            {theme === 'night-city' ? <Sun size={14}/> : <Moon size={14}/>} {theme === 'night-city' ? '2077' : 'NIGHT CITY'}
          </button>
          <span className={`topline-network ${health.status === 'ok' ? 'online' : 'off'}`}><span className="dot"/>{health.status === 'ok' ? 'DEMO INTERATIVA' : 'API OFFLINE'}</span>
          <span className="local-chip"><ShieldCheck size={12}/> LOCAL</span>
        </div>
      </div>

      <div className="demo-banner"><span><strong>DEMO PÚBLICA</strong> IA e Git simulados · edite o exemplo · alterações temporárias</span><button onClick={() => { if (window.confirm('Reiniciar o exemplo e descartar as alterações desta aba?')) { Object.keys(localStorage).filter(key => key.startsWith('nexus-demo.')).forEach(key => localStorage.removeItem(key)); window.location.reload(); } }}>Reiniciar demo</button></div>
      <div className="layout-controls" aria-label="Organização dos painéis">
        <button aria-pressed={explorerOpen} onClick={() => { setExplorerOpen(v => !v); setMobileView('files'); }}><Folder size={15}/> Arquivos</button>
        <div className="view-modes">{(['chat', 'split', 'editor'] as const).map(mode => <button key={mode} aria-pressed={focus === mode} onClick={() => { setFocus(mode); setMobileView(mode === 'split' ? 'chat' : mode); }}>{mode === 'chat' ? 'Conversa' : mode === 'editor' ? 'Editor' : 'Dividir'}</button>)}</div>
        <button aria-expanded={consoleOpen} onClick={() => { setConsoleOpen(v => !v); setMobileView('editor'); setFocus(previous => previous === 'chat' ? 'editor' : previous); }}><SquareTerminal size={15}/> Atividades</button>
      </div>
      <div className={`workspace focus-${focus} mobile-${mobileView} ${explorerOpen ? '' : 'explorer-hidden'}`} style={{ '--explorer-width': `${explorerWidth}px`, '--chat-width': `${chatWidth}px`, '--console-height': `${consoleHeight}px` } as React.CSSProperties}>
        <aside className="explorer panel-frame">
          <div className="panel-heading cyan"><div><span className="heading-numeral">01</span> ARQUIVOS</div><div className="heading-tools">
            <button disabled title="Importar ZIP disponível na versão local" onClick={() => uploadRef.current?.click()}><Plus size={16}/></button>
            <button title="Atualizar" disabled={!projectId} onClick={() => void refreshFiles()}><RefreshCw size={14}/></button>
          </div></div>
          <input hidden type="file" ref={uploadRef} accept=".zip" onChange={e => { void importProject(e.target.files?.[0]); e.target.value = ''; }}/>
          <div className="project-bar"><div><GitBranch size={14}/><span title={projectName}>{projectName}</span></div><span className="project-count">{files.length} ARQS</span></div>
          {activeNav === 'git' ? <GitPanel projectId={projectId} refreshKey={gitRefreshKey}
            hasUnsavedChanges={dirty.length > 0} onError={showError}
            onNotice={message => log(message, 'ok')} onOpenFile={path => void openFile(path)}/>
          : <>
          <div className="explorer-actions"><button className="import-btn" disabled title="Disponível na versão local" onClick={() => void importLocalRepository()}><GitBranch size={14}/> ABRIR PASTA · VERSÃO LOCAL</button></div>
          <div className="explorer-actions"><button className="import-btn" disabled title="Disponível na versão local" onClick={() => uploadRef.current?.click()}><UploadCloud size={15}/> IMPORTAR ZIP · VERSÃO LOCAL</button><button className="export-btn" disabled={!projectId || busy} onClick={() => void exportProject()}><Download size={14}/> BAIXAR EXEMPLO .JSON</button></div>
          <label className="file-search"><Search size={13}/><input value={filter} placeholder="Filtrar nomes..." onChange={e => setFilter(e.target.value)}/></label>
          <div className="global-search"><div className="global-search-row"><FileSearch size={14}/><input ref={searchRef} value={globalQuery} placeholder="Buscar dentro dos arquivos..." onChange={e => setGlobalQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchProject(); }}/><button disabled={!projectId || searching || globalQuery.trim().length < 2} onClick={() => void searchProject()} title="Buscar no conteúdo">{searching ? <LoaderCircle className="spin" size={14}/> : <Search size={15}/>}</button></div><small>CTRL+SHIFT+F · texto literal · até 45 resultados</small></div>
          {searchHits.length > 0 && <div className="search-results"><div className="search-results-title">{searchHits.length} RESULTADOS <button onClick={() => setSearchHits([])} aria-label="Fechar resultados"><X size={13}/></button></div>{searchHits.map((hit, index) => <button key={`${hit.path}:${hit.line}:${index}`} title={hit.snippet} onClick={() => void openFile(hit.path)}><strong>{hit.path}:{hit.line || 'nome'}</strong><span>{hit.snippet}</span></button>)}</div>}
          <div className="tree-scroll">{files.length ? renderTree(tree) : <div className="empty-tree"><FolderOpen size={33}/><strong>WORKSPACE VAZIO</strong><span>Selecione um projeto em ZIP para começar.</span></div>}</div>
          <div className="explorer-bottom"><div><span className="data-dot"/> {selected.length} NO CONTEXTO</div><span>MAX 8</span></div>
          </>}
        </aside>

        <ResizeHandle label="Largura dos arquivos" value={explorerWidth} min={200} max={380} onChange={setExplorerWidth} className="explorer-resize"/>
        <section className="editor-panel panel-frame" ref={editorRef} tabIndex={-1}>
          <div className="editor-tabs"><div className="tabs-scroll">{tabs.length ? tabs.map(tab => <div key={tab.path} className={`editor-tab ${activePath === tab.path ? 'chosen' : ''}`}>
            <button className="tab-file" onClick={() => setActivePath(tab.path)} title={tab.path}><FileCode2 size={13}/>{tab.path.split('/').pop()}{tab.content !== tab.savedContent && <span className="dirty-marker" title="Não salvo"/>}</button>
            <button className="tab-close" onClick={() => closeTab(tab.path)} title="Fechar aba"><X size={12}/></button>
          </div>) : <div className="editor-tab chosen sample"><Code2 size={14}/> nexus://welcome</div>}</div>
          <div className="tabs-tools"><span>{dirty.length ? `${dirty.length} MODIFICADO(S)` : 'WORKSPACE'}</span><ShieldCheck size={13}/></div></div>
          <div className="file-breadcrumb"><span>WORKSPACE</span><ChevronRight size={12}/><span className="crumb-file">{activeFile?.path || 'INICIALIZAÇÃO'}</span><span className="editor-tag">{activeFile ? 'EDITÁVEL' : 'READY'}</span></div>
          <div className="editor-toolbar">
            <div className="editor-toolbar-info"><span className="data-dot"/> {activeFile ? languageFor(activeFile.path).toUpperCase() : 'MONACO EDITOR'}</div>
            <div className="editor-toolbar-actions">
              {completionEnabled && <button disabled={!activeFile || !health.models.includes(completionModel)}
                onClick={() => inlineTrigger.current?.()} title={health.models.includes(completionModel) ? 'Pedir autocomplete (Ctrl+Alt+Espaço)' : 'Instale o modelo do autocomplete no Ollama'}>
                <Sparkles size={14}/> COMPLETAR</button>}
              <button disabled={!activeFile} onClick={() => void openHistory()} title="Histórico de versões"><History size={14}/> HISTÓRICO</button>
              <button className="ai-patch-button" disabled={!activeFile || busy || proposing || !modelOnline} onClick={() => void suggestChange()} title="IA sugere alteração neste arquivo, sem salvar">{proposing ? <LoaderCircle className="spin" size={14}/> : <WandSparkles size={14}/>} SUGERIR PATCH</button>
              <button disabled={!activeFile || activeFile.content === activeFile.savedContent} onClick={() => updateContent(activeFile?.savedContent || '')} title="Descartar mudanças"><RotateCcw size={14}/> REVERTER</button>
              <button className="save-button" disabled={!activeFile || activeFile.content === activeFile.savedContent} onClick={askToSave}><Save size={14}/> REVISAR E SALVAR</button>
            </div>
          </div>
          <div className="code-area monaco-host"><>{!activeFile ? <div className="editor-empty"><h2>Seu código, com espaço.</h2><p>Abra um arquivo no painel Arquivos para começar.</p></div> : <Suspense fallback={<div className="editor-loading">Carregando editor…</div>}><CodeEditor file={activeFile} theme={theme} fontSize={fontSize} onChange={updateContent} onSave={askToSave}
            projectId={projectId} completionEnabled={completionEnabled} completionAutomatic={completionAutomatic} completionModel={completionModel} onInlineReady={trigger => { inlineTrigger.current = trigger; }}/></Suspense>}</></div>
          <div className="editor-status"><div>{completionEnabled && activeFile && <span title="Ctrl+Alt+Espaço pede uma sugestão ao Ollama">IA INLINE: {!health.models.includes(completionModel) ? 'MODELO NÃO INSTALADO' : completionAutomatic ? 'AUTO' : 'CTRL+ALT+ESPAÇO'} <span className="status-divider"/></span>}<span className="data-dot"/>{activeFile ? (activeFile.content !== activeFile.savedContent ? 'NÃO SALVO' : 'SALVO') : 'PRONTO'} <span className="status-divider"/> UTF-8 <span className="status-divider"/> CTRL+S PARA REVISAR</div><div>{activeFile ? `${activeFile.content.split('\n').length} LINHAS` : 'SEM ARQUIVO'} {activeFile && <CopyButton value={activeFile.content}/>}</div></div>
          {consoleOpen && <ResizeHandle label="Altura das atividades" axis="y" reverse value={consoleHeight} min={100} max={360} onChange={setConsoleHeight}/>}
          <div className={`console ${consoleOpen ? '' : 'collapsed'}`}>
            <div className="console-heading"><div className="console-tabs"><button className={consoleTab === 'events' ? 'active' : ''} onClick={() => setConsoleTab('events')}><SquareTerminal size={13}/> EVENTOS</button><button className={consoleTab === 'context' ? 'active' : ''} onClick={() => setConsoleTab('context')}><FileCode2 size={13}/> CONTEXTO</button><button className={consoleTab === 'diagnostics' ? 'active' : ''} onClick={() => { setConsoleTab('diagnostics'); void inspectProject(); }}><SquareTerminal size={13}/> DIAGNÓSTICO</button></div>
              <div className="console-tools"><button className="diagnose-btn" disabled={!projectId} onClick={() => void inspectProject()} title="Diagnosticar projeto"><Gauge size={13}/> DIAGNOSTICAR</button><span>COMANDOS BLOQUEADOS</span><button title="Abrir ou fechar atividades" onClick={() => setConsoleOpen(v => !v)}>{consoleOpen ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button></div>
            </div>
            {consoleOpen && <div className="console-body">{consoleTab === 'events' ? <div className="log-lines"><div className="log-line"><span>[NEXUS]</span> Sistema inicializado. Todas as alterações exigem sua confirmação.</div>
              {logs.map((entry, index) => <div key={index} className={`log-line ${entry.type}`}><span>[{entry.time}]</span> {entry.message}</div>)}
            </div> : consoleTab === 'context' ? <div className="context-files"><strong>CONTEXTO DE ANÁLISE</strong>{selected.length ? selected.map(path => <div key={path}><Check size={12}/>{path}</div>) : <p>Sem seleção, a IA prioriza até 5 arquivos relevantes à pergunta.</p>}</div> : <div className="context-files"><strong>DIAGNÓSTICO LOCAL</strong>{diagnostics ? <><p>{diagnostics.files} arquivos · {(diagnostics.total_bytes / 1024).toFixed(1)} KB</p><p>{Object.entries(diagnostics.languages).map(([ext, count]) => `${ext}: ${count}`).join(' · ')}</p><p>{diagnostics.note}</p></> : <p>Clique em DIAGNOSTICAR para analisar a estrutura sem executar scripts.</p>}
                <div className="safe-terminal"><strong>COMANDOS PERMITIDOS</strong><div className="safe-terminal-buttons">{([['python-version', 'PYTHON'], ['node-version', 'NODE'], ['git-version', 'GIT'], ['ollama-ps', 'OLLAMA PS']] as const).map(([command, label]) => <button key={command} disabled={toolBusy} onClick={() => void runTool(command)}>{label}</button>)}</div>{toolOutput && <pre>{toolOutput.output || '(sem saída)'}</pre>}<small>Sem shell e sem comandos personalizados. Apenas diagnósticos locais.</small></div></div>}</div>}
          </div>
        </section>

        <ResizeHandle label="Largura da conversa" reverse value={chatWidth} min={300} max={800} onChange={setChatWidth} className="chat-resize"/>
        <aside className="chat-panel panel-frame">
          <div className="panel-heading magenta"><div><span className="ai-glyph"><Bot size={16}/></span> NEXUS AI <small>{model || health.model}</small></div><span className={`ai-indicator ${modelOnline ? 'online' : ''}`}><span className="dot"/>{modelOnline ? 'DEMO' : 'DEMO'}</span></div>
          <div className="chat-intro"><Sparkles size={14}/> RESPOSTAS SIMULADAS <span>V0.6</span></div>
          <div className="chat-messages" ref={chatScrollRef} aria-live="polite">{messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}>
            <div className="message-avatar">{message.role === 'assistant' ? <Bot size={15}/> : <Code2 size={15}/>}</div>
            <div className="message-body"><div className="msg-name">{message.role === 'assistant' ? 'NEXUS // AI' : 'VOCÊ'}</div><div className="message-bubble"><Markdown text={message.text}/></div>
              {!!message.files?.length && <div className="message-sources">{message.files.length} arquivo(s) analisado(s): {message.files.slice(0, 3).join(', ')}{message.files.length > 3 ? '...' : ''}</div>}{message.performance && <div className="performance-info"><Gauge size={12}/> {(message.performance.elapsed_ms / 1000).toFixed(1)}s · {message.performance.tokens_per_second ?? '?'} tokens/s · primeiro token: {message.performance.first_token_ms ?? '?'} ms</div>}
            </div>
          </div>)}{busy && <div className="streaming-badge"><LoaderCircle className="spin" size={13}/> EXEMPLO DE RESPOSTA...</div>}</div>
          {projectId && messages.length <= 2 && <div className="prompt-chips"><button disabled={busy} onClick={() => void sendMessage('Analise a estrutura deste projeto. Identifique riscos e sugira três melhorias práticas com os arquivos envolvidos.')}>ANALISAR ARQUITETURA <ChevronRight size={12}/></button><button disabled={busy} onClick={() => void sendMessage('Procure bugs e problemas de segurança nos arquivos selecionados, explicando como corrigir.')}>PROCURAR PROBLEMAS <ChevronRight size={12}/></button></div>}
          <div className="composer"><div className="composer-row"><textarea ref={chatRef} value={prompt} maxLength={5000} placeholder={projectId ? 'O que vamos construir hoje?' : 'Importe um ZIP para iniciar...'} disabled={!projectId || busy} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMessage(); } }}/><button title={busy ? "Parar geração" : "Enviar"} aria-label={busy ? "Parar geração" : "Enviar mensagem"} className={busy ? "stop-button" : ""} disabled={!projectId || (!busy && !prompt.trim())} onClick={() => busy ? chatAbort.current?.abort() : void sendMessage()}>{busy ? <StopCircle size={18}/> : <Send size={18}/>}</button></div><div className="compose-hint"><span>ENTER ENVIA · SHIFT+ENTER PULA</span><button title="Limpar conversa" onClick={() => { if (window.confirm('Limpar o histórico desta conversa?')) setMessages([WELCOME]); }}>LIMPAR CHAT</button></div></div>
        </aside>
      </div>
      <footer className="bottomline"><div><span className="bottom-chip">NEXUS // CORE</span><span>LOCAL FIRST · PRIVATE WORKSPACE</span></div><div><span className="data-dot"/> {files.length ? `${files.length} ARQUIVOS` : 'AGUARDANDO PROJETO'} <span className="status-divider"/> V0.6 · {theme === 'night-city' ? 'NIGHT CITY' : '2077'}</div></footer>
    </div>

    {error && <div className="toast-error" role="alert"><AlertTriangle size={18}/><span>{error}</span><button onClick={() => setError('')} title="Fechar"><X size={16}/></button></div>}
    {settingsOpen && <div className="modal-screen" onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><div className="settings-modal"><header><div><Settings2 size={17}/> CONFIGURAÇÕES // NEXUS</div><button title="Fechar" onClick={() => setSettingsOpen(false)}><X size={18}/></button></header>
      <div className="settings-body"><p>Escolha o visual e como o modelo local responde. As configurações ficam salvas neste navegador.</p>
        <div className="setting-theme"><button className={theme === 'night-city' ? 'selected' : ''} onClick={() => setTheme('night-city')}><Moon size={17}/> NIGHT CITY<span>ROXO / CIANO</span></button><button className={theme === 'cyber-2077' ? 'selected' : ''} onClick={() => setTheme('cyber-2077')}><Sun size={17}/> PROTOCOL 2077<span>AMARELO / PRETO</span></button></div>
        <label className="setting-row"><span>BRILHO NEON<span>Ativar efeitos luminosos</span></span><input type="checkbox" checked={glow} onChange={e => setGlow(e.target.checked)}/></label>
        <label className="setting-row"><span>TAMANHO DO CÓDIGO<span>Fonte do editor</span></span><input type="range" min="11" max="20" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}/><strong>{fontSize}px</strong></label>
        <label className="setting-row"><span>CRIATIVIDADE DA IA<span>Baixa para análises mais consistentes</span></span><input type="range" min="0" max="1" step="0.1" value={temperature} onChange={e => setTemperature(Number(e.target.value))}/><strong>{temperature.toFixed(1)}</strong></label>
        <label className="setting-row"><span>JANELA DE CONTEXTO<span>Menor costuma ser mais rápido e usar menos VRAM</span></span><select value={numCtx} onChange={e => setNumCtx(Number(e.target.value) as 2048 | 4096 | 8192)}><option value={2048}>2048 tokens · rápido</option><option value={4096}>4096 tokens · equilibrado</option><option value={8192}>8192 tokens · detalhado</option></select></label>
        <label className="setting-row"><span>LIMITE DA RESPOSTA<span>Controla o tamanho máximo gerado</span></span><select value={numPredict} onChange={e => setNumPredict(Number(e.target.value))}><option value={512}>512 tokens</option><option value={1024}>1024 tokens</option><option value={2048}>2048 tokens</option></select></label>
        <label className="setting-row"><span>MODELO OLLAMA<span>Modelos instalados detectados</span></span><select value={model || health.model} onChange={e => setModel(e.target.value)}>{[...new Set([model || health.model, ...health.models])].map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <div className="settings-section-title">// AUTOCOMPLETE LOCAL</div>
        <label className="setting-row"><span>ATIVAR AUTOCOMPLETE<span>Sugestões em texto fantasma no Monaco</span></span><input type="checkbox" checked={completionEnabled} onChange={e => setCompletionEnabled(e.target.checked)}/></label>
        <label className="setting-row"><span>SUGESTÕES AUTOMÁTICAS<span>Desligado: usar Ctrl+Alt+Espaço. Ligado: pausa de 700 ms</span></span><input type="checkbox" checked={completionAutomatic} onChange={e => setCompletionAutomatic(e.target.checked)} disabled={!completionEnabled}/></label>
        <label className="setting-row"><span>MODELO AUTOCOMPLETE<span>Recomendado: qwen2.5-coder:1.5b (instalar pelo Ollama)</span></span><select value={completionModel} onChange={e => setCompletionModel(e.target.value)}>{[...new Set([completionModel, ...health.models])].map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <div className="settings-readout"><Cpu size={15}/> AMBIENTE: DEMONSTRAÇÃO · {health.status === 'ok' ? 'CONECTADO' : 'OFFLINE'}</div>
      </div><button className="settings-finish" onClick={() => setSettingsOpen(false)}>APLICAR <Check size={15}/></button>
    </div></div>}

    {proposal && activeFile && <div className="modal-screen" onMouseDown={e => { if (e.target === e.currentTarget) setProposal(null); }}><div className="review-modal" role="dialog" aria-modal="true" aria-label="Revisar patch sugerido"><header><div><WandSparkles size={18}/> PATCH SUGERIDO PELA IA <span>{proposal.path}</span></div><button onClick={() => setProposal(null)} title="Fechar"><X size={18}/></button></header><div className="review-description">{proposal.summary || 'Compare a sugestão com seu arquivo atual.'} Nenhum arquivo foi alterado. Revise antes de carregar no editor.</div><div className="review-editor"><Suspense fallback={<div>Carregando comparação…</div>}><CompareEditor file={{ ...activeFile, content: proposal.content }} theme={theme}/></Suspense></div><footer><button className="secondary" onClick={() => setProposal(null)}>DESCARTAR SUGESTÃO</button><button className="save-button" onClick={loadProposal}><Check size={15}/> CARREGAR PARA REVISÃO</button></footer></div></div>}

    {compareOpen && activeFile && <div className="modal-screen" onMouseDown={e => { if (e.target === e.currentTarget) setCompareOpen(false); }}><div className="review-modal" role="dialog" aria-modal="true" aria-label="Revisar alterações"><header><div><GitBranch size={18}/> REVISÃO DE ALTERAÇÕES <span>{activeFile.path}</span></div><button onClick={() => setCompareOpen(false)} title="Fechar"><X size={18}/></button></header><div className="review-description">Confira o original à esquerda e suas mudanças à direita. O Nexus faz backup do original antes de salvar.</div><div className="review-editor"><Suspense fallback={<div>Carregando comparação…</div>}><CompareEditor file={activeFile} theme={theme}/></Suspense></div><footer><button className="secondary" onClick={() => setCompareOpen(false)}>VOLTAR AO EDITOR</button><button className="save-button" disabled={saving} onClick={() => void saveActiveFile()}>{saving ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>} CONFIRMAR E SALVAR</button></footer></div></div>}

    {historyOpen && activeFile && <div className="modal-screen" onMouseDown={e => { if (e.target === e.currentTarget) setHistoryOpen(false); }}><div className="settings-modal history-modal" role="dialog" aria-modal="true" aria-label="Histórico de versões"><header><div><History size={17}/> BACKUPS // {activeFile.path.split('/').pop()}</div><button onClick={() => setHistoryOpen(false)} title="Fechar"><X size={18}/></button></header><div className="history-list">{revisions.length ? revisions.map(item => <div className="history-item" key={item.id}><div><Clock3 size={15}/><span>{new Date(item.timestamp).toLocaleString('pt-BR')}<small>{item.bytes} bytes · {item.sha256.slice(0, 10)}</small></span></div><button disabled={saving} onClick={() => void restore(item.id)}><RotateCcw size={13}/> RESTAURAR</button></div>) : <p>Nenhuma versão anterior. O primeiro backup surge ao salvar uma alteração.</p>}</div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
