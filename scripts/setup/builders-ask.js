// scripts/setup/builders-ask.js
// Where builders start (builders and settings design, sections 6 and 10.1): the advanced question of step 3, how builder
// sessions start on this computer. What it offers follows where setup runs, read from CLAUDE_CODE_ENTRYPOINT: Desktop's value
// recommends Desktop; the terminal's offers the background only (a session in a terminal can't start Desktop sessions); any
// other value, or none, offers all three and says it can't tell.
//
// The answer is saved once per computer as the profile setting `builders:<computerId>`, through the helper's profile route like
// any setting whose home is the profile, and counts once the director confirms it. A computer whose route is saved, or waits
// for its Confirm, isn't asked again.
import { settingWords } from '../settings/effective.js';

export const BUILDERS_ID = 'builders';
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
    [BUILDER_CHOICES.launch]: 'Wheelhouse starts builders through a command you give, such as a wrapper that sets a gateway. The First Mate asks you for it.',
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

// Step 3's plan: the question while this computer has no route kept and it isn't answered, else null. A route kept already
// is not asked again; an answer given is saved by saveBuilderRoute at apply.
export function builderChoice({ answer, where, views, computer }) {
  if (routeKept(views, computer)) return null;
  const asked = builderRouteAsk({ where: KINDS.includes(where) ? where : 'unknown' });
  const got = answer(BUILDERS_ID);
  return got !== null && asked.card.options.some((o) => o.label === got.label) ? null : { ask: asked };
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
