// ---------------------------------------------------------------------------
// Left file tree. ~200px, collapses to a 36px rail (persisted in localStorage).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import type { FileNode } from '../../shared/types';

export interface FileTreeProps {
  tree: FileNode[];
  activePath: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpen: (path: string) => void;
  onNewFile: (path: string) => void;
}

function collectDirs(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'dir') { out.push(n.path); if (n.children) collectDirs(n.children, out); }
  }
  return out;
}

export default function FileTree(props: FileTreeProps) {
  const { tree, activePath, collapsed, onToggleCollapsed, onOpen, onNewFile } = props;
  const dirs = useMemo(() => collectDirs(tree), [tree]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(dirs));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // newly discovered directories start expanded
  useEffect(() => {
    setOpen((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const d of dirs) if (!next.has(d)) { next.add(d); changed = true; }
      return changed ? next : prev;
    });
  }, [dirs]);

  const toggleDir = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });

  const commit = () => {
    const name = draft.trim().replace(/^\/+/, '');
    setAdding(false);
    setDraft('');
    if (name) onNewFile(name);
  };

  if (collapsed) {
    return (
      <nav className="wsTree is-collapsed" data-testid="file-tree" data-collapsed="true">
        <button
          className="treeChevron"
          data-testid="tree-toggle"
          title="show files"
          aria-label="show files"
          onClick={onToggleCollapsed}
        >
          ›
        </button>
        <span className="treeRailCaption">files</span>
      </nav>
    );
  }

  const render = (nodes: FileNode[], depth: number) =>
    nodes.map((n) => {
      if (n.type === 'dir') {
        const isOpen = open.has(n.path);
        return (
          <div key={n.path}>
            <button
              className="treeRow treeDir"
              style={{ paddingLeft: 8 + depth * 12 }}
              data-testid={`dir-${n.path}`}
              aria-expanded={isOpen}
              onClick={() => toggleDir(n.path)}
            >
              <span className="treeCaret" data-open={isOpen}>▸</span>
              <span className="treeName">{n.name}</span>
            </button>
            {isOpen && n.children ? render(n.children, depth + 1) : null}
          </div>
        );
      }
      return (
        <button
          key={n.path}
          className="treeRow treeFile"
          style={{ paddingLeft: 8 + depth * 12 }}
          data-testid={`file-${n.path}`}
          data-active={n.path === activePath}
          onClick={() => onOpen(n.path)}
          title={n.path}
        >
          <span className="treeDot" />
          <span className="treeName">{n.name}</span>
        </button>
      );
    });

  return (
    <nav className="wsTree" data-testid="file-tree" data-collapsed="false">
      <div className="treeHead">
        <span className="treeTitle">files</span>
        <button
          className="treeIconBtn"
          data-testid="new-file"
          title="new file"
          aria-label="new file"
          onClick={() => { setAdding(true); setDraft(''); }}
        >
          +
        </button>
        <button
          className="treeChevron"
          data-testid="tree-toggle"
          title="hide files"
          aria-label="hide files"
          onClick={onToggleCollapsed}
        >
          ‹
        </button>
      </div>

      {adding && (
        <input
          className="treeNewInput"
          data-testid="new-file-input"
          autoFocus
          placeholder="name.py"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setDraft(''); }
          }}
        />
      )}

      <div className="treeBody">
        {tree.length === 0 ? <div className="treeEmpty">no files yet</div> : render(tree, 0)}
      </div>
    </nav>
  );
}
