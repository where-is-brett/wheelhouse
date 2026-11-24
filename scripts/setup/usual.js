// scripts/setup/usual.js
// The director's usual answers (builders and settings design, section 12): step 3's host, GitLab address, git route and
// connection, kept once per computer as profile settings (`usual.<name>:<computer>`, scripts/settings/catalogue.js) and
// offered when setup runs again. Two cards: "Use your usual setup?" first, and "Keep these as your usual on this computer?"
// once step 3's list is made, only when the answers differ from the usual or none are kept.
//
// "Use my usual" takes each question the usual answers as chosen, marked `from: 'usual'`; the checks still run, since the host
// is still reached and the builders' sign-in is still proved. "Choose each" asks as before, with the usual answer recommended.
// Saving is a signed profile change, as the route's is (scripts/setup/builders-ask.js), never a write of the file.
//
// This file never names a repository: what is usual is what differs by the director, never by the project.
import { USUAL, USUAL_NAMES, isAllowed, usualKey } from '../settings/catalogue.js';
import { settingWords } from '../settings/effective.js';

export const USUAL_ID = 'usual';
export const KEEP_ID = 'keep-usual';
export const USE_USUAL = 'Use my usual';
export const CHOOSE_EACH = 'Choose each';
export const KEEP_THEM = 'Keep them';
// Not "Not now": the card composer refuses that label on a question card, as a button that puts a card off.
export const DONT_KEEP = 'Don\'t keep them';
// The most questions "Use my usual" takes in one plan: far more than step 3 asks, so a fault can't loop.
export const MOST_TAKEN = 12;

const settingsOf = (views) => (views?.settings !== null && typeof views?.settings === 'object' ? views.settings : {});

// The usual answers this computer keeps, accepted or not yet confirmed counting as not kept: { host, gitlabBase, gitRoute,
// connection }, each a value or undefined. A value the catalogue refuses reads as none.
export function usualOf(views, computer) {
  const held = settingsOf(views);
  const out = {};
  for (const name of USUAL_NAMES) {
    const value = held[usualKey(name, computer)]?.value;
    if (value !== undefined && value !== null && isAllowed(usualKey(name, computer), value)) out[name] = value;
  }
  return out;
}

export const hasUsual = (usual) => USUAL_NAMES.some((name) => usual?.[name] !== undefined);

// The usual answers in words, for the card: "GitLab at the address you used before · your own git · phone notices · builders in
// Claude Desktop". The route and the phone notices are kept by their own settings and told here only when they are kept.
export function usualWords(usual, views, computer) {
  const held = settingsOf(views);
  const parts = [];
  if (usual.host === 'gitlab') parts.push(usual.gitlabBase === undefined ? 'GitLab' : 'GitLab at the address you used before');
  else if (usual.host !== undefined) parts.push(USUAL.host.say(usual.host));
  if (usual.gitRoute !== undefined) parts.push(USUAL.gitRoute.say(usual.gitRoute));
  if (usual.connection !== undefined) parts.push(USUAL.connection.say(usual.connection));
  const channels = held.notifications?.value?.channels;
  if (Array.isArray(channels) && channels.some((c) => c === 'ntfy' || c === 'telegram')) parts.push('phone notices');
  const route = held[`builders:${computer}`]?.value;
  if (route === 'desktop') parts.push('builders in Claude Desktop');
  else if (route === 'background') parts.push('builders in the background');
  return parts.join(' · ');
}

// Step 3's first card, once at least one usual answer is kept.
export function usualAsk(words) {
  return {
    id: USUAL_ID,
    card: {
      level: 2,
      what: `Use your usual setup? Your usual on this computer: ${words}.`,
      why: 'You chose these on this computer before. Taking them skips those questions; setup still reaches the host and still proves that builders can sign in.',
      options: [
        { label: USE_USUAL, says: 'Each answer is recorded as if you had chosen it, marked as your usual.' },
        { label: CHOOSE_EACH, says: 'Setup asks each question as it does for a first project, with your usual answer recommended.' },
      ],
      recommend: USE_USUAL,
      because: 'it is what you chose last time, and nothing about this project changes it',
      meanwhile: 'Nothing is changed until your Go ahead.',
    },
  };
}

// What a question's card takes from the usual answers, given the labels step 3's cards use: { label } or { label: null, text } for
// a typed answer, or null where the usual says nothing about this question or the card lacks that way. `labels` is
// { keepHere, github, gitlab, gitlabCom, gitlabComBase, company, own, wheelhouse, asIs }. A company's GitLab is taken as
// host.js asks it: "My company's GitLab" on the which-GitLab card, then its address typed on the address card after it. Where the
// folder already sends its work to a GitLab (`fromFolder` on the card), that is the project's own answer, so the usual takes no
// part in it.
export function usualAnswerFor(ask, usual, labels) {
  const id = ask?.id;
  const options = ask?.card?.options;
  if (typeof id !== 'string' || !Array.isArray(options) || ask.carried !== undefined) return null;
  const has = (label) => options.some((o) => o.label === label);
  if (id === 'host') {
    const label = { local: labels.keepHere, github: labels.github, gitlab: labels.gitlab }[usual.host];
    return label !== undefined && has(label) ? { label } : null;
  }
  if (id === 'gitlab-where') {
    if (usual.gitlabBase === undefined || ask.fromFolder === true) return null;
    const label = usual.gitlabBase === labels.gitlabComBase ? labels.gitlabCom : labels.company;
    return has(label) ? { label } : null;
  }
  if (id === 'gitlab-address-1') {
    return usual.gitlabBase === undefined || usual.gitlabBase === labels.gitlabComBase ? null : { label: null, text: usual.gitlabBase };
  }
  if (id.startsWith('connection-') && !id.startsWith('connection-stricter-')) {
    // The git route first: "Use my git as it is" is the usual only where the card offers it; Wheelhouse's own route takes the
    // usual connection.
    if (usual.gitRoute === 'own' && has(labels.asIs)) return { label: labels.asIs };
    const way = usual.connection === 'own-app' ? labels.own : usual.connection === 'wheelhouse-app' ? labels.wheelhouse : undefined;
    return way !== undefined && has(way) ? { label: way } : null;
  }
  return null;
}

// The usual answers a step 3 list makes, from its connection change (scripts/setup/host.js): { host, gitlabBase?, gitRoute?,
// connection? }. A way the usual can't hold (Quick, a project's own key) is left out, never guessed.
export function usualFromChanges(changes, defaultBase) {
  const c = (Array.isArray(changes) ? changes : []).find((x) => x?.action === 'connection');
  if (!c || typeof c.target !== 'string') return {};
  const out = { host: c.target };
  if (c.target === 'local') return out;
  if (c.target === 'gitlab') out.gitlabBase = typeof c.base === 'string' ? c.base : defaultBase;
  if (c.mode === 'as-is') out.gitRoute = 'own';
  else if (c.mode === 'narrow' || c.mode === 'quick') out.gitRoute = 'wheelhouse';
  if (c.mode === 'narrow' && c.target === 'github' && c.app) out.connection = c.app.own === true ? 'own-app' : 'wheelhouse-app';
  return out;
}

// The names whose answer differs from the usual kept (or is kept for the first time).
export const differs = (now, usual) => USUAL_NAMES.filter((name) => now[name] !== undefined && now[name] !== usual?.[name]);

export function keepAsk(names, now) {
  const lines = names.map((name) => `${USUAL[name].label}: ${USUAL[name].say(now[name])}`).join('; ');
  return {
    id: KEEP_ID,
    card: {
      level: 2,
      what: `Keep these as your usual on this computer? ${lines}.`,
      why: 'Next time setup runs on this computer it can offer them as your usual, so you click once instead of answering each. Other projects keep their own answers; nothing is shared with another computer.',
      options: [
        { label: KEEP_THEM, says: 'Saved in your settings on this computer, with your Confirm like any setting.' },
        { label: DONT_KEEP, says: 'Nothing is saved, and setup asks again next time.' },
      ],
      recommend: KEEP_THEM,
      because: 'it saves you the same questions on the next project',
      meanwhile: 'Nothing else waits on it.',
    },
  };
}

// The usual answers saved, through `profile` (own-app.js's helperProfile, a signed event the director confirms), when the
// director chose to keep them. Nothing is written for an answer already kept or already waiting for its Confirm. Gives the
// settings written.
export async function saveUsual({ answers, changes, profile, computer, defaultBase }) {
  if (answers?.[`3.${KEEP_ID}`]?.label !== KEEP_THEM) return [];
  const now = usualFromChanges(changes, defaultBase);
  const views = await profile.views();
  const waiting = Array.isArray(views?.unconfirmed) ? views.unconfirmed : [];
  const written = [];
  for (const name of USUAL_NAMES) {
    if (now[name] === undefined) continue;
    const key = usualKey(name, computer);
    const mine = waiting.filter((u) => u?.kind === 'setting' && (u.key ?? u.data?.key) === key);
    const newest = mine.length > 0 ? mine.at(-1).data?.value : views?.settings?.[key]?.value;
    if (newest === now[name]) continue;
    const got = await profile.write({ kind: 'setting', data: { key, value: now[name], words: settingWords(key, now[name]) } });
    if (got?.ok !== true) throw new Error(`Your usual answers could not be saved in your settings on this computer: ${got?.why ?? got?.refused ?? 'the helper did not say why'}`);
    written.push({ key, value: now[name] });
  }
  return written;
}

// Step 3's plan with the usual answers laid over it. `plan(ctx)` is the step's own plan. Returns what it returns, with: the
// "Use your usual setup?" card first when a usual is kept; each question the usual answers taken as chosen while "Use my usual"
// stands, marked `from: 'usual'` in the answers the plan reads; the usual recommended on each card after "Choose each"; and
// the keep card once the list is made and its answers differ from the usual.
export async function planWithUsual({ plan, ctx, views, computer, labels, defaultBase }) {
  let kept = null;
  try { kept = views(); } catch { /* settings that can't be read keep no usual: step 3 asks as it does for a first project */ }
  const usual = usualOf(kept, computer);
  const answers = ctx.answers ?? {};
  const chose = answers[`3.${USUAL_ID}`] ?? null;
  const known = hasUsual(usual);
  if (known && (chose === null || ![USE_USUAL, CHOOSE_EACH].includes(chose.label))) return { ask: usualAsk(usualWords(usual, kept, computer)) };
  const taking = known && chose.label === USE_USUAL;
  let current = answers;
  for (let n = 0; n <= MOST_TAKEN; n += 1) {
    const got = await plan({ ...ctx, answers: current });
    if (got?.ask) {
      const taken = taking && current[`3.${got.ask.id}`] === undefined ? usualAnswerFor(got.ask, usual, labels) : null;
      // A look at the choices (the one card, Customise) lists each question the usual answers, as the usual answers it, so the
      // one card has a line for each and its Go ahead stands for them; the run then reads them as given.
      if (taken !== null && ctx.choicesOnly === true) {
        const card = typeof taken.label === 'string' ? { ...got.ask.card, recommend: taken.label, because: 'it is your usual on this computer' } : got.ask.card;
        return { ...got, ask: { ...got.ask, usual: { label: taken.label, text: taken.text ?? null }, card } };
      }
      if (taken !== null && n < MOST_TAKEN) {
        current = { ...current, [`3.${got.ask.id}`]: { label: taken.label, text: taken.text ?? null, at: chose.at, from: 'usual' } };
        continue;
      }
      if (known && !taking) {
        const mine = usualAnswerFor(got.ask, usual, labels);
        const card = got.ask.card;
        if (mine !== null && typeof mine.label === 'string' && card.recommend !== mine.label) {
          return { ...got, ask: { ...got.ask, card: { ...card, recommend: mine.label, because: 'it is your usual on this computer' } } };
        }
      }
      return got;
    }
    if (Array.isArray(got?.changes) && ctx.choicesOnly !== true) {
      const now = usualFromChanges(got.changes, defaultBase);
      const names = differs(now, usual);
      const said = answers[`3.${KEEP_ID}`] ?? null;
      if (names.length > 0 && (said === null || ![KEEP_THEM, DONT_KEEP].includes(said.label))) return { ask: keepAsk(names, now) };
    }
    return got;
  }
  return { wait: 0, why: 'step 3 asked more questions than it has' };
}
