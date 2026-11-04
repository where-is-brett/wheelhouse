// vscode/extension.cjs
// The Wheelhouse add-on for VS Code: the pane and the status bar, drawn from the desk's pane model. CommonJS at its
// edge; what it takes from Wheelhouse's scripts it loads with dynamic import() (desk.cjs). VS Code is a parameter,
// so tests give it a stand-in; `require('vscode')` is only the default.
//
// It registers one command, wheelhouse.openPane, and nothing else that could press (scripts/addon/validate.js).
'use strict';

const crypto = require('node:crypto');
const { renderPane, statusText, waitingCards } = require('./pane/render.js');
const { makeNonces } = require('./nonce.cjs');
const { onPaneMessage } = require('./press.cjs');
const { writeVersions, watchVersions } = require('./versions.cjs');
const desks = require('./desk.cjs');
const leans = require('./lean.cjs');
const chat = require('./chat-tools.cjs');

const OPEN_PANE = 'wheelhouse.openPane';
const PANE_ID = 'wheelhouse.pane';
const OFFER_KEY = 'wheelhouse.offerShown';
// The secondary side bar's chat container, where the first-run offer moves the pane (check 67).
const CHAT_CONTAINER = 'workbench.panel.chat';
const OFFER = 'Put Wheelhouse on the right';
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
  const state = { last: null, notice: null, view: 'main', at: 0, pressing: null, answered: null, settings: null, briefing: '', offerPending: false, current: null, startedAt: 0, stopped: false, visibleAt: null, window: crypto.randomBytes(16).toString('hex') };

  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = OPEN_PANE;
  item.text = statusText(null);
  item.show();

  // Draws the pane again, with a new nonce: whatever the old page posts after this counts for nothing.
  function draw(force = false) {
    item.text = statusText(state.last);
    // A hidden pane is not drawn: showing it again draws it, with a new nonce.
    if (state.current === null || state.current.visible === false) return;
    // Nothing drawn again when nothing changed, so what the director is typing or has open stays, and the nonce with it.
    const key = JSON.stringify([state.last, state.notice, state.view, state.settings, state.briefing, state.at, state.pressing, state.answered]);
    if (!force && key === state.drawn && !state.offerPending) return;
    state.drawn = key;
    const offer = state.offerPending;
    state.offerPending = false;
    state.current.webview.html = renderPane(state.last, {
      nonce: nonces.renew(), view: state.view, settings: state.settings, briefing: state.briefing, notice: state.notice, offer, at: state.at, recording: state.pressing, answered: state.answered,
      trusted: trusted(),
    });
  }

  // Whether the open folder is trusted. Unknown counts as trusted only when VS Code says nothing at all.
  const trusted = () => vscode.workspace?.isTrusted !== false;

  // The mark that says a panel is live for this project (scripts/lib/vscode-pane.js): written on each tick and on a
  // change of visibility. `visible` moves only while the pane is on screen, so a hidden pane goes stale in 45 seconds.
  // Nothing is written for an untrusted folder, whose pane cannot answer a card. Never throws.
  function mark() {
    try {
      if (state.current === null || !trusted()) return;
      const project = typeof real.project === 'function' ? real.project() : deps.project ?? null;
      const panes = deps.vscodePane ?? real.vscodePane;
      if (typeof project !== 'string' || project === '' || !panes) return;
      const at = Date.now();
      if (state.current.visible !== false) state.visibleAt = at;
      panes.markVscodePane(project, { at, visible: state.visibleAt, window: state.window });
    } catch { /* The mark is a hint; a pane without one is simply not live. */ }
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
      // The line saying a press was counted stays until the model changes.
      if (JSON.stringify(got.data.pane) !== JSON.stringify(state.last)) state.answered = null;
      state.last = got.data.pane;
      state.notice = null;
    } else {
      state.notice = (state.last === null ? desks.NOTHING_READ : desks.HELPER_DOWN) + (node === null && !helperUp ? desks.NO_NODE : '');
    }
    draw();
    mark();
  }

  // What the press needs, gathered for each message so the project and STOP are read as they are now.
  // Moves the pane into the secondary side bar's chat container and shows it. VS Code keeps the place (check 67).
  const movePane = async () => {
    await vscode.commands.executeCommand('vscode.moveViews', { viewIds: [PANE_ID], destinationId: CHAT_CONTAINER });
    await vscode.commands.executeCommand(`${PANE_ID}.focus`);
  };
  const pressDeps = () => ({
    nonces,
    project: typeof real.project === 'function' ? real.project() : deps.project ?? null,
    cwd: folder,
    model: () => state.last,
    press: deps.press ?? real.press ?? {},
    desk,
    client: deps.client ?? real.client,
    notify: async (message) => { vscode.window.showInformationMessage(message); },
    open: async (address) => { await vscode.env.openExternal(vscode.Uri.parse(address)); },
    redraw: refresh,
    marking: async (id) => { state.pressing = typeof id === 'string' ? id : null; draw(); },
    step: async (by) => {
      const last = Math.max(0, waitingCards(state.last).length - 1);
      state.at = Math.min(last, Math.max(0, Math.min(state.at, last) + by));
      draw();
    },
    answered: async (notice) => {
      vscode.window.showInformationMessage(notice);
      state.answered = notice;
      draw();
    },
    show: async (view, data) => {
      state.view = view;
      if (data.settings !== undefined) state.settings = data.settings;
      if (data.briefing !== undefined) state.briefing = data.briefing;
      draw();
    },
    refreshSettings: async () => { if (state.view === 'settings') state.settings = await settingsView(); },
    settingsView,
    stopState: deps.stopState ?? real.stopState ?? (() => ({ on: false })),
    stop: deps.stop ?? real.stop ?? null,
    liftQuestion: deps.liftQuestion ?? real.liftQuestion,
    timeZone: real.timeZone,
    now: () => new Date(),
    cancelChat: chat.cancelChatRequest,
    move: movePane,
  });
  const settingsView = async () => (deps.settingsView ?? real.settingsView)?.() ?? { groups: [] };

  const add = { refresh, draw, state, nonces, vscode, desk, ask };
  context.subscriptions?.push(vscode.commands.registerCommand('wheelhouse.openPane', async () => {
    await vscode.commands.executeCommand(`${PANE_ID}.focus`);
  }));
  context.subscriptions?.push(vscode.window.registerWebviewViewProvider(PANE_ID, {
    resolveWebviewView(view) {
      state.current = view;
      // No file is loaded into the page: its one script and style are inline, under the nonce.
      view.webview.options = { enableScripts: true, localResourceRoots: [] };
      view.onDidDispose?.(() => { if (state.current === view) { state.current = null; nonces.clear(); } });
      // Nothing is retained while hidden (no retainContextWhenHidden), so the page drawn before is gone: its nonce
      // counts for nothing from the moment the pane hides, and showing it draws a new page with a new nonce.
      view.onDidChangeVisibility?.(() => {
        if (state.current !== view) return;
        if (view.visible === false) nonces.clear();
        else draw(true);
        mark();
      });
      view.webview.onDidReceiveMessage((message) => onPaneMessage(message, pressDeps()));
      if (deps.onView) deps.onView(view, add);
      draw(true);
    },
  }));

  // The first-run offer, once: the pane carries its button (render.js) on its first draw after it, and the message
  // here carries the same button. Either moves the pane beside the chat, where VS Code keeps it.
  if (context.globalState && !context.globalState.get(OFFER_KEY, false)) {
    await context.globalState.update(OFFER_KEY, true);
    state.offerPending = true;
    vscode.window.showInformationMessage(`${OFFER}: it sits beside the chat, and VS Code remembers it.`, OFFER)
      ?.then?.((picked) => { if (picked === OFFER) return movePane(); return undefined; });
  }

  // VS Code's versions and its Copilot runtime's, kept in the file the session start reads.
  try {
    const file = deps.versionsFile ?? real.versionsFile;
    if (deps.versions) await deps.versions({ vscode, add });
    else if (file) {
      await writeVersions({ vscode, file });
      const watching = watchVersions({ vscode, file });
      if (watching) context.subscriptions?.push(watching);
    }
  } catch { /* The versions file is a record, not a need. */ }
  try { await startHelper(); } catch { /* The pane says the helper isn't running. */ }
  // Where no Node.js runs, a Lean project's helper runs in this process (switched off until ADDON_LEAN_READY), and stops with it.
  if (node === null) {
    try {
      const running = await (deps.startLean ?? ((o) => leans.startLean({ ...o, root })))({
        address: deps.address ?? real.address, isLean: deps.isLean ?? real.isLean?.() ?? false, node,
      });
      if (running) context.subscriptions?.push({ dispose() { running.stop?.(); } });
    } catch { /* The pane says the helper isn't running. */ }
  }
  // The chat's way in (chat-tools.cjs): two tools that bind nothing, the inbox where tools are switched off, and the
  // terminal commands recorded. The project is read afresh each time, and nothing here can press.
  try {
    const projectNow = () => (typeof real.project === 'function' ? real.project() : deps.project ?? null);
    const clientNow = deps.client ?? real.client;
    const loaded = deps.chatRules !== undefined ? {} : await chat.loadRules(root);
    const rules = deps.chatRules ?? loaded.rules;
    const scan = deps.scanText ?? loaded.scan;
    chat.registerChatTools({ vscode, client: clientNow, desk, project: projectNow, folder, subscriptions: context.subscriptions, rules, panel: deps.chatPanel ?? loaded.panel });
    if (typeof folder === 'string') {
      const file = deps.commandsFile ?? real.commandsFile;
      const terminal = chat.watchTerminal({ vscode, record: (line) => chat.commandFile(file?.(), { scan })(line) });
      if (terminal) context.subscriptions?.push(terminal);
      if (clientNow) {
        const drain = () => chat.drainInbox({ folder, client: clientNow, project: projectNow(), rules }).catch(() => null);
        drain();
        const timer = setInterval(drain, 5000);
        timer.unref?.();
        context.subscriptions?.push({ dispose() { clearInterval(timer); } });
      }
    }
  } catch { /* The chat's way in is an extra; the pane does not need it. */ }
  await refresh();

  // The mark renews on its own timer, whatever the desk loop does (it may be idle, or there may be no desk), so a
  // quiet visible pane stays live.
  if (deps.loop !== false) {
    const markTimer = setInterval(mark, TICK_MS);
    markTimer.unref?.();
    context.subscriptions?.push({ dispose() { clearInterval(markTimer); } });
  }

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
  // What activate returns is the extension's public API, readable by every other extension: nothing of the add-on's inside
  // it unless a test asks (scripts/addon/validate.js).
  return deps.expose ? add : undefined;
}

function deactivate() {}

module.exports = { activate, deactivate, OPEN_PANE, PANE_ID };
