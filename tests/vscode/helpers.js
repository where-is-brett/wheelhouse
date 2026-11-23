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
// A desk whose answers a test sets, and which keeps every call. The views are shaped as the helper gives them:
// `waiting` is { views: { waiting: [the cards waiting] }, cards: [every card event, answered ones too], names }.
// A signed watch answers `paired`, as the helper's does (`paired: undefined` is a helper that doesn't say).
export function fakeDesk({ paired = true, helper = 'up' } = {}) {
  const calls = [];
  const state = { paired, helper, cursor: 'k1', events: [], views: {}, pairRefused: false };
  const gone = () => (state.helper === 'down' ? { ok: false, down: true } : state.helper === 'update' ? { ok: false, update: true } : null);
  const desk = {
    calls,
    state,
    read: async (view) => {
      calls.push(['read', view]);
      return gone() ?? { ok: true, data: state.views[view] ?? {} };
    },
    act: async (command, args) => {
      calls.push(['act', command, args]);
      if (gone()) return gone();
      if (command === 'pair') return state.pairRefused ? { ok: false, refused: 'Wheelhouse can\'t pair now' } : { ok: true, changed: ['card'], fingerprint: 'abc123abc123' };
      return { ok: false, refused: 'not expected' };
    },
    watch: async (cursor) => {
      calls.push(['watch', cursor]);
      return gone() ?? { ok: true, ...(state.paired === undefined ? {} : { paired: state.paired }), events: state.events, cursor: state.cursor };
    },
  };
  return desk;
}

// The record's waiting view with these cards waiting and these answered (answered ones appear only in `cards`).
export const waitingView = (waiting, answered = []) => ({
  views: { waiting: waiting.map((c) => ({ id: c.id, at: 'x', data: c.data })) },
  cards: [...answered, ...waiting].map((c) => ({ id: c.id, kind: 'card', at: 'x', data: c.data })),
  names: ['name'],
});

export const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// Activates the add-on over a stand-in VS Code and desk, resolves its view, and lets the first look finish.
// With `address`, the real desk client talks to a stand-in helper there instead of `desk`.
export async function start({ desk = fakeDesk(), address, project = 'owner__name', visible = true, render = (s) => JSON.stringify(s), context = fakeContext() } = {}) {
  const ext = require('../../vscode/extension.cjs');
  const vscode = fakeVscode();
  const every = fakeEvery();
  const add = await ext.activate(context, { vscode, deps: { ...(address === undefined ? { desk } : { address }), project: () => project, every, render, expose: true } });
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
