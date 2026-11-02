// vscode/extension.cjs
// The Wheelhouse add-on for VS Code: the pane and the status bar, drawn from the desk's pane model. CommonJS at its
// edge; what it takes from Wheelhouse's scripts it loads with dynamic import() (desk.cjs). VS Code is a parameter,
// so tests give it a stand-in; `require('vscode')` is only the default.
//
// It registers one command, wheelhouse.openPane, and nothing else that could press (scripts/addon/validate.js).
'use strict';

const { renderPane, statusText } = require('./pane/render.js');
const { makeNonces } = require('./nonce.cjs');
const desks = require('./desk.cjs');

const OPEN_PANE = 'wheelhouse.openPane';
const PANE_ID = 'wheelhouse.pane';
const OFFER_KEY = 'wheelhouse.offerShown';
// How often the add-on looks again when the desk has nothing new, as the mod's tick.
const TICK_MS = 15000;
// The most often it starts a helper that isn't answering.
const START_EVERY_MS = 60000;

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

async function activate(context, { vscode = require('vscode'), deps = {} } = {}) {
  const folder = vscode.workspace?.workspaceFolders?.[0]?.uri?.fsPath;
  const root = desks.wheelhouseRoot(context.extensionPath ?? '');
  const real = deps.desk !== undefined ? {} : await desks.realDeps({ root, cwd: folder }).catch(() => ({}));
  const desk = deps.desk ?? real.desk ?? null;
  const ask = deps.ask ?? real.ask ?? (async () => false);
  const node = deps.node !== undefined ? deps.node : desks.findNode();
  const startHelper = deps.startHelper ?? (() => desks.startHelperIfNeeded({ ask, node, root }));

  const nonces = makeNonces({ bytes: deps.nonceBytes ?? 32 });
  const state = { last: null, notice: null, view: 'main', settings: null, briefing: '', offerPending: false, current: null, startedAt: 0, stopped: false };

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = OPEN_PANE;
  item.text = statusText(null);
  item.show();

  // Draws the pane again, with a new nonce: whatever the old page posts after this counts for nothing.
  function draw() {
    item.text = statusText(state.last);
    if (state.current === null) return;
    const offer = state.offerPending;
    state.offerPending = false;
    state.current.webview.html = renderPane(state.last, {
      nonce: nonces.renew(), view: state.view, settings: state.settings, briefing: state.briefing, notice: state.notice, offer,
    });
  }

  // Reads the pane model from the desk. When nothing answers the last view stays, with the reason above it.
  async function refresh() {
    let helperUp = true;
    try {
      helperUp = await ask();
      if (!helperUp && Date.now() - state.startedAt > START_EVERY_MS) {
        state.startedAt = Date.now();
        await startHelper();
        helperUp = await ask();
      }
    } catch {
      helperUp = false;
    }
    let got = null;
    try {
      got = desk === null ? null : await desk.read('glance', { pane: true, helperUp, at: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    } catch {
      got = null;
    }
    if (got?.ok === true && got.data?.pane !== null && typeof got.data?.pane === 'object') {
      state.last = got.data.pane;
      state.notice = null;
    } else {
      state.notice = (state.last === null ? desks.NOTHING_READ : desks.HELPER_DOWN) + (node === null && !helperUp ? desks.NO_NODE : '');
    }
    draw();
  }

  const add = { refresh, draw, state, nonces, vscode, desk, ask };
  context.subscriptions?.push(vscode.commands.registerCommand('wheelhouse.openPane', async () => {
    await vscode.commands.executeCommand(`${PANE_ID}.focus`);
  }));
  context.subscriptions?.push(vscode.window.registerWebviewViewProvider(PANE_ID, {
    resolveWebviewView(view) {
      state.current = view;
      view.webview.options = { enableScripts: true };
      view.onDidDispose?.(() => { if (state.current === view) { state.current = null; nonces.clear(); } });
      if (deps.onView) deps.onView(view, add);
      draw();
    },
  }));

  // The first-run offer, once: the pane carries the picture of the drag (render.js) on its first draw after it.
  if (context.globalState && !context.globalState.get(OFFER_KEY, false)) {
    await context.globalState.update(OFFER_KEY, true);
    state.offerPending = true;
    vscode.window.showInformationMessage('Put Wheelhouse on the right: drag its wheel to the right-hand side of the window, and VS Code will remember it.', 'Show me how')
      ?.then?.((picked) => { if (picked) return vscode.commands.executeCommand(`${PANE_ID}.focus`); return undefined; });
  }

  try { await deps.versions?.({ vscode, add }); } catch { /* The versions file is a record, not a need. */ }
  try { await startHelper(); } catch { /* The pane says the helper isn't running. */ }
  await refresh();

  // Redraws when the desk says something changed, and looks again every tick when it says nothing.
  if (deps.loop !== false && desk !== null) {
    context.subscriptions?.push({ dispose() { state.stopped = true; } });
    (async () => {
      let cursor = null;
      while (!state.stopped) {
        let got = null;
        try { got = await desk.watch(cursor); } catch { got = null; }
        if (got?.ok === true && typeof got.cursor === 'string' && got.cursor !== cursor) {
          cursor = got.cursor;
          await refresh();
        } else {
          await pause(TICK_MS);
          if (!(got?.ok === true)) await refresh();
        }
      }
    })();
  }
  return add;
}

function deactivate() {}

module.exports = { activate, deactivate, OPEN_PANE, PANE_ID };
