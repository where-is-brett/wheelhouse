// scripts/setup/builders-ask.js
// Where builders start (builders and settings design, sections 6 and 10.1): the advanced question of step 3, how builder
// sessions start on this computer. What it offers follows where setup runs, read from CLAUDE_CODE_ENTRYPOINT: Desktop's value
// recommends Desktop; the terminal's offers the background only (a session in a terminal can't start Desktop sessions); any
// other value, or none, offers all three and says it can't tell.
//
// The answer is saved once per computer as the profile setting `builders:<computerId>`, through the helper's profile route like
// any setting whose home is the profile, and counts once the director confirms it. A computer whose route is saved, or waits
// for its Confirm, isn't asked again.
import crypto from 'node:crypto';
import { settingWords } from '../settings/effective.js';
import { canonicalJson } from '../lib/canonical.js';
import { checkLaunch, splitLaunch } from '../lib/launch-words.js';

export const BUILDERS_ID = 'builders';
export const LAUNCH_ID = 'builder-launch';
const OTHER = 'Type the command';
export const BUILDER_CHOICES = Object.freeze({
  desktop: 'In Claude Desktop (you\'ll see each one)',
  background: 'In the background',
  launch: 'In the background with a launch command',
});
const DESKTOP_VALUES = ['claude-desktop', 'claude-desktop-3p'];
// A terminal started from inside a Desktop session (a multiplexer such as tmux, or a remote shell) inherits the app's value,
// so these rule the app out, as the setup command reads it (scripts/setup/cli.js).
const TERMINAL_MARKERS = ['TMUX', 'STY', 'SSH_TTY', 'SSH_CONNECTION'];
const KINDS = ['desktop', 'terminal', 'unknown'];

// 'desktop', 'terminal' or 'unknown', from CLAUDE_CODE_ENTRYPOINT and the session's environment.
export function entrypointKind(value, env = {}) {
  if (typeof value !== 'string') return 'unknown';
  if (DESKTOP_VALUES.includes(value)) return TERMINAL_MARKERS.some((name) => typeof env?.[name] === 'string' && env[name] !== '') ? 'terminal' : 'desktop';
  return value === 'cli' ? 'terminal' : 'unknown';
}

// The question's card. `where` is entrypointKind's answer, as the setup command sends it; without one it is read from this
// process's own CLAUDE_CODE_ENTRYPOINT.
export function builderRouteAsk({ entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT, env = process.env, where: given } = {}) {
  const where = KINDS.includes(given) ? given : entrypointKind(entrypoint, env);
  const says = {
    [BUILDER_CHOICES.desktop]: 'The foreman\'s Claude Desktop session starts builders, signed in as Desktop is. They show in Desktop\'s sidebar.',
    [BUILDER_CHOICES.background]: 'Wheelhouse starts builders itself, with plain `claude`. It needs `claude` to be signed in on this computer.',
    [BUILDER_CHOICES.launch]: 'Wheelhouse starts builders through a command you give, such as a wrapper that sets a gateway. You type it on the next card.',
  };
  const labels = where === 'desktop' ? [BUILDER_CHOICES.desktop, BUILDER_CHOICES.background, BUILDER_CHOICES.launch]
    : where === 'terminal' ? [BUILDER_CHOICES.background, BUILDER_CHOICES.launch]
      : [BUILDER_CHOICES.background, BUILDER_CHOICES.desktop, BUILDER_CHOICES.launch];
  const recommend = where === 'desktop' ? BUILDER_CHOICES.desktop : BUILDER_CHOICES.background;
  const found = where === 'desktop' ? 'Setup is running in Claude Desktop.' : where === 'terminal' ? 'Setup is running in a terminal.'
    : "Wheelhouse can't tell whether setup is running in Claude Desktop or a terminal, so all three ways are offered.";
  return {
    id: BUILDERS_ID,
    card: {
      level: 2,
      what: `How should builders start on this computer? ${found}`,
      why: 'Builders are the sessions that do the work, and they must be signed in. Where they start decides whose sign-in they use.',
      options: labels.map((label) => ({ label, says: says[label] })),
      recommend,
      because: where === 'desktop' ? 'Desktop is already signed in and shows each builder' : 'plain `claude` is the one way every computer supports',
      meanwhile: 'Nothing runs until your Go ahead on the plan.',
    },
  };
}

// The route setting an answer to that question saves for this computer: { key, value }. The launch command is its own key,
// which the First Mate asks for; the answer names only the route.
export function builderRouteSetting(label, computer) {
  const value = label === BUILDER_CHOICES.desktop ? 'desktop' : label === BUILDER_CHOICES.background || label === BUILDER_CHOICES.launch ? 'background' : null;
  if (value === null) throw new Error(`This isn't an answer to where builders start: ${JSON.stringify(label)}`);
  return { key: `builders:${computer}`, value };
}

// Whether the profile's views hold a route for this computer, accepted or waiting for its Confirm.
export function routeKept(views, computer) {
  const key = `builders:${computer}`;
  const saved = views?.settings?.[key]?.value;
  if (saved !== null && saved !== undefined) return true;
  const waiting = Array.isArray(views?.unconfirmed) ? views.unconfirmed : [];
  return waiting.some((u) => u?.kind === 'setting' && (u.key ?? u.data?.key) === key);
}

// The launch command's card, a typed one (builders and settings design, sections 8.2 and 12.3): the director types the command as
// they would in a terminal, and Wheelhouse shows the words back before they are saved. `refused` says why the last try was not
// taken.
function launchAsk(id, refused) {
  return {
    id,
    typed: true,
    card: {
      level: 2,
      what: `${refused === undefined ? '' : `${refused} `}What command starts Claude Code on this computer?`,
      why: 'Type it as you would in a terminal, on one line: the program and its words, with spaces between them and double quotes around a word that has spaces. Wheelhouse never reads it as a script, and shows the words back to you before it keeps them.',
      options: [
        { label: OTHER, says: 'Choose Other and type the command, for example: wrap claude' },
        { label: 'Ask me later', says: 'Builders start with plain `claude` until you give the command in your settings.' },
      ],
      recommend: OTHER,
      because: 'a wrapper that sets your gateway has to be named for builders to sign in',
      meanwhile: 'Nothing runs until your Go ahead on the plan.',
    },
  };
}

const digestOf = (value) => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 10);

// What the launch command's answers say: `{ ask }` while one is open, `{ words }` once a typed command is split and checked, or
// `{ later: true }` when the director would rather give it later. A typed command that can't be used is asked again under a new
// id, saying why.
export function launchWords({ answer, check = checkLaunch, platform = process.platform }) {
  const tried = [];
  for (;;) {
    const id = tried.length === 0 ? LAUNCH_ID : `${LAUNCH_ID}-${digestOf(tried)}`;
    const got = answer(id);
    if (got === null || got === undefined) return { ask: launchAsk(id, tried.length === 0 ? undefined : tried.at(-1).why) };
    const typed = typeof got.text === 'string' ? got.text.trim() : '';
    if (typed === '') {
      if (got.label === 'Ask me later') return { later: true };
      tried.push({ typed: '', why: 'Choose Other and type the command.' });
      continue;
    }
    const split = splitLaunch(typed);
    if (!split.ok) {
      tried.push({ typed: typed.slice(0, 100), why: split.refused });
      continue;
    }
    const checked = check(split.words, { platform });
    if (!checked.ok) {
      tried.push({ typed: typed.slice(0, 100), why: checked.why });
      continue;
    }
    return { words: split.words };
  }
}

// The setting a set of launch words is, for this computer.
export function builderLaunchSetting(words, computer) {
  return { key: `builderLaunch:${computer}`, value: words };
}

// Step 3's plan: the question while this computer has no route kept and it isn't answered, else null. A route kept already
// is not asked again; an answer given is saved by saveBuilderRoute at apply. After the launch choice the command's own card is
// asked until a command is taken (or put off).
export function builderChoice({ answer, where, views, computer, check, platform }) {
  if (routeKept(views, computer)) return null;
  const asked = builderRouteAsk({ where: KINDS.includes(where) ? where : 'unknown' });
  const got = answer(BUILDERS_ID);
  if (got === null || !asked.card.options.some((o) => o.label === got.label)) return { ask: asked };
  if (got.label !== BUILDER_CHOICES.launch) return null;
  const launch = launchWords({ answer, ...(check === undefined ? {} : { check }), ...(platform === undefined ? {} : { platform }) });
  return launch.ask ? { ask: launch.ask } : null;
}

// Step 3's apply: the answer saved as this computer's route, through `profile` (own-app.js's helperProfile, a signed event
// the director confirms). Nothing is written with no answer, or when the newest value kept or waiting is the same.
// Gives the setting written, or null.
export async function saveBuilderRoute({ answers, profile, computer }) {
  const label = answers?.[`3.${BUILDERS_ID}`]?.label;
  if (typeof label !== 'string') return null;
  const { key, value } = builderRouteSetting(label, computer);
  const views = await profile.views();
  const waiting = (Array.isArray(views?.unconfirmed) ? views.unconfirmed : []).filter((u) => u?.kind === 'setting' && (u.key ?? u.data?.key) === key);
  const newest = waiting.length > 0 ? waiting.at(-1).data?.value : views?.settings?.[key]?.value;
  if (newest === value) return null;
  const got = await profile.write({ kind: 'setting', data: { key, value, words: settingWords(key, value) } });
  if (got?.ok !== true) throw new Error(`Where builders start could not be saved in your settings on this computer: ${got?.why ?? got?.refused ?? 'the helper did not say why'}`);
  return { key, value };
}

// Step 3's apply, for the launch command: after the launch choice, the words the director typed are saved as this computer's
// `builderLaunch` setting, through the same signed profile route as the route. Nothing is written for another choice, for
// "Ask me later", or when the newest value kept or waiting is the same. Gives the setting written, or null.
export async function saveBuilderLaunch({ answers, profile, computer, check, platform }) {
  if (answers?.[`3.${BUILDERS_ID}`]?.label !== BUILDER_CHOICES.launch) return null;
  const got0 = launchWords({ answer: (id) => answers[`3.${id}`] ?? null, ...(check === undefined ? {} : { check }), ...(platform === undefined ? {} : { platform }) });
  const words = got0.words ?? null;
  if (words === null) return null;
  const { key, value } = builderLaunchSetting(words, computer);
  const views = await profile.views();
  const waiting = (Array.isArray(views?.unconfirmed) ? views.unconfirmed : []).filter((u) => u?.kind === 'setting' && (u.key ?? u.data?.key) === key);
  const newest = waiting.length > 0 ? waiting.at(-1).data?.value : views?.settings?.[key]?.value;
  if (canonicalJson(newest ?? null) === canonicalJson(value)) return null;
  const got = await profile.write({ kind: 'setting', data: { key, value, words: settingWords(key, value) } });
  if (got?.ok !== true) throw new Error(`The launch command could not be saved in your settings on this computer: ${got?.why ?? got?.refused ?? 'the helper did not say why'}`);
  return { key, value };
}
