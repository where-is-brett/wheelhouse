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
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../lib/canonical.js';
import { PERSONAL_DAYS } from '../host/gitlab-key.js';
import { KEY_DAYS_ASKED } from './host-access.js';
import { engineWanted, engineLine } from './engine-parts.js';
import { HEALTH_STEP, onRunList, stepDone } from '../lib/setup-run.js';
import { askedRecord, answersFor } from './clicks.js';
import { macKeepsAway } from '../lib/host-lines.js';
import { COMPANY_GITLAB, GITLAB_COM, companyAddress, HOST_LABELS, pinOf, repoNamed, LEVELS, NEW_PRODUCT, REAL_USERS, STRICTER, WAYS } from './host.js';
import { LIVE_DATA, PRODUCT, SIGNS_APPS, productName } from './questions.js';
import { FIRST_CHECK_LINE, KEEP_HERE, KEPT_LINE, ONLY_HERE_AFTER, ONLY_HERE_LINE, PUT_ON_GITLAB, STARTED_LINE } from './local.js';
import { backupNamed } from '../host/local/restore.js';
import { compactionLine, compactionRules } from '../protection/settings.js';
import { HOST_TOOL_NAME, hostToolLabels } from './tools.js';

// The one card's step: none of setup's ten.
export const ONE_CARD_STEP = 0;
export const GO_AHEAD = 'Go ahead';
export const CUSTOMISE = 'Customise';
// The same click on a plan that already holds the director's own choices, so the card does not offer Customise twice.
export const CHANGE_CHOICE = 'Change a choice';
// The steps whose questions are setup's choices.
// Step 2's is whether to fetch a missing host tool (scripts/setup/tools.js); it is found last, since which tool is
// missing depends on the host that steps 3 and 4's answers name.
export const CHOICE_STEPS = Object.freeze([2, 3, 4]);
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
  if (id === 'host') return 'where the project is kept';
  if (id === 'kept') return 'where the project is kept';
  if (id === 'backup' || id.startsWith('backup-')) return 'a backup';
  if (id.startsWith('branch-')) return 'the main version\'s line';
  if (id.startsWith('connection')) return 'how agents reach the project';
  if (id.startsWith('product-')) return 'the description';
  if (id === 'live-data') return 'live data';
  if (id === 'apple-apps') return 'signing Apple apps';
  if (id.startsWith('host-tool-')) return `${id === 'host-tool-gh' ? 'GitHub' : 'GitLab'}'s own tool`;
  return id;
}

// The step that acts on a choice, and so after which changing it takes more than a new answer:
// step 3's choices make the repository and the connection; live data and Apple signing go into the
// project's settings at step 7; the description and the phase are records, never acted on.
export function actedBy(key) {
  const [step, id] = [Number(key.slice(0, key.indexOf('.'))), key.slice(key.indexOf('.') + 1)];
  if (step === 2) return 2;
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
  const open = steps.filter((s) => CHOICE_STEPS.includes(s.n) && onRunList(run, s.n) && !stepDone(run, s.n))
    .sort((a, b) => Number(a.n === 2) - Number(b.n === 2));
  // The open steps' questions are asked afresh in the dry run; a done step's answers stand as they are.
  const taken = Object.fromEntries(Object.entries(answers).filter(([key]) => !open.some((s) => key.startsWith(`${s.n}.`))));
  // Step 2 is looked at last, as its list follows step 3's host. The director's own answers on step 2's cards, never a
  // recommendation taken in their place, are still facts step 3's cards rest on (Quick needs the host's own tool), so the
  // other steps read them.
  const toolsChosen = Object.fromEntries(Object.entries(answers).filter(([key]) => key.startsWith('2.')));
  const list = [];
  for (const step of open) {
    // A computer joining a product from another runs no step 4 (ruling R74): its questions don't arise.
    if (step.n === 4 && joining(taken)) continue;
    for (let i = 0; i < MOST_ASKS; i += 1) {
      let got;
      try {
        got = await planOf(step, step.n === 2 ? taken : { ...toolsChosen, ...taken });
      } catch {
        break;
      }
      if (got?.ask === undefined) break;
      const { id, card, typed, writes } = got.ask;
      // Step 3 asks step 2's question of the host's tool before its connection card, under step 2's key.
      const at = step.n === 3 && got.ask.step === 2 ? 2 : step.n;
      const key = `${at}.${id}`;
      if (Object.hasOwn(taken, key)) break;
      // An answer the step says still stands on this card (the same question, its way still offered): the director's own,
      // read from the run under its own key, and taken only where its label is one of this card's options.
      const kept = typeof got.ask.carried === 'string' && got.ask.carried.startsWith(`${at}.`) ? answers[got.ask.carried] ?? null : null;
      const carried = kept !== null && card.options.some((o) => o.label === kept.label) ? kept : null;
      const chosen = answers[key] ?? carried;
      const answer = chosen ?? { label: card.recommend, text: null, at: null };
      list.push({ step: at, id, key, card, typed: typed === true, writes, chosen, label: answer.label, text: answer.text, ...(got.ask.line ? { line: got.ask.line } : {}), ...(got.ask.endsBatch === true ? { endsBatch: true } : {}) });
      taken[key] = answer;
      // A card that waits for the director's own answer (a company's GitLab address), or that recommends nothing for a
      // look to take in its place (which GitLab), ends the look at this step until it has one.
      if (chosen === null && (got.ask.waits === true || card.recommend === null)) break;
    }
  }
  // The join question is asked again, under a new id, after each answer refused (typed text that names no
  // repository, a backup not found, a miss); only the newest is the question, and only the answer that
  // settled it counts, so an earlier refused answer is no choice and adds no line to the plan.
  const isJoin = (c) => c.step === 3 && /^join(?:-|$)/.test(c.id);
  const lastJoin = list.findLastIndex(isJoin);
  return list.filter((c, i) => !isJoin(c) || i === lastJoin);
}

const KEPT_ID = /^(?:join|kept|host)(?:-|$)/;
const BACKUP_ID = /^backup(?:-|$)/;
const NOT_JOINING = [NEW_PRODUCT, KEEP_HERE, HOST_LABELS.github, HOST_LABELS.gitlab];
// Whether the answers taken say this computer joins a product from another (the join question
// answered with anything but a new product).
// Only the newest join answer counts: an earlier one was refused (not a name, no backup) and asked again.
const joining = (taken) => {
  const last = Object.entries(taken).filter(([key]) => /^3\.join(?:-|$)/.test(key)).at(-1)?.[1];
  return last !== undefined && !NOT_JOINING.includes(last.label) && backupNamed(last.text) === null;
};

// The text typed as the newest join answer, or null.
const joinedText = (choices) => choices.filter((c) => c.id === 'join' || c.id.startsWith('join-')).at(-1)?.text ?? null;

// What step 3 reads a pasted address as (its own reader, pinOf): { host: 'github' }, or { host: 'gitlab', company }; null for
// anything it refuses or reads as no address, so the plan never names a host step 3 will not use.
const pinnedBy = (choices) => {
  const pin = pinOf(joinedText(choices));
  return pin?.host === undefined ? null : pin;
};

// How the plan names the host a pasted address gave, or null.
function addressHostName(choices) {
  const pin = pinnedBy(choices);
  if (pin === null) return null;
  if (pin.host === 'github') return 'GitHub';
  return pin.company.host === undefined ? 'GitLab' : `your company's GitLab at ${pin.company.host}`;
}

// The host the plan names, as step 3 will use it: the one the folder's own remote names, else
// the one the kept card or the host or join card chose; GitHub when none says GitLab.
function hostOf(product, choices) {
  // A pasted address in the join answer names its own host.
  const pinned = pinnedBy(choices);
  if (pinned !== null) return pinned.host === 'gitlab' ? 'GitLab' : 'GitHub';
  if (product && product.isNew === false && (product.host === 'gitlab' || product.host === 'github')) return product.host === 'gitlab' ? 'GitLab' : 'GitHub';
  const chose = choices.some((c) => (c.id === 'kept' && c.label === PUT_ON_GITLAB) || ((c.id === 'host' || c.id === 'join' || c.id.startsWith('join-')) && c.label === HOST_LABELS.gitlab));
  return chose ? 'GitLab' : 'GitHub';
}

// A company's own GitLab, chosen on the which-GitLab card and not taken back on the address card.
const onCompanyGitLab = (choices, host) => host === 'GitLab' && (addressHostName(choices)?.startsWith('your company') || choices.some((c) => c.id.startsWith('gitlab-where') && c.label === COMPANY_GITLAB) && !choices.some((c) => c.id.startsWith('gitlab-address') && c.label === GITLAB_COM));

// The company GitLab's host name the director typed on step 3's address question, or null while none is read.
const typedCompanyHost = (choices) => {
  const typed = choices.filter((c) => c.id.startsWith('gitlab-address') && typeof c.text === 'string').at(-1);
  return typed === undefined ? null : companyAddress(typed.text).host ?? null;
};


// The plain line a choice adds to the one card, or null when it adds none. `name` is the product's,
// `platform` the computer's, `host` the host the plan names.
function lineOf({ id, label, text, line }, { name, platform, choices, host }) {
  if (id === 'backup' || id.startsWith('backup-')) return line;
  if (id === 'kept') return label === KEEP_HERE ? line : `Put on ${host}: a private ${host === 'GitLab' ? 'project' : 'repository'} on your account, with your project's history sent to it.`;
  if (id.startsWith('branch-')) return `Finished work goes on ${label}, the main version.`;
  if (label === KEEP_HERE && (id === 'host' || id === 'join' || id.startsWith('join-'))) return KEPT_LINE;
  if (label === HOST_LABELS.github || label === HOST_LABELS.gitlab) {
    const company = onCompanyGitLab(choices, host);
    if (id === 'join' || id.startsWith('join-')) return company ? 'A new product, in a private project on your company\'s GitLab.' : `A new product, in a private ${host === 'GitLab' ? 'project' : 'repository'} on your ${host} account.`;
  }
  if ((id === 'join' || id.startsWith('join-')) && backupNamed(text) !== null) return `${name}, brought back from your backup into this folder.`;
  if (id === 'join' || id.startsWith('join-')) {
    if (label === NEW_PRODUCT) return null;
    const where = addressHostName(choices);
    // The product's own name, where the typed answer (an address, or owner/name) gives it, not the folder's.
    const named = typeof text === 'string' && backupNamed(text) === null ? repoNamed(text)?.split('/').at(-1) : null;
    // An owner/name looked for on the company's GitLab, as step 3 words it: its account or groups.
    if (where === null && onCompanyGitLab(choices, host)) return `${named ?? name}, set up with Wheelhouse, found in your account or groups on your company's GitLab${typedCompanyHost(choices) === null ? '' : ` at ${typedCompanyHost(choices)}`}, brought into this folder with its saved settings.`;
    return `${named ?? name}, set up with Wheelhouse${where === null ? '' : ` on ${where}`}, brought into this folder with its saved settings.`;
  }
  if (id === 'real-users') {
    const live = choices.find((c) => c.id === 'live-data')?.label;
    if (label === REAL_USERS.no) return live === LIVE_DATA.no ? 'Before launch: no real users and no live data yet.' : 'Before launch: no real users yet.';
    return 'Launched: it has real users.';
  }
  if (id === 'locked') return label === LEVELS.locked ? 'Locked: you type your computer password once, at its step.' : null;
  if (id === 'host') {
    const join = choices.find((c) => c.id === 'join' || c.id.startsWith('join-'));
    return join && join.label !== NEW_PRODUCT ? `Looked for on your ${host} account.` : `A new product, in a private ${host === 'GitLab' ? 'project' : 'repository'} on your ${host} account.`;
  }
  if (id.startsWith('connection')) {
    // On Windows a narrow way still leaves the host's own tool signed in as the director, readable by any agent's command.
    const toolOut = choices.find((c) => c.id === 'host-tool-glab')?.label === hostToolLabels('glab').none;
    const stays = platform !== 'win32' ? ''
      : host === 'GitLab' && toolOut ? ' On Windows it is kept here, where any agent\'s command could read it.'
        : ` ${host}'s own sign-in also stays here, where any agent's command could read it.`;
    if (label === WAYS.quick) return platform === 'darwin' ? `Agents use your ordinary ${host} sign-in, which reaches your whole account; ${macKeepsAway(host.toLowerCase())}.` : `Agents use your ordinary ${host} sign-in, which reaches your whole account${platform === 'win32' ? '; on Windows any agent\'s command could read it' : ''}.`;
    if (label === STRICTER && host === 'GitLab') return `A GitLab key for this project only; where GitLab won't allow one, a ${PERSONAL_DAYS}-day token stands in and acts as you across GitLab.${stays}`;
    if (label === STRICTER) return `A key for this project only, made on ${host} (you'll click Authorize and install).`;
    if (label === WAYS.wheelhouse) return `A key for this project only, through the Wheelhouse app (you\'ll type a code and click Install).${stays}`;
    if (label === WAYS.own) return `A key for this project only, from an app you create on GitHub (you\'ll tick Enable Device Flow, click Create, type the code shown, then Authorize and install).${stays}`;
    if (label === WAYS.asIs) return `Agents use your own git as it is, with a ${host} key that reaches everything your account can${platform === 'win32' ? '; on Windows any agent\'s command could ask git for it' : ''}.`;
    // On GitLab the key may not be allowed (keys switched off, or a free plan on the public service), so the plan names the token that stands in.
    return host === 'GitLab'
      ? `A GitLab key for this project only, or, where GitLab won't allow one, a ${PERSONAL_DAYS}-day token that can act as you across GitLab.${stays}`
      : `A ${host} key for this project only.${stays}`;
  }
  if (id.startsWith('product-')) {
    if (typeof text === 'string' && text.trim() !== '') return `Described as: "${text.trim()}"`;
    return null;
  }
  if (id === 'live-data') {
    const before = choices.find((c) => c.id === 'real-users')?.label === REAL_USERS.no;
    if (label === LIVE_DATA.no) return before && choices.some((c) => c.id === 'real-users') ? null : 'No live data yet.';
    return 'Agents are told to use test data only, to be safe.';
  }
  if (id.startsWith('host-tool-')) {
    const tool = id === 'host-tool-gh' ? 'gh' : 'glab';
    const name = HOST_TOOL_NAME[tool];
    return label === hostToolLabels(tool).none ? `${name}'s own tool left out: Wheelhouse reaches ${name} without it.` : `Wheelhouse fetches ${name}'s own tool from its official release and checks it.`;
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

// What Go ahead says will be asked of the director, as the plan's choices make it true: only a password for a
// project kept here; on GitLab without its tool, with a key for this project only, the one-day setup token (host.js);
// with their git as it is, a key only where git holds none that works; on a company's GitLab, a sign-in in the browser or
// by token; else a sign-in.
function goAheadAsks({ keptHere, list, host, phone = false }) {
  const text = goAheadAsksHost({ keptHere, list, host });
  // Step 9 asks the director to try a notification on their phone, unless an earlier setup's test already reached it.
  if (!phone) return text;
  return `${text} Near the end, setup offers a test notification on your phone, which you can skip.`;
}

function goAheadAsksHost({ keptHere, list, host }) {
  if (keptHere) return 'Apart from Claude Code\'s own request to allow setup\'s command, you may be asked for your computer\'s password.';
  const way = list.find((c) => c.id === 'connection' || c.id.startsWith('connection-'))?.label ?? null;
  const noTool = list.find((c) => c.id === 'host-tool-glab')?.label === hostToolLabels('glab').none;
  if (host === 'GitLab' && noTool && way !== null && way !== WAYS.quick && way !== WAYS.asIs) {
    return `You'll paste a one-day GitLab token into a box on your screen, not the chat. If GitLab won't make a key for this one project, you'll also paste a token set to end ${PERSONAL_DAYS} days ahead that can act as you in every GitLab project and group you can reach. You may be asked for your computer's password.`;
  }
  if (way === WAYS.asIs) return `You'll be asked for a ${host} key only if your git holds none that works: you make it on a page that opens${host === 'GitLab' ? ` and set its expiry date ${KEY_DAYS_ASKED} days ahead` : `, set to last ${KEY_DAYS_ASKED} days`}, and paste it into a box on your screen, not the chat. You may be asked for your computer's password.`;
  // A narrow way on GitLab with its tool still meets GitLab's refusal of a project key the same way.
  const fallbackBox = (known) => (host === 'GitLab' && way !== null && way !== WAYS.quick
    ? ` If GitLab won't make a key for one project, you'll also paste a ${PERSONAL_DAYS}-day token that can act as you across GitLab into ${known ? 'that box' : 'a box on your screen, not the chat'}.` : '');
  // A company's GitLab without a browser sign-in set up takes a token instead, which only setup's step 3 can tell.
  if (onCompanyGitLab(list, host)) return `You'll sign in to your company's GitLab in your browser if your company has set that up, or else with a token you make on a page that opens and paste into a box on your screen, not the chat. You may be asked for your computer's password.${fallbackBox(true)}`;
  return `You'll sign in on ${host} pages that open and click through them. You may be asked for your computer's password.${fallbackBox(false)}`;
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

export function oneCard({ folder, list, product, platform, toRun, count, facts = null, claudeHome = null, hosts, desktop, pushed = false }) {
  const name = product?.name ?? productName(folder);
  // Only the health check left, nothing to choose: a run parked near its end (one v0.1.1 left at
  // its phone card, carried on after the update), whose card names what is left.
  const nearlyDone = setupTime(toRun, list) === 'about a minute';
  const lines = [];
  const keptHere = list.some((c) => c.label === KEEP_HERE);
  if (toRun.includes(3) && product && product.isNew === false && product.host !== 'local') lines.push(`${name} on ${product.host === 'gitlab' ? 'GitLab' : 'GitHub'}, as it is.`);
  // In the card's order: where it is kept, how agents reach it, its phase and data, Locked, the
  // description, then Apple signing.
  const rank = ({ id }) => ['join', 'host', 'kept', 'branch-', 'connection', 'host-tool-', 'real-users', 'live-data', 'locked', 'product-', 'apple-apps']
    .findIndex((p) => id === p || id.startsWith(p.endsWith('-') ? p : `${p}-`));
  for (const c of [...list].sort((x, y) => rank(x) - rank(y))) {
    const readme = describedBy(c);
    const line = readme === null ? lineOf(c, { name, platform, choices: list, host: hostOf(product, list) }) : `Described as: ${readme}`;
    if (line !== null) lines.push(line);
  }
  // Kept here with no backup: one line says both, since being only on this computer is what staying here means.
  if (lines.includes(ONLY_HERE_LINE) && lines.includes(KEPT_LINE)) {
    lines.splice(lines.indexOf(KEPT_LINE), 1);
    lines.splice(lines.indexOf(ONLY_HERE_LINE), 1, `${KEPT_LINE} ${ONLY_HERE_AFTER}`);
  }
  if (keptHere && toRun.includes(3) && !fs.existsSync(path.join(folder, '.git'))) lines.push(STARTED_LINE('main'));
  // The plugin's update is step 6's, so the line names it only while step 6 is still to run.
  if (toRun.includes(2) && engineWanted({ platform, hosts })) lines.push(engineLine(undefined, { claudeHome: toRun.includes(6) ? claudeHome : null }));
  // Step 9 asks nothing where an earlier setup's test push reached the phone (`pushed`), so the line doesn't promise a question.
  if (toRun.includes(6)) lines.push(`On this computer: usage counted here only; 30 days of chat history kept (this changes a Claude Code setting, and older history is deleted); Claude Code takes only its well-tried updates; and ${pushed ? 'phone notifications on, as an earlier setup on this computer showed they reach your phone' : desktop === false ? 'a question about phone notifications, where setup suggests skipping them since they need Claude Desktop' : 'phone notifications on'}.`);
  if (toRun.includes(7)) {
    const kept = compactionLine(compactionRules({ claudeHome, projectDir: folder }));
    if (kept !== null) lines.push(kept);
  }
  // A free GitHub plan can't protect a private repository, so on GitHub the line says protection is where the plan allows.
  // A project brought in keeps what its first computer set up: this computer adds only its own files.
  const lastJoin = list.filter((c) => c.id === 'join' || c.id.startsWith('join-')).at(-1);
  const joiningNow = lastJoin !== undefined && !NOT_JOINING.includes(lastJoin.label) && backupNamed(lastJoin.text) === null;
  if (toRun.includes(7) && joiningNow) {
    lines.push(`This computer's own Wheelhouse files set up here; the project on ${hostOf(product, list)} and its main line's protection stay as they are.`);
  } else if (toRun.includes(7)) {
    lines.push(keptHere ? 'Wheelhouse\'s settings saved to the project.'
      : hostOf(product, list) === 'GitHub' ? 'Wheelhouse\'s settings saved to the project, and its main line protected if your GitHub plan allows it (the free plan doesn\'t for a private repository).'
        : 'Wheelhouse\'s settings saved to the project, and its main line protected.');
  }
  if (toRun.includes(7) && keptHere) lines.push(FIRST_CHECK_LINE);
  // Never a plan with no lines: the health check is named when nothing else is.
  if (lines.length === 0 && toRun.includes(HEALTH_STEP)) lines.push('A last check that everything is safe.');
  const yours = list.some((c) => c.chosen !== null);
  const time = setupTime(toRun, list);
  const question = [
    nearlyDone ? `Finish setting up Wheelhouse for ${name}?` : `Set up Wheelhouse for ${name}${yours ? ' with your choices' : ''}?`,
    nearlyDone ? `Setup is nearly done. What's left takes ${time}:` : `${yours ? 'Here\'s the plan, with your choices.' : 'Here\'s what I recommend.'} It takes ${time}.`,
    ...lines.map((l) => `- ${l}`),
    'Nothing runs until you choose.',
    'To know more, just ask.',
  ].join('\n');
  // Go ahead stands only for a choice with an answer: the director's own or a card's recommendation. A card that
  // recommends nothing, unanswered, is asked at its step.
  const choices = list.filter((c) => c.label !== null && c.label !== undefined).map((c) => ({ key: c.key, label: c.label, text: c.text ?? null }));
  const records = list.filter((c) => c.chosen === null).flatMap((c) => {
    const labels = c.writes?.labels;
    return labels && Object.hasOwn(labels, c.label) ? labels[c.label] : [];
  });
  const id = `plan-${hash({ choices, count, facts }).slice(0, 12)}`;
  const card = {
    question,
    header: 'Setup',
    options: [
      { label: GO_AHEAD, description: `Recommended: setup does all of this now. ${goAheadAsks({ keptHere, list, host: hostOf(product, list), phone: toRun.includes(6) && !pushed })}` },
      yours
        ? { label: CHANGE_CHOICE, description: 'See every choice again, and change any before anything runs.' }
        : { label: CUSTOMISE, description: 'See every choice, and change any before anything runs.' },
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

// When Customise (or Change a choice) was last clicked on a one card of the run, or null.
export function customisingSince(answers) {
  const last = stepZero(answers).filter((a) => ONE_CARD_ID.test(a.id)).at(-1);
  return last?.label === CUSTOMISE || last?.label === CHANGE_CHOICE ? last.at : null;
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
      if (!mine || !newer(mine.at, found.at)) answers[c.key] = { label: c.label, text: c.text, at: found.at, consent: true };
    }
  }
  const newest = all.at(-1);
  return { answers, consent: consentHolds(newest, own) ? newest : null };
}

// The choices Customise asks now: those open and not answered since Customise was clicked, the first
// PER_CARD of them; empty once every one has been. The dry run takes the recommended Keep it here until the director says where
// the project is kept, and the backup question is only a local project's, so it waits for that answer. A card whose answer can
// bring another card before the ones after it (which GitLab) ends its batch.
export function customiseBatch(list, since) {
  const open = list.filter((c) => !(c.chosen && newer(c.chosen.at, since)));
  const unsaid = open.some((c) => KEPT_ID.test(c.id));
  const batch = open.filter((c) => !(unsaid && BACKUP_ID.test(c.id))).slice(0, PER_CARD);
  const ends = batch.findIndex((c) => c.endsBatch === true);
  return ends === -1 ? batch : batch.slice(0, ends + 1);
}

// Whether an id is one of step 0's redo cards.
export const isRedo = (id) => REDO_ID.test(id);
