// scripts/engine/order.js
// The work order (Archon design, section 7.4): everything one run is given, in place of the brief. The core builds it
// from the work record and the project's settings, and the helper keeps it under the run's id (orderStore), outside
// the run's reach. The run's first step asks the helper for it and writes a copy to its artefacts for reading only;
// the guards, the checks and the caps ask the helper again by the run's id, so a changed copy changes nothing.
//
//   Order = { v: 1, work, lane, goal, notInScope: [text], done: [Check], rulings: [text], decisionRules: [text],
//             caps: { minutes, tokens }, protectedFiles: [path], preview: { pages, styleGuide } | null,
//             showFirst, level, testCommand, bindings: { tiers?, aliases? },
//             slice?: { n, of, title }, flag?: { name, file } | { name, how }, demo?, feature?: { slices: [Slice] },
//             tried?: [{ run, step, failure, checks }] }
//   Slice = { n, title, pr, head }: a slice of the feature that merged (its head null when the host didn't say), for the feature's own run (its whole-feature
//   review and switch-on). `slice` and `demo` are a feature's slice run's; `flag` is the switch a feature's work sits
//   behind, in a file the core can flip or in the project's own way, given in words.
//   Check = { test } | { command, expect } | { page, mustShow }
// `expect` is the exit code a command must end with (a number), or text its output must hold. A `test` check runs the
// order's `testCommand` with the test's name added. `showFirst` is the work record's flag: visible work, unless the
// director waived it, waits for the director's approval before it is marked ready; an order without it isn't shown first.
// `level` is the work's decision level (main design, section 6), 3 unless the work says otherwise: the broker's permit
// holds a level-4 change for the director's signed approval.
// A `page` check is walked in a browser by the tester (the preview
// step), not by the done check.
import fs from 'node:fs';
import path from 'node:path';
import { SLUG } from '../lib/build-loop.js';
import { READER_LANE, READER_WORK } from '../delegation/reader.js';
import { MOST_TRIED, MOST_TRIED_CHECKS, TRIED_CHARS } from './recovery.js';

export const ORDER_VERSION = 1;
export const ORDER_LANES = Object.freeze(['quick', 'small', 'slice', 'feature', 'bug', 'fix-main']);

// The caps on one run of each lane (section 10.2): a starting point, tuned from the first month's cost records.
export const LANE_CAPS = Object.freeze({
  quick: Object.freeze({ minutes: 20, tokens: 1000000 }),
  small: Object.freeze({ minutes: 60, tokens: 4000000 }),
  slice: Object.freeze({ minutes: 120, tokens: 10000000 }),
  feature: Object.freeze({ minutes: 120, tokens: 10000000 }),
  bug: Object.freeze({ minutes: 30, tokens: 2000000 }),
  'fix-main': Object.freeze({ minutes: 30, tokens: 2000000 }),
});

// What a step settles itself and what it must take to its blocked exit (sections 7.2, main design section 6).
export const DECISION_RULES = Object.freeze([
  'Levels 1 and 2 are yours: a reversible choice within the work order and the rulings is made, and recorded as an assumption in your output.',
  'Level 3 is a blocked exit, never a choice you make: what users see beyond the goal, a setting, a dependency added or removed, a change to the guardrails or the project\'s settings, or the work order turning out to be wrong.',
  'Level 4 is a blocked exit, never a choice you make: money, security, personal data, deleting or migrating data, or anything that can\'t be undone.',
  'A test you would delete, skip or loosen is a blocked exit unless the work order lists its file.',
]);

// The project's test command when its settings name none: the test's name goes after it.
export const DEFAULT_TEST_COMMAND = 'npm test --';

// The file a feature's switch is kept in when the project has no way of its own: one JSON key a switch.
export const DEFAULT_FLAG_FILE = 'config/feature-flags.json';
// The most slices a feature has, and the longest the words saying how to set a project's own switch.
export const MOST_SLICES = 12;
const HOW_CHARS = 500;
const FULL_SHA = /^[0-9a-f]{40}$/;
const isCount = (n) => Number.isInteger(n) && n >= 1;

// Why `flag` isn't a feature's switch, or null. A file is a JSON file inside the repository.
function flagProblem(flag) {
  if (!isObject(flag) || typeof flag.name !== 'string' || !SLUG.test(flag.name)) return 'a feature\'s flag needs its name, as a short slug';
  const keys = Object.keys(flag).sort().join(',');
  if (keys === 'file,name') {
    const parts = typeof flag.file === 'string' ? flag.file.split('/') : [];
    const inside = parts.length > 0 && parts.every((p) => p !== '' && p !== '.' && p !== '..' && !p.includes('\\')) && !/^[A-Za-z]:/.test(flag.file);
    return inside && flag.file.endsWith('.json') ? null : 'a feature\'s flag file is a JSON file inside the repository';
  }
  if (keys === 'how,name') return isText(flag.how) && flag.how.length <= HOW_CHARS ? null : 'a feature\'s flag is set as the words say, in short text';
  return 'a feature\'s flag is kept in a file, or set as the words say';
}

// Why the feature fields of `order` don't fit its lane, or null.
function featureProblem(order) {
  if (order.slice !== undefined) {
    if (order.lane !== 'slice') return 'only a slice order names its slice';
    const { n, of, title } = isObject(order.slice) ? order.slice : {};
    if (!isCount(n) || !isCount(of) || n > of || of > MOST_SLICES || !isText(title)) return `a slice is one of at most ${MOST_SLICES}, with its title`;
  }
  if (order.demo !== undefined && (order.lane !== 'slice' || typeof order.demo !== 'boolean')) return 'only a slice order says yes or no to a demo';
  if (order.flag !== undefined) {
    if (!['slice', 'feature'].includes(order.lane)) return 'only a slice or feature order names a flag';
    const problem = flagProblem(order.flag);
    if (problem) return problem;
  }
  if (order.feature !== undefined) {
    if (order.lane !== 'feature') return 'only a feature order lists its slices';
    const slices = isObject(order.feature) ? order.feature.slices : null;
    const ok = Array.isArray(slices) && slices.length >= 1 && slices.length <= MOST_SLICES
      && slices.every((s) => isObject(s) && isCount(s.n) && isText(s.title) && isCount(s.pr) && (s.head === null || FULL_SHA.test(s.head ?? '')));
    if (!ok) return 'a feature order lists each merged slice with its pull request and head';
  }
  return null;
}

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const texts = (value) => Array.isArray(value) && value.every(isText);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Why `check` isn't a done check, or null.
export function checkProblem(check) {
  if (!isObject(check)) return 'a done check must be a record';
  const keys = Object.keys(check).sort().join(',');
  if (keys === 'test') return isText(check.test) ? null : 'a test check needs the test';
  if (keys === 'command,expect') {
    if (!isText(check.command)) return 'a command check needs its command';
    const exitOk = Number.isInteger(check.expect) && check.expect >= 0 && check.expect <= 255;
    return exitOk || isText(check.expect) ? null : 'a command check expects an exit code or some text';
  }
  if (keys === 'mustShow,page') return isText(check.page) && isText(check.mustShow) ? null : 'a page check needs the page and what must show';
  return 'a done check is a test, a command with what it should give, or a page with what must show';
}

// The director's answers to earlier questions on this work, as the helper recorded them: the latest MOST_ANSWERS,
// each side at most ANSWER_CHARS long, for the builder to read as data.
export const MOST_ANSWERS = 10;
export const ANSWER_CHARS = 500;
// The longest end of a red check's output an order carries; the signed record keeps no more.
const MOST_CHECK_TAIL = 4096;
// What a `tried` list holds: earlier runs' failures, from the helper's record (recovery.js).
const isTried = (t) => isObject(t) && Object.keys(t).sort().join() === 'checks,failure,run,step'
  && isText(t.run) && (t.step === null || isText(t.step)) && isText(t.failure) && texts(t.checks) && t.checks.length <= MOST_TRIED_CHECKS
  && [t.run, t.step ?? '', t.failure, ...t.checks].every((x) => x.length <= TRIED_CHARS);
const isAnswer = (a) => isObject(a) && Object.keys(a).sort().join() === 'answer,question'
  && isText(a.question) && isText(a.answer) && a.question.length <= ANSWER_CHARS && a.answer.length <= ANSWER_CHARS;

// Why `order` isn't a well-formed order, or null.
export function checkOrder(order) {
  if (!isObject(order) || order.v !== ORDER_VERSION) return 'a work order must be a version 1 record';
  // A reader has no work: its stand-in names the card it reads, so the helper can place its run and give it its view.
  if (order.lane === READER_LANE) return order.work === READER_WORK && isText(order.card) ? null : 'a reader\'s stand-in order names its card';
  // The work names folders (previews/<work>/), so it is a plain slug.
  if (typeof order.work !== 'string' || !SLUG.test(order.work)) return 'a work order needs its work, as a short slug';
  if (!ORDER_LANES.includes(order.lane)) return 'a work order needs its lane';
  if (!isText(order.goal)) return 'a work order needs its goal';
  if (!texts(order.notInScope) || !texts(order.rulings) || !texts(order.decisionRules) || !texts(order.protectedFiles)) {
    return 'a work order\'s lists must hold text';
  }
  // While a project's tests aren't counting a change rests on review, so a lane may start with nothing to run (spec 4.5).
  if (!Array.isArray(order.done) || (order.done.length === 0 && order.testsNotCounting !== true)) return 'a work order needs at least one done check';
  for (const check of order.done) {
    const problem = checkProblem(check);
    if (problem) return problem;
  }
  const { caps } = order;
  if (!isObject(caps) || !Number.isInteger(caps.minutes) || caps.minutes < 1 || !Number.isInteger(caps.tokens) || caps.tokens < 1) {
    return 'a work order needs its caps';
  }
  if (order.preview !== null && !(isObject(order.preview) && texts(order.preview.pages) && (order.preview.styleGuide === null || isText(order.preview.styleGuide)))) {
    return 'a work order\'s preview needs its pages and style guide';
  }
  if (order.showFirst !== undefined && typeof order.showFirst !== 'boolean') return 'a work order says yes or no to being shown first';
  if (order.level !== undefined && ![1, 2, 3, 4].includes(order.level)) return 'a work order\'s level is 1, 2, 3 or 4';
  if (!isText(order.testCommand) && !(order.testCommand === null && order.testsNotCounting === true)) return 'a work order needs the project\'s test command';
  if (order.testCommand === null && order.done.some((check) => Object.hasOwn(check, 'test'))) return 'a test check needs the project\'s test command, and this project has none yet';
  if (!isObject(order.bindings)) return 'a work order needs its model bindings';
  if (order.answers !== undefined && !(Array.isArray(order.answers) && order.answers.length <= MOST_ANSWERS && order.answers.every(isAnswer))) {
    return 'a work order\'s answers are each a question and its answer, in short text';
  }
  if (order.tried !== undefined && !(Array.isArray(order.tried) && order.tried.length <= MOST_TRIED && order.tried.every(isTried))) return 'a work order\'s tried list is earlier runs, each its run, step, failure and checks, in short text';
  if (order.goalId !== undefined && !(typeof order.goalId === 'string' && SLUG.test(order.goalId))) return 'a work order names its goal as a short slug';
  // A fix for a red main line names its incident (section 7.7); no other lane does.
  if (order.checkTail !== undefined && !(typeof order.checkTail === 'string' && order.checkTail.length <= MOST_CHECK_TAIL)) return 'a work order\'s check tail is text, 4 KB at most';
  if (order.incident !== undefined && !(order.lane === 'fix-main' && typeof order.incident === 'string' && SLUG.test(order.incident))) return 'only a fix-main order names an incident, as a short slug';
  return featureProblem(order);
}

// The routing table's column in force ({ role: { model } }, as resolveRouting gives it) as the pack's tier bindings
// (spec 7.6): `large` for critical building, `medium` for building, `small` for mechanical work. A role with no model
// names no tier, so the pack's own tier stands for it.
const TIER_ROLES = Object.freeze({ large: 'builderCritical', medium: 'builder', small: 'mechanical' });
export function bindingsOf(roles) {
  const tiers = {};
  for (const [tier, role] of Object.entries(TIER_ROLES)) {
    const model = roles?.[role]?.model;
    if (typeof model === 'string' && model !== '') tiers[tier] = model;
  }
  return Object.keys(tiers).length > 0 ? { tiers } : {};
}

// The order for one run of `work` (a work record: { id, lane, goal, notInScope?, done, protectedFiles?, visible?,
// shownFirst?, level? }),
// with `rulings` (text), the routing table's column in force as `routing` ({ tiers?, aliases? }), and the project's
// settings as `config` ({ pages?, styleGuide?, testCommand? }); `caps` ({ minutes, tokens }) in place of the lane's own, as
// the project's settings give them; `answers` ([{ question, answer }]) the director's answers to the work's earlier
// questions, from the helper's own record; `extra` a feature's fields ({ slice, flag, demo, feature, showFirst }), from
// the core's reading of the approved design, with `showFirst` in place of the work's own, and `goalId`, the goal it is for. Throws, in plain words, on
// anything an order can't be.
export function workOrder({ work, rulings = [], routing = {}, config = {}, caps = null, answers = [], extra = {} } = {}) {
  if (!isObject(work)) throw new Error('A work order needs the work it is for');
  if (work.model !== undefined || work.models !== undefined) throw new Error('A work record names a model: the routing table is the one place that does');
  const order = {
    v: ORDER_VERSION,
    work: work.id,
    lane: work.lane,
    goal: work.goal,
    notInScope: [...(work.notInScope ?? [])],
    done: (work.done ?? []).map((check) => ({ ...check })),
    rulings: [...rulings],
    decisionRules: [...DECISION_RULES],
    caps: caps ? { ...caps } : LANE_CAPS[work.lane] ? { ...LANE_CAPS[work.lane] } : null,
    protectedFiles: [...(work.protectedFiles ?? [])],
    preview: work.visible === true ? { pages: [...(config.pages ?? [])], styleGuide: config.styleGuide ?? null } : null,
    showFirst: work.visible === true && work.shownFirst !== false,
    level: [1, 2, 3, 4].includes(work.level) ? work.level : 3,
    testCommand: config.testsNotCounting === true ? config.testCommand ?? null : config.testCommand ?? DEFAULT_TEST_COMMAND,
    ...(config.testsNotCounting === true ? { testsNotCounting: true } : {}),
    bindings: { ...(routing.tiers ? { tiers: { ...routing.tiers } } : {}), ...(routing.aliases ? { aliases: { ...routing.aliases } } : {}) },
    answers: (Array.isArray(answers) ? answers : []).slice(-MOST_ANSWERS).map((a) => ({
      question: typeof a?.question === 'string' ? a.question.slice(0, ANSWER_CHARS) : a?.question,
      answer: typeof a?.answer === 'string' ? a.answer.slice(0, ANSWER_CHARS) : a?.answer,
    })),
  };
  for (const key of ['slice', 'flag', 'demo', 'feature', 'tried', 'goalId']) if (extra?.[key] !== undefined) order[key] = structuredClone(extra[key]);
  if (typeof extra?.showFirst === 'boolean') order.showFirst = extra.showFirst;
  const problem = checkOrder(order);
  if (problem) throw new Error(problem.charAt(0).toUpperCase() + problem.slice(1));
  return order;
}

// A run's id as a single file name: letters, digits, dots, hyphens and underscores, and not dots alone.
const RUN_ID = /^[A-Za-z0-9._-]{1,128}$/;
export const isRunId = (id) => typeof id === 'string' && RUN_ID.test(id) && !/^\.+$/.test(id);

// The helper's store of orders in `dir`, one file a run, readable by this user only. An order is written once: a
// second save for the same run is refused, so an order never changes under a run.
export function orderStore(dir) {
  const file = (runId) => path.join(dir, `${runId}.json`);
  return {
    save(runId, order) {
      if (!isRunId(runId)) throw new Error('A run id is one name of letters, digits, dots, hyphens and underscores');
      const problem = checkOrder(order);
      if (problem) throw new Error(problem);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        fs.writeFileSync(file(runId), `${JSON.stringify(order, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('That run already has its work order');
        throw error;
      }
    },
    // The run's order, or null when there is none (or it can't be read, or the id isn't one).
    load(runId) {
      if (!isRunId(runId)) return null;
      try {
        const order = JSON.parse(fs.readFileSync(file(runId), 'utf8'));
        return checkOrder(order) === null ? order : null;
      } catch {
        return null;
      }
    },
  };
}
