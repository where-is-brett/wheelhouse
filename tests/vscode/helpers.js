// tests/vscode/helpers.js
// Stand-ins for VS Code and the desk, so the add-on's tests run with neither.
import { createRequire } from 'node:module';

export const require = createRequire(import.meta.url);

// The pane's model as the desk gives it, with the parts the add-on draws.
export function model({ cards = [], stop = false, verdict = 'Nothing needs you. Nothing is broken.', over = {} } = {}) {
  return {
    v: 1,
    project: 'owner__name',
    at: '2026-11-02T05:00:00.000Z',
    glance: 'Wheelhouse',
    stop: { on: stop, since: stop ? '2026-11-02T04:00:00.000Z' : null },
    cards,
    held: null,
    verdict,
    since: null,
    launch: null,
    building: [],
    health: [],
    healthNote: { allWell: true, protection: null, week: null },
    safekeeping: null,
    usage: null,
    updated: '15:00',
    missing: [],
    ...over,
  };
}

export const card = (over = {}) => ({
  id: 'c1', n: 1, header: 'Approval', kind: 'approval', text: 'Pull request #13 changes the wording on the sign-in page.', hash: 'abc123def456',
  buttons: [
    { label: 'Approve', does: 'record', shape: 'filled' },
    { label: 'Suggest a change…', does: 'suggest', shape: 'outlined' },
    { label: 'Not now', does: 'record', shape: 'small', corner: true },
    { label: 'Why?', does: 'why', shape: 'small' },
    { label: 'Show me', does: 'turn', shape: 'link', href: 'https://preview.example.test/13' },
  ],
  note: null, blocking: true, asked: true, heldBack: false,
  parts: { what: 'It changes what users see.', why: 'It is yours to decide.', meanwhile: 'Nothing is released.' }, steered: null, waited: null, revised: false,
  ...over,
});

// A VS Code that records what the add-on asks of it.
export function fakeVscode({ folders = ['/work/project'] } = {}) {
  const seen = { commands: new Map(), executed: [], info: [], warnings: [], providers: new Map(), items: [], opened: [], webviews: [] };
  const vscode = {
    seen,
    StatusBarAlignment: { Left: 1, Right: 2 },
    Uri: { parse: (value) => ({ toString: () => value, value }), file: (value) => ({ fsPath: value }) },
    env: { version: '1.105.0', openExternal: async (uri) => { seen.opened.push(uri.toString()); return true; } },
    workspace: { workspaceFolders: folders.map((f) => ({ uri: { fsPath: f } })) },
    commands: {
      registerCommand: (id, fn) => { seen.commands.set(id, fn); return { dispose() {} }; },
      executeCommand: async (...args) => { seen.executed.push(args); },
    },
    window: {
      createStatusBarItem: (alignment, priority) => {
        const item = { alignment, priority, text: '', command: undefined, shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
        seen.items.push(item);
        return item;
      },
      showInformationMessage: async (...args) => { seen.info.push(args); },
      showWarningMessage: async (...args) => { seen.warnings.push(args); },
      registerWebviewViewProvider: (id, provider) => { seen.providers.set(id, provider); return { dispose() {} }; },
    },
  };
  return vscode;
}

// A webview view that keeps its html and the messages posted to it, and lets a test post one from the pane.
export function fakeView() {
  const handlers = [];
  const view = {
    html: '',
    posted: [],
    visible: true,
    webview: {
      options: {},
      cspSource: 'vscode-webview://stand-in',
      set html(value) { view.html = value; },
      get html() { return view.html; },
      onDidReceiveMessage: (fn) => { handlers.push(fn); return { dispose() {} }; },
      postMessage: async (m) => { view.posted.push(m); return true; },
    },
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeVisibility: () => ({ dispose() {} }),
    // What the pane posts back.
    send: async (message) => { for (const fn of handlers) await fn(message); },
    handlers,
  };
  return view;
}

export const memory = () => {
  const kept = new Map();
  return { get: (k, d) => (kept.has(k) ? kept.get(k) : d), update: async (k, v) => { kept.set(k, v); } };
};
