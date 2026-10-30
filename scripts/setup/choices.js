// scripts/setup/choices.js
// Setup's choices and its one recommended card (design section 15.1, the director's ruling of 26
// October 2026). Setup opens with one short card listing the recommended choices for this project,
// a plain line each. Go ahead on it stands for the answer to every choice it lists and for the Go
// ahead of each step's list while those choices hold; Customise asks every open choice up front,
// up to four to a card, and then the one card comes back with the director's choices.
//
// The choices are the questions steps 3 and 4 ask (new or from another computer, real users,
// Locked, the host, the connection, the description, live data, Apple signing). They are found by
// a dry run of those steps' plans (`choicesOnly` in their ctx, which stops each before it reads
// the host or waits for the project): each question a step asks is taken as answered, by the
// director's own answer where there is one and otherwise by its recommendation, and the plan is
// run again, so a question that only arises from another answer (Locked, once real users is Yes)
// is found in its place. Each choice keeps the step's own question id, card and writes, so an
// answer to it, given on Customise's card, is the step's answer.
//
// The one card is a question of step 0, which no step has: the engine asks it (scripts/setup/
// engine.js) and the prompt record keeps a click on it as any setup answer, on the card's exact
// words, with the records the choices it stands for make (the phase, the glossary entry). Its id
// names the choices, the folder's facts it rests on and how many answers the run held when it was
// asked, so it is never the same card twice. Its asked record keeps `choices`, [{ key, label, text }],
// what Go ahead stands for, and `facts`, the folder's as the card read them (whether the product is
// new, its host and repository), which the engine reads again before step 3 runs.
//
// The consent: the newest Go ahead on a one card of the run. It holds through a break (the
// director's call, 26 October 2026) and lapses only when one of its choices has a newer answer of
// the director's that differs. While it holds, each of its choices counts as answered as it says,
// unless the director answered that question again since.
import crypto from 'node:crypto';
import { canonicalJson } from '../lib/canonical.js';
import { engineWanted, engineLine } from './engine-parts.js';
import { HEALTH_STEP, onRunList, stepDone } from '../lib/setup-run.js';
import { askedRecord, answersFor } from './clicks.js';
import { HOST_LABELS, LEVELS, NEW_PRODUCT, REAL_USERS, STRICTER, WAYS } from './host.js';
import { LIVE_DATA, PRODUCT, SIGNS_APPS, productName } from './questions.js';

// The one card's step: none of setup's ten.
export const ONE_CARD_STEP = 0;
export const GO_AHEAD = 'Go ahead';
export const CUSTOMISE = 'Customise';
// The steps whose questions are setup's choices.
export const CHOICE_STEPS = Object.freeze([3, 4]);
// AskUserQuestion takes at most four questions at once.
export const PER_CARD = 4;
// The most questions one step's dry run may ask before it is taken as stuck.
const MOST_ASKS = 12;
const ONE_CARD_ID = /^plan-[0-9a-f]{12}$/;
const REDO_ID = /^redo-/;

const hash = (value) => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');

// What each choice is about, in a few words, for the director and for `choices`; by its question id.
export function aboutOf(key) {
  const id = key.slice(key.indexOf('.') + 1);
  if (id === 'join' || id.startsWith('join-')) return 'new or from your other computer';
  if (id === 'real-users') return 'real users';
  if (id === 'locked') return 'Locked';
  if (id === 'host') return 'GitHub or GitLab';
  if (id.startsWith('connection')) return 'how agents reach the project';
  if (id.startsWith('product-')) return 'the description';
  if (id === 'live-data') return 'live data';
  if (id === 'apple-apps') return 'signing Apple apps';
  return id;
}

// The step that acts on a choice, and so after which changing it takes more than a new answer:
// step 3's choices make the repository and the connection; live data and Apple signing go into the
// project's settings at step 7; the description and the phase are records, never acted on.
export function actedBy(key) {
  const [step, id] = [Number(key.slice(0, key.indexOf('.'))), key.slice(key.indexOf('.') + 1)];
  if (step === 3 && id !== 'real-users') return 3;
  if (id === 'live-data' || id === 'apple-apps') return 7;
  return null;
}

// The choices still open in a run: a dry run of steps 3 and 4 not yet done, in their order. Each is
// { step, id, key, card, typed, writes, chosen, label, text }: `card` the step's own card input,
// `chosen` the director's own answer or null, and `label`/`text` the answer it is taken as (the
// director's, or the card's recommendation). `planOf(step, answers)` runs the step's plan with a
// look at the choices only; `answers` are the run's answers as the steps read them.
export async function openChoices({ steps, run, answers, planOf }) {
  const open = steps.filter((s) => CHOICE_STEPS.includes(s.n) && onRunList(run, s.n) && !stepDone(run, s.n));
  // The open steps' questions are asked afresh in the dry run; a done step's answers stand as they are.
  const taken = Object.fromEntries(Object.entries(answers).filter(([key]) => !open.some((s) => key.startsWith(`${s.n}.`))));
  const list = [];
  for (const step of open) {
    // A computer joining a product from another runs no step 4 (ruling R74): its questions don't arise.
    if (step.n === 4 && joining(taken)) continue;
    for (let i = 0; i < MOST_ASKS; i += 1) {
      let got;
      try {
        got = await planOf(step, taken);
      } catch {
        break;
      }
      if (got?.ask === undefined) break;
      const { id, card, typed, writes } = got.ask;
      const key = `${step.n}.${id}`;
      if (Object.hasOwn(taken, key)) break;
      const chosen = answers[key] ?? null;
      const answer = chosen ?? { label: card.recommend, text: null, at: null };
      list.push({ step: step.n, id, key, card, typed: typed === true, writes, chosen, label: answer.label, text: answer.text });
      taken[key] = answer;
    }
  }
  return list;
}

// Whether the answers taken say this computer joins a product from another (the join question
// answered with anything but a new product).
const joining = (taken) => Object.entries(taken).some(([key, a]) => /^3\.join(?:-|$)/.test(key) && a.label !== NEW_PRODUCT);

// The plain line a choice adds to the one card, or null when it adds none. `name` is the product's,
// `platform` the computer's.
function lineOf({ id, label, text }, { name, platform, choices }) {
  const host = choices.find((c) => c.id === 'host')?.label === HOST_LABELS.gitlab ? 'GitLab' : 'GitHub';
  if (id === 'join' || id.startsWith('join-')) return label === NEW_PRODUCT ? null : `${name}, from your other computer, brought into this folder.`;
  if (id === 'real-users') {
    const live = choices.find((c) => c.id === 'live-data')?.label;
    if (label === REAL_USERS.no) return live === LIVE_DATA.no ? 'Before launch: no real users and no live data yet.' : 'Before launch: no real users yet.';
    return 'Launched: it has real users.';
  }
  if (id === 'locked') return label === LEVELS.locked ? 'Locked: you type your computer password once, at its step.' : null;
  if (id === 'host') {
    const join = choices.find((c) => c.id === 'join' || c.id.startsWith('join-'));
    return join && join.label !== NEW_PRODUCT ? `Looked for on your ${host} account.` : `A new product, in a private repository on your ${host} account.`;
  }
  if (id.startsWith('connection')) {
    if (label === WAYS.quick) return platform === 'darwin' ? `Agents use your ordinary ${host} sign-in, which they can't read on this Mac.` : `Agents use your ordinary ${host} sign-in.`;
    if (label === STRICTER) return `A key for this project only, made on ${host} (you'll click Authorise and Install).`;
    if (label === WAYS.wheelhouse) return 'A key for this project only, through the Wheelhouse app (you\'ll type a code and click Install).';
    if (label === WAYS.own) return 'A key for this project only, made on GitHub (you\'ll click Authorise and Install).';
    return `A ${host} key for this project only.`;
  }
  if (id.startsWith('product-')) {
    if (typeof text === 'string' && text.trim() !== '') return `Described as: "${text.trim()}"`;
    return null;
  }
  if (id === 'live-data') {
    const before = choices.find((c) => c.id === 'real-users')?.label === REAL_USERS.no;
    if (label === LIVE_DATA.no) return before && choices.some((c) => c.id === 'real-users') ? null : 'No live data yet.';
    return 'Agents use test data only, to be safe.';
  }
  if (id === 'apple-apps') return label === SIGNS_APPS.yes ? 'Builds may use your saved passwords to sign the app.' : 'Builds can\'t reach your saved passwords.';
  return null;
}

// The README's words a product choice stands for, as its card offers them, or null.
function describedBy(choice) {
  if (!choice.id.startsWith('product-') || choice.label !== PRODUCT.readme) return null;
  const says = choice.card.options?.find((o) => o.label === PRODUCT.readme)?.says;
  return typeof says === 'string' ? says : null;
}

// The one card for a run: { id, card, choices, writes }. `list` is openChoices'; `product` is
// productOf's for the folder (or null); `toRun` which of steps 2, 3, 6, 7 and the health check are still to run; `count`
// how many answers the run holds; `hosts` the hosts of the projects on this computer, for the engine's line
// (scripts/engine/parts.js). `card` is AskUserQuestion's question, ready; `writes` what Go
// ahead records, as a setup question's writes are kept (scripts/lib/setup-writes.js): the records
// the choices it stands for make, for those the director hasn't answered themselves.
// How long what is left of setup takes, as the one card and its heading say it: about a minute
// when only the health check is left and nothing is to choose, else about 5 minutes.
export function setupTime(toRun, list = []) {
  return list.length === 0 && toRun.length > 0 && toRun.every((n) => n === HEALTH_STEP) ? 'about a minute' : 'about 5 minutes';
}

export function oneCard({ folder, list, product, platform, toRun, count, facts = null, claudeHome = null, hosts }) {
  const name = product?.name ?? productName(folder);
  // Only the health check left, nothing to choose: a run parked near its end (one v0.1.1 left at
  // its phone card, carried on after the update), whose card names what is left.
  const nearlyDone = setupTime(toRun, list) === 'about a minute';
  const lines = [];
  if (toRun.includes(3) && product && product.isNew === false) lines.push(`${name} on ${product.host === 'gitlab' ? 'GitLab' : 'GitHub'}, as it is.`);
  // In the card's order: where it is kept, how agents reach it, its phase and data, Locked, the
  // description, then Apple signing.
  const rank = ({ id }) => ['join', 'host', 'connection', 'real-users', 'live-data', 'locked', 'product-', 'apple-apps']
    .findIndex((p) => id === p || id.startsWith(p.endsWith('-') ? p : `${p}-`));
  for (const c of [...list].sort((x, y) => rank(x) - rank(y))) {
    const readme = describedBy(c);
    const line = readme === null ? lineOf(c, { name, platform, choices: list }) : `Described as: ${readme}`;
    if (line !== null) lines.push(line);
  }
  // The plugin's update is step 6's, so the line names it only while step 6 is still to run.
  if (toRun.includes(2) && engineWanted({ platform, hosts })) lines.push(engineLine(undefined, { claudeHome: toRun.includes(6) ? claudeHome : null }));
  if (toRun.includes(6)) lines.push('On this computer: usage counted here only, and 30 days of chat history kept (older history is deleted).');
  if (toRun.includes(7)) lines.push('Wheelhouse\'s settings saved to the project, then its main line protected.');
  // Never a plan with no lines: the health check is named when nothing else is.
  if (lines.length === 0 && toRun.includes(HEALTH_STEP)) lines.push('A last check that everything is safe.');
  const yours = list.some((c) => c.chosen !== null);
  const time = setupTime(toRun, list);
  const question = [
    nearlyDone ? `Finish setting up Wheelhouse for ${name}?` : `Set up Wheelhouse for ${name}?`,
    nearlyDone ? `Setup is nearly done. What's left takes ${time}:` : `${yours ? 'Here\'s the plan, with your choices.' : 'Here\'s what I recommend.'} It takes ${time}.`,
    ...lines.map((l) => `- ${l}`),
    'Nothing runs until you choose.',
    'To know more, just ask.',
  ].join('\n');
  const choices = list.map((c) => ({ key: c.key, label: c.label ?? null, text: c.text ?? null }));
  const records = list.filter((c) => c.chosen === null).flatMap((c) => {
    const labels = c.writes?.labels;
    return labels && Object.hasOwn(labels, c.label) ? labels[c.label] : [];
  });
  const id = `plan-${hash({ choices, count, facts }).slice(0, 12)}`;
  const card = {
    question,
    header: 'Setup',
    options: [
      { label: GO_AHEAD, description: 'Recommended: I do all of this now. You\'ll only be asked to sign in, or for your password.' },
      { label: CUSTOMISE, description: 'See every choice, and change any before anything runs.' },
    ],
    multiSelect: false,
  };
  return { id, card, choices, writes: records.length > 0 ? { labels: { [GO_AHEAD]: records } } : undefined };
}

// The run's answers to step 0's cards: the one cards' and the redo cards', each { id, label, text, at }.
function stepZero(answers) {
  return Object.entries(answers).filter(([key]) => key.startsWith(`${ONE_CARD_STEP}.`))
    .map(([key, a]) => ({ id: key.slice(2), ...a })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// Every Go ahead on a one card of the run, oldest first, each with the choices it stands for:
// [{ at, id, choices }]. Read from the director's signed answers and the cards' asked records alone.
function consentsIn(runId, answers) {
  return stepZero(answers).filter((a) => ONE_CARD_ID.test(a.id) && a.label === GO_AHEAD).flatMap((a) => {
    const asked = askedRecord(runId, ONE_CARD_STEP, a.id);
    return Array.isArray(asked?.choices) ? [{ at: a.at, id: a.id, choices: asked.choices, facts: asked.facts ?? null }] : [];
  });
}

// The newest Go ahead on a one card of the run, with the choices it stands for, or null.
export function consentIn(runId, answers) {
  return consentsIn(runId, answers).at(-1) ?? null;
}

// When Customise was last clicked on a one card of the run, or null.
export function customisingSince(answers) {
  const last = stepZero(answers).filter((a) => ONE_CARD_ID.test(a.id)).at(-1);
  return last?.label === CUSTOMISE ? last.at : null;
}

const newer = (a, b) => Date.parse(a) > Date.parse(b);
const same = (answer, choice) => answer.label === choice.label && (answer.text ?? null) === (choice.text ?? null);

// Whether a consent still holds: none of its choices has a newer answer of the director's that differs.
export function consentHolds(consent, answers) {
  if (consent === null) return false;
  return consent.choices.every((c) => {
    const own = answers[c.key];
    return !own || !newer(own.at, consent.at) || same(own, c);
  });
}

// The answers each step's plan reads: the director's own, with the newest Go ahead's choices for
// the questions they haven't answered since it, whether or not it still holds, since steps may have
// run on them: { answers, consent }, `consent` the Go ahead while it holds (it stands for each step's
// Go ahead), else null.
// A later Go ahead lists only the choices still open when it was asked, so each earlier one's stand
// for those it alone listed.
export function answersWithConsent(runId, { read = answersFor } = {}) {
  const own = read(runId);
  const all = consentsIn(runId, own);
  if (all.length === 0) return { answers: own, consent: null };
  const answers = { ...own };
  for (const found of all) {
    for (const c of found.choices) {
      const mine = own[c.key];
      if (!mine || !newer(mine.at, found.at)) answers[c.key] = { label: c.label, text: c.text, at: found.at };
    }
  }
  const newest = all.at(-1);
  return { answers, consent: consentHolds(newest, own) ? newest : null };
}

// The choices Customise asks now: those open and not answered since Customise was clicked, the first
// PER_CARD of them; empty once every one has been.
export function customiseBatch(list, since) {
  return list.filter((c) => !(c.chosen && newer(c.chosen.at, since))).slice(0, PER_CARD);
}

// Whether an id is one of step 0's redo cards.
export const isRedo = (id) => REDO_ID.test(id);
