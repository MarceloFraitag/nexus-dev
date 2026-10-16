import type { TreeNode } from './types';

export function fileTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const path of paths) {
    let cursor = root;
    path.split('/').forEach((segment, i, parts) => {
      const nodePath = parts.slice(0, i + 1).join('/');
      let node = cursor.find(item => item.name === segment);
      if (!node) {
        node = { name: segment, path: nodePath, file: i === parts.length - 1, children: [] };
        cursor.push(node);
      }
      cursor = node.children;
    });
  }
  function sort(nodes: TreeNode[]) {
    nodes.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
    nodes.forEach(node => sort(node.children));
  }
  sort(root);
  return root;
}

export function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return ({ py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', sh: 'shell', ps1: 'powershell',
    go: 'go', rs: 'rust', rb: 'ruby', c: 'c', cpp: 'cpp', cs: 'csharp', kt: 'kotlin',
    html: 'html', css: 'css', scss: 'scss', sql: 'sql', xml: 'xml', java: 'java',
  } as Record<string, string>)[ext || ''] || 'plaintext';
}
