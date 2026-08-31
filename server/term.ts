// WS /ws/term?projectId=<id> — a real pty (bash) rooted in the project folder.
//
// Frames are JSON text, exactly per shared/types.ts:
//   client -> server: {type:'data', data:string} | {type:'resize', cols, rows}
//   server -> client: {type:'data', data:string} | {type:'exit', code:number}

import { WebSocketServer, type WebSocket } from 'ws';
import * as pty from 'node-pty';
import { exists, projectDir } from './store';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type ClientFrame =
  | { type: 'data'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export const termWss = new WebSocketServer({ noServer: true });

/** Validate the project, then hand the socket a pty. */
export async function attachTerminal(ws: WebSocket, url: URL): Promise<void> {
  const projectId = url.searchParams.get('projectId') ?? '';
  let dir: string;
  try {
    dir = projectDir(projectId);
  } catch {
    ws.send(JSON.stringify({ type: 'data', data: `\r\nomnilearn: invalid projectId\r\n` }));
    ws.send(JSON.stringify({ type: 'exit', code: 1 }));
    ws.close(1008, 'invalid projectId');
    return;
  }
  if (!(await exists(dir))) {
    ws.send(JSON.stringify({ type: 'data', data: `\r\nomnilearn: no such project "${projectId}"\r\n` }));
    ws.send(JSON.stringify({ type: 'exit', code: 1 }));
    ws.close(1008, 'no such project');
    return;
  }

  let term: pty.IPty;
  try {
    term = pty.spawn('bash', [], {
      name: 'xterm-color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: dir,
      env: { ...process.env, TERM: 'xterm-color' } as Record<string, string>,
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'data', data: `\r\nomnilearn: pty failed: ${(err as Error).message}\r\n` }));
    ws.send(JSON.stringify({ type: 'exit', code: 1 }));
    ws.close(1011, 'pty failed');
    return;
  }

  let closed = false;
  const killPty = () => {
    if (closed) return;
    closed = true;
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  };

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
  });

  term.onExit(({ exitCode }) => {
    closed = true;
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      ws.close(1000, 'pty exited');
    }
  });

  ws.on('message', (raw) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      return; // ignore malformed frames
    }
    if (frame?.type === 'data' && typeof frame.data === 'string') {
      term.write(frame.data);
    } else if (frame?.type === 'resize') {
      const cols = Math.max(1, Math.min(1000, Math.floor(Number(frame.cols) || DEFAULT_COLS)));
      const rows = Math.max(1, Math.min(1000, Math.floor(Number(frame.rows) || DEFAULT_ROWS)));
      try {
        term.resize(cols, rows);
      } catch {
        /* pty may already be gone */
      }
    }
  });

  ws.on('close', killPty);
  ws.on('error', killPty);
}
