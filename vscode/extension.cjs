// vscode/extension.cjs
// The Wheelhouse add-on for VS Code: a thin, paired desk/1 client. One webview view, one status bar item and one
// command (open the panel); no URI handler, no public API, no chat or language-model tool. It reads and watches the
// helper over desk/1 (desk-client.cjs) and signs with its own key (key.cjs). VS Code is a parameter, so tests give
// it a stand-in; `require('vscode')` is only the default.
//
// The panel is drawn by `render(stateOf(model), { nonce })` (vscode/model.cjs, vscode/pane/render.js). The model
// held here is { state, says, fingerprint, glance, waiting, work, count, allStop, notices }, with `state` one of
//   'no-helper'  the helper isn't running, or this folder isn't a Wheelhouse project (`says` tells which)
//   'update'     the helper speaks another version or doesn't know a command: "Update Wheelhouse"
//   'unpaired'   not paired; `fingerprint` is the key's, as the Pair card shows it
//   'pairing'    asked to pair, waiting for the director's Pair it; `fingerprint` as above
//   'live'       paired and watching; `glance`, `waiting`, `work` are the desk's `data` for each view
//   'stopped'    as live, with All stop on
// A paired panel is live to the helper only while its signed watch renews, so the loop runs only while the view is
// visible, and stops when it hides.
'use strict';

const { helperAddress, projectIdFor } = require('./resolver.cjs');
const { deskClient } = require('./desk-client.cjs');
const { loadKey } = require('./key.cjs');
const { stateOf, waitingCards } = require('./model.cjs');
const { makeNonces } = require('./nonce.cjs');
const { press, askToPair } = require('./press.cjs');

const OPEN_PANEL = 'wheelhouse.openPanel';
const PANEL_ID = 'wheelhouse.panel';
// The signed watch renews this often while the view is visible (the helper counts the panel live for 45 seconds).
const WATCH_MS = 10000;
const APP_NAME = 'Wheelhouse for VS Code';

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

// The panel's page. The drawing part's render.js is used when it is there; the plain page below keeps the panel
// readable without it.
function defaultRender() {
  try {
    return require('./pane/render.js').render;
  } catch {
    return (state, { nonce }) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:8px}</style></head><body><p>${escapeHtml(state.notice || state.glance || 'Wheelhouse')}</p></body></html>`;
  }
}

const SAYS = {
  looking: 'Looking for Wheelhouse\'s helper.',
  'no-helper': 'Wheelhouse\'s helper isn\'t running.',
  'no-project': 'This folder isn\'t a Wheelhouse project.',
  update: 'Update Wheelhouse: this panel and the helper speak different versions.',
  unpaired: 'This panel isn\'t paired with Wheelhouse yet.',
  pairing: 'Waiting for you to click Pair it where you answer Wheelhouse\'s cards.',
};

// The status bar's words for a state.
function statusText(state) {
  // Neutral until the first look, and again while the panel is hidden and nothing is being watched.
  if (state.looked !== true) return 'Wheelhouse';
  switch (state.state) {
    case 'live': return state.count > 0 ? `Wheelhouse · ${state.count} need${state.count === 1 ? 's' : ''} you` : 'Wheelhouse';
    case 'stopped': return 'Wheelhouse · stopped';
    case 'update': return 'Wheelhouse · update';
    case 'unpaired': return 'Wheelhouse · not paired';
    case 'pairing': return 'Wheelhouse · pairing';
    default: return 'Wheelhouse · not running';
  }
}

async function activate(context, { vscode = require('vscode'), deps = {} } = {}) {
  const folder = vscode.workspace?.workspaceFolders?.[0]?.uri?.fsPath;
  const key = await loadKey(context.secrets, deps.now ? { now: deps.now } : undefined);
  const address = deps.address ?? helperAddress();
  const render = deps.render ?? defaultRender();
  const projectNow = deps.project ?? (() => (typeof folder === 'string' ? projectIdFor(folder) : null));

  const model = { state: 'no-helper', says: SAYS.looking, looked: false, fingerprint: key.fingerprint ?? '', glance: null, waiting: null, work: null, count: 0, allStop: false, notices: [] };
  // `askedUp`: this helper start has been asked to pair once already, so a later tick doesn't ask again until the
  // helper has gone away and come back.
  const run = { view: null, timer: null, cursor: null, askedUp: false, pending: false, busy: false, loops: 0 };

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = OPEN_PANEL;
  item.text = statusText(model);
  item.show();

  const nonces = makeNonces();
  const draw = () => {
    item.text = statusText(model);
    if (run.view === null || run.view.visible === false) return;
    // A new nonce for each draw: what an older page posts counts for nothing (the press guard, vscode/press.cjs).
    run.view.webview.html = render(stateOf(model), { nonce: nonces.renew() });
  };
  const set = (state, extra = {}) => { Object.assign(model, { state, says: SAYS[state] ?? null, looked: true, ...extra }); draw(); };

  // Never signs anything for a project it can't name.
  const deskFor = (project) => deps.desk ?? deskClient({ address, sign: key.sign, project });

  // What the add-on says of itself when it asks to pair (vscode/press.cjs builds the request from it).
  const app = key.unavailable ? null : { id: key.client, name: APP_NAME, publicKey: key.publicKey };

  // The panel after the helper's answer to a request to pair.
  function paired(got) {
    run.pending = got.ok === true;
    if (got.ok === true) set('pairing', { fingerprint: got.fingerprint ?? key.fingerprint });
    else if (got.update === true) set('update');
    else if (got.down === true) set('no-helper');
    else set('unpaired', { says: got.refused ?? SAYS.unpaired });
    return got;
  }

  // Asks the helper to raise the Pair card for this key. The director's signed Pair it on that card enrols it.
  async function pair() {
    const project = projectNow();
    if (project === null || key.unavailable) return { ok: false };
    run.askedUp = true;
    return paired(await askToPair(deskFor(project), app));
  }

  async function readViews(desk) {
    const [glance, waiting, work] = await Promise.all([desk.read('glance'), desk.read('waiting'), desk.read('work')]);
    for (const got of [glance, waiting, work]) {
      if (got.update === true) return set('update');
      if (got.down === true) return set('no-helper');
    }
    Object.assign(model, {
      glance: glance.ok ? glance.data : model.glance,
      waiting: waiting.ok ? waiting.data : model.waiting,
      work: work.ok ? work.data : model.work,
    });
    model.count = waitingCards(model.waiting).length;
    return set(model.allStop ? 'stopped' : 'live');
  }

  // One look: a signed watch, whose answer says whether this key is paired, then a read when the desk says
  // something changed. An answer that doesn't say (a helper from before pairing was reported) is not known: the last
  // state stays and nothing is sent.
  async function tick() {
    if (run.busy) return;
    run.busy = true;
    try {
      if (key.unavailable) return set('unpaired', { says: key.unavailable });
      const project = projectNow();
      if (project === null) return set('no-helper', { says: typeof folder === 'string' ? SAYS['no-project'] : SAYS['no-helper'] });
      const desk = deskFor(project);
      const got = await desk.watch(run.cursor);
      if (got.down === true) { run.askedUp = false; return set('no-helper'); }
      if (got.update === true) return set('update');
      if (got.ok !== true) return set('no-helper', { says: got.refused });
      if (got.paired === undefined) return undefined;
      if (got.paired !== true) {
        run.cursor = null;
        if (run.pending) return set('pairing');
        if (!run.askedUp) { await pair(); return undefined; }
        return set('unpaired');
      }
      run.pending = false;
      const events = Array.isArray(got.events) ? got.events : [];
      for (const event of events) {
        if (event?.type === 'all-stop') model.allStop = event.on === true;
        if (event?.type === 'notice' && typeof event.id === 'string') model.notices = [...model.notices.filter((n) => n.id !== event.id), { id: event.id, lines: event.lines }];
      }
      const first = run.cursor === null || model.state === 'pairing' || model.state === 'unpaired' || model.state === 'no-helper' || model.state === 'update';
      run.cursor = typeof got.cursor === 'string' ? got.cursor : run.cursor;
      if (events.length > 0 || first) await readViews(desk);
      return undefined;
    } catch {
      return set('no-helper');
    } finally {
      run.busy = false;
    }
  }

  // The panel's one door to the desk. Every message the page posts goes to press(), which takes it only with the
  // latest draw's nonce, only for a known act, and only for a card that is still waiting as drawn. The helper's
  // own words are shown when it refuses.
  async function onPaneMessage(message) {
    const project = projectNow();
    if (project === null || app === null) return;
    const out = await press(message, { latestNonce: nonces.latest(), client: deskFor(project), waiting: waitingCards(model.waiting), app });
    if (out.act === 'pair' && out.got !== undefined) {
      run.askedUp = true;
      paired(out.got);
      return;
    }
    if (typeof out.says === 'string' && out.says !== '') {
      try { await vscode.window.showInformationMessage?.(out.says); } catch { /* The next look shows the panel as it is. */ }
    }
    if (out.ok === true) await tick();
  }

  const every = deps.every ?? ((fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return { dispose: () => clearInterval(t) }; });
  const start = () => {
    if (run.timer !== null) return;
    run.timer = every(tick, WATCH_MS);
    run.loops += 1;
    tick();
  };
  const stop = () => {
    run.timer?.dispose();
    run.timer = null;
    // Nothing is watched now, so the status bar shows no count that could be old.
    model.looked = false;
    item.text = statusText(model);
  };

  context.subscriptions?.push(vscode.commands.registerCommand('wheelhouse.openPanel', async () => {
    await vscode.commands.executeCommand('wheelhouse.panel.focus');
  }));
  context.subscriptions?.push(vscode.window.registerWebviewViewProvider(PANEL_ID, {
    resolveWebviewView(view) {
      run.view = view;
      // No file is loaded into the page: its one script and style are inline, under the nonce.
      view.webview.options = { enableScripts: true, localResourceRoots: [] };
      view.webview.onDidReceiveMessage?.((message) => onPaneMessage(message));
      view.onDidDispose?.(() => { if (run.view === view) { run.view = null; stop(); } });
      // Hidden, the page is gone (no retainContextWhenHidden), and the watch stops, so the panel stops being live.
      view.onDidChangeVisibility?.(() => {
        if (run.view !== view) return;
        if (view.visible === false) stop();
        else { draw(); start(); }
      });
      draw();
      if (view.visible !== false) start();
    },
  }, { webviewOptions: { retainContextWhenHidden: false } }));
  context.subscriptions?.push({ dispose: stop }, item);

  // What a test or the press guard (Part 5) reaches, handed out only when asked for: the extension's public API is
  // readable by every other extension, so nothing of the add-on's goes in it otherwise.
  return deps.expose ? { model, run, tick, pair, draw, key, statusItem: item } : undefined;
}

function deactivate() {}

module.exports = { activate, deactivate, OPEN_PANEL, PANEL_ID, WATCH_MS, statusText };
