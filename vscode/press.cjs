// vscode/press.cjs
// What the add-on does with a message from its pane. This is the only way a binding click is made here: the pane's
// buttons post a message; nothing else (no command, address, chat tool or other message) reaches a press
// (scripts/addon/validate.js checks it, and tests/vscode/press.test.js).
//
// A message counts only with the nonce of the pane's latest draw (nonce.cjs). A deciding choice calls the mod's
// pressCard with the proof `add-on`: it signs here, in VS Code's own process, with this computer's key, and acts
// through the desk with the signed record as its evidence. The helper is never asked to sign. A typed "yes" in the
// chat never counts, so nothing here reads the chat.
'use strict';

const fs = require('node:fs');

const OPEN_VIEWS = ['main', 'board', 'settings', 'briefing'];
const LIFT_LABEL = 'Lift STOP';
const CHANGED = 'That changed while you were looking: look at the pane again';
const NO_PROJECT = 'Wheelhouse isn\'t set up in this folder';
const HAND_ON = 'Noted. Tell the First Mate in the chat to carry on with it.';
// The longest a suggestion the pane sends may be, before the press cuts it.
const WORDS_CHARS = 4000;

async function onPaneMessage(msg, deps) {
  const no = (says) => ({ made: false, ...(typeof says === 'string' ? { says } : {}) });
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return no();
  if (!deps.nonces.matches(msg.nonce)) return no();

  const words = (value) => (typeof value === 'string' ? value : '');
  const type = words(msg.type);
  const project = typeof deps.project === 'string' && deps.project !== '' ? deps.project : null;
  const say = async (out) => {
    if (typeof out?.says === 'string' && out.says !== '') await deps.notify(out.says);
    else if (out?.made === false) await deps.notify(CHANGED);
    return out;
  };
  const again = async () => { try { await deps.redraw(); } catch { /* The next tick draws it. */ } };
  const call = { project, client: deps.client, desk: deps.desk, now: deps.now, stopState: deps.stopState };

  try {
    if (type === 'press') {
      if (project === null) return say(no(NO_PROJECT));
      const [card, hash, choice] = [words(msg.card), words(msg.hash), words(msg.choice)];
      if (card === '' || hash === '' || choice === '') return no();
      const out = await deps.press.pressCard({ ...call, card, hash, label: choice, liftStop: deps.stop.liftStop, proof: 'add-on' });
      await say(out?.made === true && Array.isArray(out.submit) && out.submit.length > 0 ? { ...out, says: `${out.says ?? 'Recorded.'} ${HAND_ON}` } : out);
      await again();
      return { made: out?.made === true, ...(typeof out?.says === 'string' ? { says: out.says } : {}) };
    }

    if (type === 'why') {
      if (project === null) return no();
      const out = await deps.press.whyCard({ ...call, card: words(msg.card), hash: words(msg.hash) });
      return { made: out?.made === true };
    }

    if (type === 'suggest') {
      if (project === null) return say(no(NO_PROJECT));
      const out = await deps.press.suggestCard({ ...call, card: words(msg.card), hash: words(msg.hash), words: words(msg.words).slice(0, WORDS_CHARS) });
      await say(out?.made === true && Array.isArray(out.submit) && out.submit.length > 0 ? { ...out, says: `${out.says ?? 'Sent.'} ${HAND_ON}` } : out);
      return { made: out?.made === true };
    }

    if (type === 'setting') {
      if (project === null) return say(no(NO_PROJECT));
      const out = await deps.press.pressSetting({ ...call, key: words(msg.key), choice: words(msg.choice), timeZone: deps.timeZone });
      await say(out);
      await deps.refreshSettings?.();
      await again();
      return { made: out?.made === true };
    }

    if (type === 'stop') {
      // Set here first, then told to the desk: the desk is waited on for a moment at most, so a helper that doesn't answer
      // never holds All stop up. Needs no evidence.
      let here = true;
      try { deps.stop.setStop({ by: 'mod', now: deps.now }); } catch { here = false; }
      const told = Promise.resolve().then(() => deps.desk.act('all-stop', { by: 'mod' })).catch(() => null);
      let timer;
      if (here) await Promise.race([told, new Promise((resolve) => { timer = setTimeout(resolve, deps.stopDeskMs ?? 3000); })]);
      else if ((await told)?.ok !== true) { deps.stop.setStop({ by: 'mod', now: deps.now }); }
      clearTimeout(timer);
      await deps.notify('All stop is on. Every agent is stopped, and nothing moves until you say.');
      await again();
      return { made: true };
    }

    if (type === 'lift') {
      // A binding press: signed here, for the STOP the pane drew and no other, then the desk lifts it with the record.
      const stop = deps.stopState();
      if (stop?.on !== true) return { made: true, says: 'All stop is off.' };
      if (project === null) return say(no(NO_PROJECT));
      const since = words(msg.since);
      if (since === '' || stop.at !== since) return say(no(CHANGED));
      const got = { made: { kind: 'action', data: { action: 'lift-stop', question: deps.liftQuestion, label: LIFT_LABEL } }, lift: true };
      let lifting = false;
      let kept;
      try {
        kept = deps.press.keepEarned(project, got, { now: deps.now, liftStop: () => { lifting = true; deps.stop.liftStop(); }, proof: 'add-on' });
      } catch {
        return say(no(lifting ? 'All stop couldn\'t be lifted, so nothing was recorded' : 'Wheelhouse couldn\'t sign that here, so nothing was recorded'));
      }
      const lifted = await deps.desk.act('lift-all-stop', {}, { form: 'signed', records: deps.press.signedRecords(kept) });
      if (lifted?.ok !== true) {
        try { await deps.press.sendKept(deps.client, (sending) => sending, kept); } catch { /* Kept for the next start to send. */ }
      } else {
        fs.rmSync(kept.file, { force: true });
      }
      await deps.notify('All stop is off.');
      await again();
      return { made: true };
    }

    if (type === 'view') {
      const view = words(msg.view);
      if (!OPEN_VIEWS.includes(view)) return no();
      if (view === 'briefing') {
        const given = await deps.press.digestText({ cwd: deps.cwd, now: deps.now, client: deps.client });
        await deps.show('briefing', { briefing: words(given?.text) });
      } else if (view === 'settings') {
        await deps.show('settings', { settings: await deps.settingsView?.() });
      } else {
        await deps.show(view, {});
      }
      return { made: true };
    }

    if (type === 'open') {
      // The address is the one the pane's card carries in the model the add-on drew, never one the message names.
      const card = (deps.model()?.cards ?? []).find((c) => c?.id === words(msg.card));
      const href = (Array.isArray(card?.buttons) ? card.buttons : []).find((b) => b?.shape === 'link' && typeof b.href === 'string')?.href;
      if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return no();
      await deps.open(href);
      return { made: true };
    }

    if (type === 'pull') {
      const out = await deps.desk.act('pull-cards', {});
      await again();
      return { made: out?.ok === true };
    }

    if (type === 'move') {
      await deps.move?.();
      return { made: true };
    }
  } catch {
    return no('That didn\'t go through; nothing was recorded');
  }
  return no();
}

module.exports = { onPaneMessage };
