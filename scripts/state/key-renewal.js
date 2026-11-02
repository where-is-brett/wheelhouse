// scripts/state/key-renewal.js
// New signing keys after risky periods (Task B2 of the build plan of 2 November 2026). A key
// is due after a period at Unattended has ended, and a week after an Ask allowance; and, behind its own switch, a week
// after an agent's step ran outside the sandbox. The name is apart from `renewalDue` in scripts/host/connection.js, which
// is the host connection's key. Nothing renews without the director's click on the card this file composes.
import { verify, renewSigningKey } from './signing.js';
import { ALLOWANCE_LABELS } from '../protection/windows-builds.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const KEY_RENEWAL_TOPIC = 'signing-key-renewal';
export const KEY_RENEWAL_LABEL = 'Make a new key';
const KEEP_LABEL = 'Keep the old key';

// Whether a week with an agent's step run outside the sandbox makes a new key due. It is the director's call and is not yet
// decided, so it is off: with it off, only the other two triggers run. To turn it on, set this to true and give
// keyRenewalDue the times (as ISO strings) of the agent's steps that ran outside the sandbox since the last renewal as
// `outsideSandbox`; the sandbox's own record (Part A) is where those times come from. A test gives `outsideSandboxOn`.
export const KEY_RENEWAL_ON_UNSANDBOXED_STEPS = false;

const timeOf = (value) => (value instanceof Date ? value.getTime() : Date.parse(value));
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Each time something risky began or ended, from the project's events: the end of a period at Unattended, and the click
// or level that allowed an Ask build question's commands.
function risks(events) {
  const ended = [];
  const allowed = [];
  const open = new Map();
  const ordered = events.filter((e) => plain(e) && plain(e.data) && Number.isFinite(timeOf(e.at))).sort((a, b) => timeOf(a.at) - timeOf(b.at));
  for (const e of ordered) {
    // A period is a setting or a level with a key and a value, or a level the audit reads (data.level a word, for one pull
    // request or, with none, for all after it). Only a word counts: a decision level is a number.
    const key = typeof e.data.key === 'string' ? e.data.key : (typeof e.data.level === 'string' ? `level:${e.data.pr ?? 'all'}` : undefined);
    const value = e.data.value ?? e.data.level;
    if ((e.kind === 'setting' || e.kind === 'level') && key !== undefined && typeof value === 'string' && e.data.allowance === undefined) {
      const was = open.get(key);
      if (value === 'unattended') {
        if (was === undefined) open.set(key, e.at);
      } else if (was !== undefined) {
        open.delete(key);
        ended.push(e.at);
      }
    }
    if ((e.kind === 'level' && e.data.allowance) || (e.kind === 'card-answer' && ALLOWANCE_LABELS.includes(e.data.label))) allowed.push(e.at);
  }
  return { ended, allowed };
}

// { due, why }: whether a new key is due, and in a plain sentence why. Each trigger counts only what came after
// `lastRenewal` (an ISO time, or null for never). Input that can't be read is not due.
export function keyRenewalDue(input) {
  const { events, now, lastRenewal = null, outsideSandbox = [], outsideSandboxOn = KEY_RENEWAL_ON_UNSANDBOXED_STEPS } = plain(input) ? input : {};
  const at = timeOf(now);
  if (!Array.isArray(events) || !Number.isFinite(at)) return { due: false };
  const since = lastRenewal === null || lastRenewal === undefined ? -Infinity : timeOf(lastRenewal);
  const after = (list) => list.filter((t) => timeOf(t) > (Number.isFinite(since) ? since : -Infinity));
  const { ended, allowed } = risks(events);
  if (after(ended).length > 0) return { due: true, why: 'a period at Unattended has ended' };
  const week = (list) => after(list).some((t) => at - timeOf(t) >= WEEK_MS);
  if (week(allowed)) return { due: true, why: 'a week has passed since an Ask allowance let commands run' };
  if (outsideSandboxOn === true && Array.isArray(outsideSandbox) && week(outsideSandbox.filter((t) => Number.isFinite(timeOf(t))))) {
    return { due: true, why: 'a week has passed since an agent\'s step ran outside the sandbox' };
  }
  return { due: false };
}

// The input for the card (scripts/cards/compose.js) that asks the director for the click. The click is the only thing
// that makes a key.
export function keyRenewalCardInput(why) {
  return {
    kind: 'question',
    level: 4,
    what: `Make Wheelhouse a new signing key on this computer? ${String(why).replace(/^./, (c) => c.toUpperCase())}.`,
    why: 'The key is what proves a record came from this computer. A new one means a copy of the old key, if one were ever taken, signs nothing new. Everything signed so far still counts.',
    meanwhile: 'The old key stays in use, and nothing changes.',
    options: [
      { label: KEY_RENEWAL_LABEL, says: 'A new key is made now. Then you renew the connection to your code host with one code on its page.' },
      { label: KEEP_LABEL, says: 'The old key stays, and this is asked again in your next briefing.' },
    ],
    recommend: KEY_RENEWAL_LABEL,
    because: 'it limits what a taken copy of the old key could do',
    checks: 'It changes no checks: a new key only changes which key signs from now on.',
    topic: KEY_RENEWAL_TOPIC,
    suggest: false,
  };
}

// Makes the new key, enrolled beside the old, which is kept as retired so earlier records still verify. It needs the
// director's click: a signed card-answer, by an enrolled key, on the renewal card's own label. Returns
// { computer, publicKey }. `now` gives the time of the renewal.
export function replaceSigningKey({ enrolled, now = () => new Date(), click } = {}) {
  const clicked = plain(click) && click.kind === 'card-answer' && click.data?.label === KEY_RENEWAL_LABEL && verify(click, enrolled);
  if (!clicked) throw new Error('A new signing key is made only on the director\'s signed click on the renewal card');
  return renewSigningKey({ retiredAt: new Date(timeOf(typeof now === 'function' ? now() : now)).toISOString() });
}

// Finds the director's click on a renewal card in `events` and makes the key. { renewed: true, key } or { renewed: false }.
// A click from before `lastRenewal` has been acted on already. A click on another card's label, or an unsigned one, is no
// click.
export function renewKeyOnClick({ events, enrolled, now = () => new Date(), lastRenewal = null } = {}) {
  if (!Array.isArray(events)) return { renewed: false };
  const cards = new Set(events.filter((e) => e?.kind === 'card' && e.data?.topic === KEY_RENEWAL_TOPIC).map((e) => e.id));
  const since = lastRenewal === null ? -Infinity : timeOf(lastRenewal);
  const click = events
    .filter((e) => e?.kind === 'card-answer' && cards.has(e.data?.card) && e.data?.label === KEY_RENEWAL_LABEL && timeOf(e.at) > since && verify(e, enrolled))
    .sort((a, b) => timeOf(a.at) - timeOf(b.at)).at(-1);
  if (click === undefined) return { renewed: false };
  return { renewed: true, key: replaceSigningKey({ enrolled, now, click }) };
}

// When this computer's key was last renewed, as the time its newest retired key was retired, or null for never.
export function lastKeyRenewal(enrolled, computer) {
  const times = (Array.isArray(enrolled) ? enrolled : [])
    .filter((e) => e?.computer === computer && typeof e.retiredAt === 'string' && Number.isFinite(Date.parse(e.retiredAt)))
    .map((e) => e.retiredAt).sort();
  return times.at(-1) ?? null;
}
