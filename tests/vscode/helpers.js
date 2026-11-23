// tests/vscode/helpers.js
// Stand-ins for VS Code and the desk, so the add-on's tests run with neither.
import { createRequire } from 'node:module';

export const require = createRequire(import.meta.url);

// A VS Code that records what the add-on asks of it.
export function fakeVscode({ folders = ['/work/project'] } = {}) {
  const seen = { commands: new Map(), executed: [], providers: new Map(), providerOptions: new Map(), items: [] };
  const vscode = {
    seen,
    StatusBarAlignment: { Left: 1, Right: 2 },
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
      registerWebviewViewProvider: (id, provider, options) => { seen.providers.set(id, provider); seen.providerOptions.set(id, options); return { dispose() {} }; },
    },
  };
  return vscode;
}

// A webview view that keeps its html and lets a test change its visibility.
export function fakeView() {
  const visibility = [];
  const disposed = [];
  const view = {
    html: '',
    visible: true,
    webview: {
      options: {},
      cspSource: 'vscode-webview://stand-in',
      set html(value) { view.html = value; },
      get html() { return view.html; },
      onDidReceiveMessage: () => ({ dispose() {} }),
    },
    onDidDispose: (fn) => { disposed.push(fn); return { dispose() {} }; },
    onDidChangeVisibility: (fn) => { visibility.push(fn); return { dispose() {} }; },
    show: (visible) => { view.visible = visible; for (const fn of visibility) fn(); },
    dispose: () => { for (const fn of disposed) fn(); },
  };
  return view;
}

// SecretStorage in memory, and a context that carries it.
export function fakeContext() {
  const kept = new Map();
  const stored = [];
  return {
    subscriptions: [],
    stored,
    secrets: { get: async (k) => kept.get(k), store: async (k, v) => { kept.set(k, v); stored.push(k); } },
  };
}

// A desk whose answers a test sets by command or view, and which keeps every call.
export function fakeDesk({ paired = true, helper = 'up' } = {}) {
  const calls = [];
  const state = { paired, helper, cursor: 'k1', events: [], views: {} };
  const desk = {
    calls,
    state,
    read: async (view) => {
      calls.push(['read', view]);
      if (state.helper === 'down') return { ok: false, down: true };
      if (state.helper === 'update') return { ok: false, update: true };
      return { ok: true, data: state.views[view] ?? {} };
    },
    act: async (command, args) => {
      calls.push(['act', command, args]);
      if (state.helper === 'down') return { ok: false, down: true };
      if (state.helper === 'update') return { ok: false, update: true };
      if (command === 'pair') return { ok: true, changed: ['card'], fingerprint: 'abc123abc123' };
      return state.paired ? { ok: false, refused: 'Card wheelhouse-pair-check isn\'t waiting' } : { ok: false, refused: 'That app was never paired with Wheelhouse' };
    },
    watch: async (cursor) => {
      calls.push(['watch', cursor]);
      if (state.helper === 'down') return { ok: false, down: true };
      return { ok: true, events: state.events, cursor: state.cursor };
    },
  };
  return desk;
}

export const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// Activates the add-on over a stand-in VS Code and desk, resolves its view, and lets the first look finish.
export async function start({ desk = fakeDesk(), project = 'owner__name', visible = true, render = (s) => JSON.stringify(s) } = {}) {
  const ext = require('../../vscode/extension.cjs');
  const vscode = fakeVscode();
  const context = fakeContext();
  const every = fakeEvery();
  const add = await ext.activate(context, { vscode, deps: { desk, project: () => project, every, render, expose: true } });
  const view = fakeView();
  view.visible = visible;
  vscode.seen.providers.get(ext.PANEL_ID).resolveWebviewView(view);
  await settle();
  return { vscode, context, every, add, view, desk };
}

// An interval a test runs by hand.
export function fakeEvery() {
  const timers = [];
  const every = (fn, ms) => {
    const timer = { fn, ms, live: true, dispose() { this.live = false; } };
    timers.push(timer);
    return timer;
  };
  every.timers = timers;
  every.run = async () => { for (const t of timers.filter((x) => x.live)) await t.fn(); };
  return every;
}
