// A demo trabalha apenas com este exemplo no navegador do visitante.
const defaults: Record<string, string> = {
  'src/App.tsx': `import { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n\n  return (\n    <main>\n      <h1>Olá, Nexus Dev.</h1>\n      <p>Uma ideia. Um projeto. Seu próximo passo.</p>\n      <button onClick={() => setCount(count + 1)}>\n        Cliques: {count}\n      </button>\n    </main>\n  );\n}\n`,
  'src/style.css': `:root {\n  font-family: system-ui, sans-serif;\n  color: #e4e1e9;\n  background: #19191f;\n}\n\nbutton {\n  background: #b99af8;\n  border: 0;\n  border-radius: 12px;\n  padding: 12px 20px;\n}\n`,
  'README.md': '# Projeto de exemplo\n\nExperimente o editor, a revisão e o Git simulado.\n\nEsta demo não executa código e não usa Ollama. As respostas da conversa são exemplos preparados.\n',
  'package.json': '{\n  "name": "nexus-example",\n  "version": "1.0.0",\n  "private": true\n}\n',
};
let documents = { ...defaults };
let revisions: Record<string, {id:string;path:string;timestamp:string;sha256:string;bytes:number;content:string}[]> = {};
let staged = new Set<string>();
let committed = { ...defaults };
let commits = [{ hash: 'demo0001', date: new Date().toISOString(), message: 'Projeto de exemplo — histórico simulado' }];
const model = 'Demo · respostas simuladas';
const hash = (text: string) => String(text.length) + '-' + Array.from(text).reduce((n,c)=>((n*31+c.charCodeAt(0))>>>0),0).toString(16);
const status = () => ({initialized:true, branch:'demo/main', changes:Object.keys(documents).filter(path=>documents[path]!==committed[path]).map(path=>({path,index:staged.has(path)?'M':' ',worktree:staged.has(path)?' ':'M',staged:staged.has(path)}))});

export async function demoRequest(route: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(route,'https://demo.invalid');
  const path = url.searchParams.get('path') || '';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  if(url.pathname==='/api/health') return {status:'ok',model,models:[model,'qwen2.5-coder:1.5b'],ollama_connected:false,version:'0.6.0-demo'};
  if(url.pathname==='/api/completions') return {text:'\n// Sugestão demonstrativa: adicione seu código aqui.\n',model:'Demo simulada'};
  if(url.pathname.endsWith('/files')) return {files:Object.keys(documents)};
  if(url.pathname.endsWith('/file')) {
    if(init?.method==='PUT') {
      if(hash(documents[body.path])!==body.expected_sha256) throw Error('O exemplo mudou. Reabra o arquivo.');
      (revisions[body.path] ||= []).unshift({id:crypto.randomUUID(),path:body.path,timestamp:new Date().toISOString(),sha256:hash(documents[body.path]),bytes:documents[body.path].length,content:documents[body.path]});
      documents[body.path]=body.content;
      return {content:body.content,sha256:hash(body.content),saved:true};
    }
    if(!(path in documents)) throw Error('Arquivo de exemplo não encontrado.');
    return {path,content:documents[path],sha256:hash(documents[path])};
  }
  if(url.pathname.endsWith('/git/status') || url.pathname.endsWith('/git/init'))return status();
  if(url.pathname.endsWith('/git/diff'))return {path,staged:url.searchParams.get('staged')==='true',diff:`--- a/${path}\n+++ b/${path}\n${(committed[path]||'').split('\n').map(x=>'-'+x).join('\n')}\n${(documents[path]||'').split('\n').map(x=>'+'+x).join('\n')}\n`};
  if(url.pathname.endsWith('/git/stage')){staged.add(body.path);return status();}
  if(url.pathname.endsWith('/git/unstage')){staged.delete(body.path);return status();}
  if(url.pathname.endsWith('/git/stage-all')){status().changes.forEach(x=>staged.add(x.path));return status();}
  if(url.pathname.endsWith('/git/commit')){
    if(!staged.size)throw Error('Selecione uma alteração para o commit simulado.');
    staged.forEach(path=>committed[path]=documents[path]);staged.clear();
    commits.unshift({hash:'demo'+Date.now().toString(16),date:new Date().toISOString(),message:body.message});return status();
  }
  if(url.pathname.endsWith('/git/history'))return {commits};
  if(url.pathname.endsWith('/history'))return {revisions:revisions[path]||[]};
  if(url.pathname.endsWith('/restore')){
    const revision=revisions[body.path]?.find(r=>r.id===body.revision);
    if(!revision)throw Error('Backup não encontrado.');
    const current=documents[body.path];
    revisions[body.path].unshift({id:crypto.randomUUID(),path:body.path,timestamp:new Date().toISOString(),sha256:hash(current),bytes:current.length,content:current});
    documents[body.path]=revision.content;return {content:revision.content,sha256:hash(revision.content)};
  }
  if(url.pathname.endsWith('/search')){
    const query=(url.searchParams.get('q')||'').toLowerCase();
    return {results:Object.entries(documents).flatMap(([path,text])=>text.split('\n').flatMap((snippet,i)=>snippet.toLowerCase().includes(query)?[{path,line:i+1,snippet}]:[])).slice(0,45)};
  }
  if(url.pathname.endsWith('/diagnostics'))return {files:Object.keys(documents).length,total_bytes:Object.values(documents).join('').length,languages:{tsx:1,css:1,md:1,json:1},git_available:false,note:'Projeto de exemplo. Nenhum comando é executado nesta demo.'};
  if(url.pathname==='/api/tools/run')return {command:body.command,exit_code:0,output:'Demo pública: diagnósticos e comandos do computador ficam disponíveis na versão local.'};
  if(url.pathname==='/api/proposals')return {path:body.path,content:documents[body.path]+'\n// Exemplo de alteração para experimentar a revisão.\n',summary:'Patch demonstrativo preparado; não foi gerado por IA.',expected_sha256:body.expected_sha256};
  throw Error('Esta função usa o backend local. Nesta demo, explore o projeto de exemplo.');
}
export function exportDemo() {
 const url=URL.createObjectURL(new Blob([JSON.stringify(documents,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='nexus-demo-arquivos.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function demoAnswer(question: string) {
 if(/bug|problema|seguran/i.test(question))return '**Resposta demonstrativa — sem IA conectada.**\n\nNo exemplo, prefira `setCount(value => value + 1)` para incrementar com base no estado anterior. Você pode editar `src/App.tsx`, revisar com Ctrl+S e experimentar um commit no Git simulado.\n\nNa versão local, o Ollama pode analisar os arquivos do seu projeto.';
 if(/git|commit/i.test(question))return '**Guia demonstrativo.**\n\n1. Abra `src/App.tsx` e faça uma alteração.\n2. Use Ctrl+S para revisar e salvar.\n3. Abra Git na lateral, selecione o arquivo e crie um commit.\n\nO histórico desta demo é simulado e dura até recarregar a página.';
 return '**Resposta demonstrativa — sem IA conectada.**\n\nEste projeto de exemplo tem um componente React em `src/App.tsx`, estilos em `src/style.css` e uma documentação curta.\n\nExperimente:\n\n1. Abrir e editar um arquivo.\n2. Revisar as mudanças com Ctrl+S.\n3. Ajustar os painéis ou focar só na conversa.\n4. Explorar o Git simulado.\n\nNa versão local do Nexus, a conversa e o autocomplete usam o Ollama. Aqui, as respostas são preparadas para apresentar o fluxo.';
}
