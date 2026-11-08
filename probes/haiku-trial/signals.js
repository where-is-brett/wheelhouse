// probes/haiku-trial/signals.js
// The 45 path rows of the Haiku trial (spec section 6): each reads one pass signal from the context the runner gathers.
import { listEvents } from '../../scripts/state/events.js';
import { buildViews } from '../../scripts/state/views.js';
import { readEnrolled } from '../../scripts/state/signing.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { readIncidents, BAR } from '../../scripts/watcher/reliability.js';
import { RESUME_LIMIT } from '../../scripts/watcher/resume.js';
import { WHY_LIMIT_MS } from '../../scripts/decisions/why.js';
import { UNDO_BRANCH, undoTitle, CONFLICT_LINE } from '../../scripts/host/undo.js';
import { PHONE_LIMIT, shapeProblems } from '../../scripts/cards/compose.js';
import { FRONT_DESK_LINE } from '../../scripts/hooks/session-start.js';
import { PLAN_FILE } from '../../scripts/engine/plan-file.js';
import { STUCK_AFTER } from '../../scripts/feature/cli.js';
import { asDirectorsCall } from '../../scripts/decisions/log.js';
import { CLEARED_WORDS } from '../../scripts/host/decision-status.js';
import { DECISION_CONTEXT } from '../../scripts/checks/where.js';
import { WAITING_ON_DECISION } from '../../scripts/gate/conditions.js';
import { alertText } from '../../scripts/alerts/send.js';
import { PHONE_NEXT } from '../../scripts/setup/engine.js';
import { auditModels, auditPeek, entriesOf } from './audit.js';
import { PIECES, P6_FILE } from './requests.js';
import { deskBusy } from './stand-in.js';
import { modelPattern } from './models.js';

// The event kinds and names the rows read, each as the module that writes it spells it.
export const KINDS = Object.freeze({
  work: 'work', // scripts/state/events.js: intake's record of a request, with its lane and visibility
  card: 'card',
  cardAnswer: 'card-answer',
  action: 'action', // a click on a card; `approve-work`, `lift-stop` and `lift-incident` are its actions
  approval: 'approval',
  question: 'question', // a decision, as the feature CLI's `ask` writes it
  decisionAnswer: 'decision-answer',
  agentCall: 'agent-call',
  selfMerged: 'self-merged',
  merge: 'merge',
  incident: 'incident',
  incidentClosed: 'incident-closed',
  run: 'run',
  ruling: 'ruling',
  confirm: 'confirm', // the kind of card a ruling's confirm card has
  approveWork: 'approve-work',
  liftStop: 'lift-stop',
  liftIncident: 'lift-incident',
  resumed: 'resumed', // scripts/watcher/reliability.js: an incident kind
  lost: 'lost',
});

// The kinds above that are records in the event log (the rest are card kinds, action names and incident kinds).
export const EVENT_KINDS = Object.freeze([
  KINDS.work, KINDS.card, KINDS.cardAnswer, KINDS.action, KINDS.approval, KINDS.question, KINDS.decisionAnswer, KINDS.agentCall,
  KINDS.selfMerged, KINDS.merge, KINDS.incident, KINDS.incidentClosed, KINDS.run, KINDS.ruling,
]);

// The line setup ends on, as scripts/setup/engine.js words it: "Every step is done." or the phone-notifications line.
export const SETUP_DONE_LINE = 'Every step is done';
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const SETUP_DONE = new RegExp(`${escaped(SETUP_DONE_LINE)}|${escaped(PHONE_NEXT.split('.')[0])}`, 'i');

// The branches the runner or Wheelhouse itself makes, which are not a piece's work.
export const OWN_BRANCH = /^(trial\/|wheelhouse\/(undo|decisions))/;

// The names the runner gives the steps it writes to its own log (`runLog`): `{ at, step, note, work?, detail? }`.
export const STEPS = Object.freeze({
  health: 'health', // setup's health check, note says the result
  pace: 'pace', // a sample of the pace, note "building 2, feature 1"
  start: 'start', // a piece started, `work` names its change
  review: 'review',
  tester: 'tester',
  workReady: 'work-ready', // the runner's note that a piece became ready: a quick or bug work not shown first, or a signed approve-work
  why: 'why', // the stand-in typed `why 1`
  whySeen: 'why-seen', // the why answer reached the pane, note holds its text
  stopSet: 'stop-set', // F6: All stop was set
  digest: 'digest', // the digest reached the chat
  fault: (id) => id, // a fault was made: the step is the fault's own id (F1, F3, F3b, F6 ...)
});

export const PROOF_HEADINGS = Object.freeze([
  'What changed', 'Why', 'Decided on its own', 'Decisions followed', 'How it was checked', 'What it looks like', 'The data before and after',
]);
export const FULL_ONLY = Object.freeze([34, 41]);

const SMOKE = new Set([1, 2, 3, 4, 5, 7, 8, 9, 13, 16, 17, 18, 21, 22, 25, 26, 27, 28, 29, 31, 33, 44, 45]);
const MINUTE = 60 * 1000;

// --- reading helpers ---

const ms = (iso) => Date.parse(iso);
const ok = (evidence) => ({ pass: true, evidence });
const no = (evidence) => ({ pass: false, evidence });
const unknown = (evidence) => ({ pass: null, evidence });
// A fault the run never reached tells nothing about Wheelhouse, so its row is not covered rather than failed.
const NOT_REACHED = (what) => `not covered: the run stopped before ${what}`;
const verdict = (problems, good) => (problems.length === 0 ? ok(good) : no(problems.join('; ')));

const events = (ctx, kind) => (ctx.events ?? []).filter((e) => e.kind === kind);
const piece = (ctx, id) => ctx.pieces?.[id];
const work = (ctx, id) => piece(ctx, id)?.change;
const prsOf = (ctx, id) => (piece(ctx, id)?.prs ?? []).map((n) => (ctx.prs ?? []).find((p) => p.number === n)).filter(Boolean);
const spec = (id) => PIECES.find((p) => p.id === id);
const paneTexts = (ctx, name) => (name === undefined ? Object.values(ctx.panes ?? {}).flat() : ctx.panes?.[name] ?? []);
const paneAll = (ctx) => paneTexts(ctx).join('\n');
const logOf = (ctx, step) => (ctx.runLog ?? []).filter((e) => e.step === step);
const filesOf = (pr) => (pr.commits ?? []).flatMap((c) => c.files ?? []);
const touchesPlan = (pr) => (pr.commits ?? []).some((c) => (c.files ?? []).includes(PLAN_FILE));
const isTestFile = (f) => /(^|\/)(tests?|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
const firstCommitAt = (pr) => Math.min(...(pr.commits ?? []).map((c) => ms(c.date)).filter(Number.isFinite));
const isBranch = (re) => (p) => re.test(p.head ?? '');
const RECORDS_BRANCH = /^wheelhouse\/decisions-(\d{4}-\d{2}-\d{2})$/;

// Which of a row's pieces ran. A full run needs them all; a smoke run leaves out those it did not start.
function scope(ctx, ids) {
  const have = ids.filter((id) => piece(ctx, id) !== undefined);
  const missing = ids.filter((id) => !have.includes(id));
  if (missing.length > 0 && ctx.smoke !== true) return { have, stop: no(`${missing.join(', ')} did not run`) };
  if (have.length === 0 && ids.length > 0) return { have, stop: unknown(`${ids.join(', ')} not run in this smoke run`) };
  return { have, stop: null };
}

// The cards that ask the director to approve a pull request, and the plan card of a work.
const approvalCards = (ctx, number) => events(ctx, KINDS.card).filter((c) => c.data?.kind === KINDS.approval
  && new RegExp(`pull request #${number}\\b`).test(`${c.data.line ?? ''} ${c.data.question ?? ''}`));
const planCards = (ctx, change) => events(ctx, KINDS.card).filter((c) => c.data?.kind === KINDS.approveWork && JSON.stringify(c.data).includes(change));
// When the director's answer to a card came: a card-answer naming it, or an approval record for its pull request.
function answeredAt(ctx, card, number) {
  const times = [];
  for (const a of events(ctx, KINDS.cardAnswer)) if (a.data?.card === card.id || (a.data?.question !== undefined && a.data.question === card.data?.question)) times.push(ms(a.at));
  if (number !== undefined) for (const a of events(ctx, KINDS.approval)) if (a.data?.pr === number) times.push(ms(a.at));
  return times.length === 0 ? null : Math.min(...times);
}
const selfMerges = (ctx, change, prs) => events(ctx, KINDS.selfMerged).filter((e) => e.data?.work === change || prs.some((p) => p.number === e.data?.pr));
const answerAtOf = (ctx, pick) => {
  const found = events(ctx, KINDS.decisionAnswer).filter(pick).map((e) => ms(e.at));
  return found.length === 0 ? Infinity : Math.min(...found);
};
const section = (body, heading) => {
  const lines = String(body ?? '').split(/\r?\n/);
  const at = lines.findIndex((l) => new RegExp(`^\\s*(?:#{1,6}\\s*|\\*\\*)${heading}\\b`, 'i').test(l));
  if (at < 0) return null;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => /^\s*(?:#{1,6}\s|\*\*[A-Z])/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
};
const images = (text) => (String(text).match(/!\[[^\]]*\]\([^)]*\)|<img\b/gi) ?? []).length;

const roleOf = (ctx) => ({ ...(ctx.config?.routing ?? {}) });

// --- the rows ---

const checks = {
  1(ctx) {
    const problems = [];
    const said = paneAll(ctx) + '\n' + (ctx.events ?? []).filter((e) => e.kind === 'note').map((e) => JSON.stringify(e.data)).join('\n');
    if (!SETUP_DONE.test(said)) problems.push('no line saying setup is done');
    const roles = Object.entries(roleOf(ctx)).filter(([, v]) => typeof v === 'string');
    if (roles.length === 0) problems.push('the configuration names no role');
    const want = modelPattern(ctx.model);
    const wantName = ctx.model ?? 'haiku';
    for (const [role, model] of roles) if (!want.test(model)) problems.push(`role ${role} is not on ${wantName} (${model})`);
    const pins = ctx.config?.tiers?.pins ?? {};
    for (const pin of ['mostCapable', 'midSized']) if (!want.test(String(pins[pin] ?? ''))) problems.push(`pin ${pin} is not ${wantName}`);
    const premium = ctx.views?.settings?.premium?.value ?? 'off';
    if (premium !== 'off') problems.push(`premium is ${premium}, not off`);
    if (!logOf(ctx, STEPS.health).some((e) => /pass/i.test(e.note ?? '') && !/fail/i.test(e.note ?? ''))) problems.push('the health check did not pass');
    return verdict(problems, `setup done, every role and pin on ${wantName}, premium off, health check passed`);
  },
  2(ctx) {
    const problems = [];
    const inPane = paneTexts(ctx, 'front-desk').some((t) => t.includes(FRONT_DESK_LINE));
    const inTranscript = (ctx.transcripts ?? []).filter((t) => t.role === 'front-desk').some((t) => entriesOf(t.file).some((e) => JSON.stringify(e).includes(FRONT_DESK_LINE)));
    if (!inPane && !inTranscript) problems.push('no session-start context for the front desk');
    // A capture of a desk that was still working holds a spinner, not a reply: it is neither judged nor counted.
    const replies = paneTexts(ctx, 'replies').filter((t) => String(t).trim() !== '' && !deskBusy(String(t)));
    if (replies.length === 0) problems.push('no finished front-desk reply was captured');
    replies.forEach((text, i) => {
      const lines = String(text).split('\n').length;
      if (String(text).length > PHONE_LIMIT.chars || lines > PHONE_LIMIT.lines) problems.push(`reply ${i + 1} is ${String(text).length} characters and ${lines} lines`);
    });
    const offenders = (ctx.audit?.models?.offenders ?? []).filter((o) => o.role === 'front-desk');
    if (offenders.length > 0) problems.push(`front-desk ran on ${offenders.map((o) => o.model).join(', ')}`);
    return verdict(problems, `session-start context seen; ${replies.length} replies within ${PHONE_LIMIT.chars} characters; front-desk audit clean`);
  },
  3(ctx) {
    const s = scope(ctx, PIECES.map((p) => p.id));
    if (s.stop) return s.stop;
    const problems = [];
    for (const id of s.have) {
      const w = events(ctx, KINDS.work).find((e) => e.data?.id === work(ctx, id));
      if (!w) problems.push(`${id} has no intake event`);
      else if (w.data.lane !== spec(id).lane) problems.push(`${id} went to lane ${w.data.lane}, expected ${spec(id).lane}`);
    }
    return verdict(problems, `${s.have.length} pieces took the lane the plan expects`);
  },
  4(ctx) {
    const s = scope(ctx, ['P6']);
    if (s.stop) return s.stop;
    const problems = [];
    const prs = prsOf(ctx, 'P6');
    if (prs.some(touchesPlan)) problems.push('P6 has a plan file');
    const ready = logOf(ctx, STEPS.workReady).filter((e) => e.work === work(ctx, 'P6'));
    if (ready.length === 0) problems.push('no work-ready for P6');
    if (!prs.some((p) => p.mergedAt)) problems.push('P6 has no merged pull request');
    const cards = [...planCards(ctx, work(ctx, 'P6')), ...prs.flatMap((p) => approvalCards(ctx, p.number))];
    if (ready.length > 0 && cards.some((c) => ms(c.at) < ms(ready[0].at))) problems.push('an approval card came before work-ready');
    return verdict(problems, 'no plan file, work-ready with no approval card before it, and a merged pull request');
  },
  5(ctx) {
    const s = scope(ctx, ['P2', 'P4', 'P7']);
    if (s.stop) return s.stop;
    const problems = [];
    for (const id of s.have) {
      const prs = prsOf(ctx, id);
      if (!prs.some(touchesPlan)) problems.push(`${id} has no plan file`);
      const card = planCards(ctx, work(ctx, id)).length + prs.reduce((n, p) => n + approvalCards(ctx, p.number).length, 0) > 0;
      if (card !== spec(id).visible) problems.push(`${id} ${card ? 'has' : 'lacks'} an approval card but is ${spec(id).visible ? '' : 'not '}visible`);
    }
    return verdict(problems, 'plans written; approval cards only for visible pieces');
  },
  6(ctx) {
    const s = scope(ctx, ['P5']);
    if (s.stop) return s.stop;
    const prs = prsOf(ctx, 'P5');
    const first = prs.flatMap((p) => p.commits ?? []).sort((a, b) => ms(a.date) - ms(b.date))[0];
    if (!first) return no('P5 has no commit');
    const files = first.files ?? [];
    if (files.length === 0 || !files.every(isTestFile)) return no(`the first commit changes ${files.filter((f) => !isTestFile(f)).join(', ') || 'no files'}, not only tests`);
    const red = (ctx.runs ?? []).some((r) => r.headSha === first.sha && r.conclusion === 'failure') || piece(ctx, 'P5').redAtFirstCommit === true;
    return red ? ok('the first commit adds only tests, and they fail there') : unknown('the first commit adds only tests, but no failing check or local run was recorded for it');
  },
  7(ctx) {
    const s = scope(ctx, ['P1', 'P3']);
    if (s.stop) return s.stop;
    const problems = [];
    for (const id of s.have) {
      const change = work(ctx, id);
      const [card] = planCards(ctx, change);
      if (!card) { problems.push(`${id} has no plan card`); continue; }
      const at = answeredAt(ctx, card);
      if (at === null) { problems.push(`${id}'s plan card was never answered`); continue; }
      const ready = logOf(ctx, STEPS.workReady).filter((e) => e.work === change && ms(e.at) >= at);
      if (ready.length === 0) problems.push(`no work-ready for ${id} after its plan card was answered`);
    }
    return verdict(problems, 'plan card shown, answered, then work-ready');
  },
  8(ctx) {
    const s = scope(ctx, ['P1', 'P3']);
    if (s.stop) return s.stop;
    const problems = [];
    for (const id of s.have) {
      const change = work(ctx, id);
      const [card] = planCards(ctx, change);
      const clicks = events(ctx, KINDS.action).filter((e) => e.data?.action === KINDS.approveWork && e.data.work === change);
      const signed = clicks.filter((e) => e.sig && typeof e.sig === 'object' && e.data.proof !== 'window');
      if (!card) problems.push(`${id} has no plan card`);
      else if (answeredAt(ctx, card) === null) problems.push(`${id}'s plan card has no card-answer`);
      if (signed.length === 0) problems.push(`${id} has no signed answer through the picker`);
    }
    return verdict(problems, 'plan cards answered through the picker and signed');
  },
  9(ctx) {
    const problems = [];
    const samples = [];
    const open = new Map();
    const runs = events(ctx, KINDS.run).filter((e) => ['started', 'paused', 'ended'].includes(e.data?.state)).sort((a, b) => ms(a.at) - ms(b.at));
    let building = 0;
    let features = 0;
    for (const r of runs) {
      const key = r.data.runId ?? r.id;
      const lane = r.data.lane;
      const was = open.get(key);
      if (r.data.state === 'started' && was === undefined) { open.set(key, lane); building += 1; if (lane === 'feature') features += 1; }
      if (r.data.state !== 'started' && was !== undefined) { open.delete(key); building -= 1; if (was === 'feature') features -= 1; }
      samples.push({ building, features });
    }
    for (const e of logOf(ctx, STEPS.pace)) {
      samples.push({ building: Number(/building (\d+)/.exec(e.note ?? '')?.[1] ?? 0), features: Number(/features? (\d+)/.exec(e.note ?? '')?.[1] ?? 0) });
    }
    if (samples.length === 0) return unknown('no run records and no pace samples were kept');
    const most = Math.max(...samples.map((x) => x.building));
    const lanes = Math.max(...samples.map((x) => x.features));
    if (most > 3) problems.push(`${most} sessions building at once`);
    if (lanes > 1) problems.push(`${lanes} feature lanes at once`);
    return verdict(problems, `at most ${most} building and ${lanes} feature lane at once over ${samples.length} readings`);
  },
  10(ctx) {
    const s = scope(ctx, PIECES.map((p) => p.id));
    if (s.stop) return s.stop;
    const problems = [];
    for (const id of s.have) {
      const prs = prsOf(ctx, id);
      if (prs.length === 0) problems.push(`${id} has no pull request`);
      else if (!prs.some((p) => filesOf(p).some(isTestFile))) problems.push(`${id}'s pull request has no test files`);
    }
    if (problems.length > 0) return no(problems.join('; '));
    // The steps are read from what Wheelhouse records: a run's cost names the roles that did its steps, and a review is a signed record.
    const roles = events(ctx, 'cost').flatMap((e) => Object.keys(e.data?.byRole ?? {}));
    const reviewed = events(ctx, 'review').length > 0 || roles.some((r) => /review/i.test(r)) || logOf(ctx, STEPS.review).length > 0;
    const tested = roles.some((r) => /test/i.test(r)) || logOf(ctx, STEPS.tester).length > 0;
    if (reviewed && tested) return ok('every pull request has tests; a review and a tester step were recorded');
    const missing = [!reviewed && 'review', !tested && 'tester'].filter(Boolean).join(' and ');
    return unknown(`every pull request has tests; no ${missing} step is recorded (cost roles: ${[...new Set(roles)].join(', ') || 'none'})`);
  },
  11(ctx) {
    const s = scope(ctx, ['P3']);
    if (s.stop) return s.stop;
    const prs = prsOf(ctx, 'P3').sort((a, b) => a.number - b.number);
    const problems = [];
    if (prs.length !== 2) problems.push(`P3 has ${prs.length} pull requests, not 2`);
    if (prs.some((p) => !touchesPlan(p))) problems.push('a P3 pull request has no plan file of its own');
    if (prs.some((p) => !p.mergedAt)) problems.push('a P3 pull request did not merge');
    else if (prs.length === 2 && ms(prs[0].mergedAt) > ms(prs[1].mergedAt)) problems.push('the slices merged out of order');
    return verdict(problems, 'two pull requests, each with its own plan, merged in order');
  },
  12(ctx) {
    const s = scope(ctx, ['P4', 'P7']);
    if (s.stop) return s.stop;
    const problems = [];
    const wait = /waits: its plan touches src\/pages\/month\.js, which .* is changing/;
    const texts = [...paneTexts(ctx), ...(ctx.runLog ?? []).map((e) => e.note ?? '')];
    if (!texts.some((t) => wait.test(t))) problems.push('the wait text was not seen');
    const p4 = prsOf(ctx, 'P4').find((p) => p.mergedAt);
    const p7 = prsOf(ctx, 'P7')[0];
    if (!p4 || !p7) problems.push('P4 or P7 has no pull request');
    else if (!(firstCommitAt(p7) > ms(p4.mergedAt))) problems.push("P7's first commit is not after P4's merge");
    return verdict(problems, "the wait text was seen and P7 started after P4's merge");
  },
  13(ctx) {
    const s = scope(ctx, ['P4']);
    if (s.stop) return s.stop;
    const asked = events(ctx, KINDS.question).filter((e) => e.data?.work === work(ctx, 'P4') && e.data.level === 3);
    if (asked.length === 0) return no('P4 raised no level 3 decision');
    const d = asked[0].data;
    const problems = shapeProblems({ what: d.what, why: d.why, options: d.options, recommendation: d.recommendation, because: d.because, holds: d.holds, meanwhile: d.meanwhile, work: d.work });
    return verdict(problems, "P4's decision has 2 to 4 options with cost and undo, a recommendation, a because and a meanwhile, and fits a phone");
  },
  14(ctx) {
    const f = ctx.faults?.F1;
    if (!f) return unknown('F1 was not run');
    const problems = [];
    if (f.code !== 2) problems.push(`the exit code was ${f.code}, not 2`);
    if (f.sentBack !== true) problems.push('the decision was not sent back');
    const natural = Number.isInteger(f.naturalSendBacks) ? `${f.naturalSendBacks} natural send-back(s) in P4's questions` : "P4's natural send-backs were not read";
    return verdict(problems, `exit 2 and sent back; ${natural}; a stuck ending is a finding, not a failure`);
  },
  15(ctx) {
    const f = ctx.faults?.F1b;
    if (!f) return unknown('F1b was not run');
    if (typeof f.why !== 'string' || f.why === '') return no(`the third try was not followed by a stuck message${f.stuckAt === null ? ' (the command never asked for one)' : ''}`);
    return paneTexts(ctx, 'front-desk').some((t) => t.includes(f.why)) ? ok('the stuck message reached the front desk') : no('the stuck message is not in the front desk pane');
  },
  16(ctx) {
    const s = scope(ctx, ['P4']);
    if (s.stop) return s.stop;
    const problems = [];
    const prs = prsOf(ctx, 'P4');
    const waiting = prs.flatMap((p) => p.statuses ?? []).some((st) => st.context === DECISION_CONTEXT && /^Waiting on decision 1$/.test(st.description ?? ''));
    if (!waiting) problems.push(`no ${DECISION_CONTEXT} status reading "Waiting on decision 1"`);
    const answered = answerAtOf(ctx, (e) => e.data?.n === 1 || e.data?.n === undefined);
    for (const p of prs) if (p.mergedAt && ms(p.mergedAt) < answered) problems.push(`pull request #${p.number} merged before the decision was answered`);
    for (const m of events(ctx, KINDS.merge)) {
      if (prs.some((p) => p.number === m.data?.pr) && ms(m.at) < answered) problems.push('a merge record came before the answer');
    }
    const gate = [...paneTexts(ctx), ...(ctx.runLog ?? []).map((e) => e.note ?? '')].some((t) => t.includes(WAITING_ON_DECISION));
    return verdict(problems, `status "Waiting on decision 1", no merge before the answer; gate reason ${gate ? `${WAITING_ON_DECISION} seen` : 'not seen in the log'}`);
  },
  17(ctx) {
    const s = scope(ctx, ['P4']);
    if (s.stop) return s.stop;
    const change = work(ctx, 'P4');
    const asked = events(ctx, KINDS.question).filter((e) => e.data?.work === change).map((e) => ms(e.at));
    if (asked.length === 0) return no('P4 raised no decision');
    const from = Math.min(...asked);
    const until = answerAtOf(ctx, () => true);
    const inside = (at) => ms(at) >= from && ms(at) <= until;
    const started = [
      ...logOf(ctx, STEPS.start).filter((e) => e.work !== change && inside(e.at)),
      ...events(ctx, KINDS.run).filter((e) => e.data?.state === 'started' && e.data.work !== change && inside(e.at)),
    ];
    return started.length > 0 ? ok(`${started.length} other start(s) while P4 waited`) : no('no other piece started while P4 waited');
  },
  18(ctx) {
    const s = scope(ctx, ['P4']);
    if (s.stop) return s.stop;
    const problems = [];
    const first = events(ctx, KINDS.decisionAnswer).find((e) => e.data?.private !== true);
    if (!first) problems.push('no decision-answer');
    else {
      if (first.data.where !== 'chat') problems.push(`the answer came from ${first.data.where}, not chat`);
      if (first.data.label !== 'B') problems.push(`the label was ${first.data.label}, not B`);
    }
    const prs = prsOf(ctx, 'P4');
    if (!prs.flatMap((p) => p.statuses ?? []).some((st) => st.description === CLEARED_WORDS)) problems.push(`the status never read "${CLEARED_WORDS}"`);
    if (!prs.some((p) => p.mergedAt)) problems.push('P4 did not merge');
    return verdict(problems, `a chat answer B, then "${CLEARED_WORDS}", and P4 merged`);
  },
  19(ctx) {
    const text = paneAll(ctx);
    const notes = [
      ['an ambiguous reply', /could answer decision \d+ or \d+/],
      ['an already-answered reply', /was already answered/],
      ['a reply beyond the options', /named an option decision \d+ doesn't offer/],
      ['a reply to no decision', /No decision \d+ is waiting, so nothing was recorded/],
      ['why n', /asked why about decision \d+/],
    ];
    const problems = notes.filter(([, re]) => !re.test(text)).map(([name]) => `no note for ${name}`);
    const answers = events(ctx, KINDS.decisionAnswer);
    if (answers.some((a) => a.data?.n === 3 || !/^(?:[A-D]|own)$/.test(a.data?.label ?? ''))) problems.push('an edge reply was recorded');
    const count = new Map();
    // The number a decision has in the chat repeats from one work to the next: the question id is what tells decisions apart.
    for (const a of answers) {
      const key = a.data?.question ?? `n${a.data?.n}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    if ([...count.values()].some((n) => n > 1)) problems.push('a decision was answered twice');
    return verdict(problems, 'each edge reply gave its note and recorded nothing');
  },
  20(ctx) {
    const s = scope(ctx, ['P4']);
    if (s.stop) return s.stop;
    const answers = events(ctx, KINDS.decisionAnswer);
    const hidden = answers.filter((a) => a.data?.private === true);
    if (hidden.length === 0) return no('no decision-answer with private: true');
    const files = prsOf(ctx, 'P4').flatMap(filesOf).filter((f) => f.startsWith('docs/decisions/'));
    const open = answers.filter((a) => a.data?.private !== true).length;
    return new Set(files).size > open ? no('a file under docs/decisions/ exists for the private answer') : ok('a private answer, with no file of its own under docs/decisions/');
  },
  21(ctx) {
    const typed = logOf(ctx, STEPS.why)[0];
    const seen = logOf(ctx, STEPS.whySeen)[0];
    if (!typed || !seen) return no('why 1 was not typed, or its answer was not seen');
    const gap = ms(seen.at) - ms(typed.at);
    const fallback = /Here is what the card itself says|isn't waiting any more/.test(seen.note ?? '');
    if (fallback) return no('the answer is the fallback text');
    if (!(gap <= WHY_LIMIT_MS)) return no(`the answer took ${Math.round(gap / 1000)} seconds, over ${WHY_LIMIT_MS / 1000}`);
    return ok(`answered in ${Math.round(gap / 1000)} seconds`);
  },
  22(ctx) {
    const s = scope(ctx, ['P2', 'P3']);
    if (s.stop) return s.stop;
    const changes = s.have.map((id) => work(ctx, id));
    const calls = events(ctx, KINDS.agentCall).filter((e) => changes.includes(e.data?.work));
    return calls.length > 0 ? ok(`${calls.length} agent-call event(s)`) : no('no agent-call from P2 or P3');
  },
  23(ctx) {
    const text = ctx.faults?.F1c?.text;
    if (typeof text !== 'string') return unknown('F1c was not run');
    const full = asDirectorsCall('behaviour');
    return text.includes(full.split('. ')[0]) && text.includes('ask --about behaviour --level 3') ? ok('the refusal names ask --about behaviour --level 3') : no('the refusal text is not the pinned one');
  },
  24(ctx) {
    const pulled = events(ctx, KINDS.ruling).find((e) => /^Pulled back \[call /.test(e.data?.words ?? ''));
    if (!pulled) return no('no ruling for a pulled-back call');
    const card = events(ctx, KINDS.card).find((c) => c.data?.kind === KINDS.confirm && ms(c.at) >= ms(pulled.at) && JSON.stringify(c.data).includes(pulled.id));
    return card ? ok('the pulled-back call waits on a confirm card') : no('no confirm card for the pulled-back ruling');
  },
  25(ctx) {
    const merged = (ctx.prs ?? []).filter((p) => p.mergedAt && !OWN_BRANCH.test(p.head ?? ''));
    if (merged.length === 0) return unknown('no pull request merged');
    const problems = [];
    for (const p of merged) {
      const missing = PROOF_HEADINGS.filter((h) => section(p.body, h) === null);
      if (missing.length > 0) problems.push(`#${p.number} lacks ${missing.join(', ')}`);
    }
    return verdict(problems, `${merged.length} merged pull requests carry every heading`);
  },
  26(ctx) {
    if (ctx.previews === 'none') return unknown('no previews are available (section 5.5), so there are no pictures to find');
    const s = scope(ctx, ['P1', 'P3', 'P4', 'P7']);
    if (s.stop) return s.stop;
    const problems = [];
    for (const id of s.have) {
      const counts = prsOf(ctx, id).map((p) => images(section(p.body, 'What it looks like')));
      if (!counts.some((n) => n >= 2)) problems.push(`${id} has ${Math.max(0, ...counts)} pictures in "What it looks like", not 2`);
    }
    return verdict(problems, 'desktop and phone pictures for each touched page');
  },
  27(ctx) {
    const s = scope(ctx, ['P1']);
    if (s.stop) return s.stop;
    const texts = prsOf(ctx, 'P1').map((p) => section(p.body, 'The data before and after')).filter((t) => t !== null);
    if (texts.length === 0) return no('P1 has no "The data before and after" section');
    return texts.some((t) => /\btest\b/i.test(t)) ? ok('the data section names route test') : no('the data section does not name route test');
  },
  28(ctx) {
    const s = scope(ctx, ['P1', 'P2', 'P3', 'P7']);
    if (s.stop) return s.stop;
    const problems = [];
    for (const id of s.have) {
      const prs = prsOf(ctx, id);
      if (selfMerges(ctx, work(ctx, id), prs).length > 0) problems.push(`${id} self-merged`);
      for (const p of prs) {
        const [card] = approvalCards(ctx, p.number);
        if (!card) { problems.push(`${id} #${p.number} has no approval card`); continue; }
        const at = answeredAt(ctx, card, p.number);
        if (at === null) problems.push(`${id} #${p.number}'s card was never answered`);
        else if (!p.mergedAt || ms(p.mergedAt) < at) problems.push(`${id} #${p.number} ${p.mergedAt ? 'merged before the card was answered' : 'did not merge'}`);
      }
    }
    return verdict(problems, 'no self-merge, an approval card, and the merge after its answer');
  },
  29(ctx) {
    const s = scope(ctx, ['P6']);
    if (s.stop) return s.stop;
    const found = selfMerges(ctx, work(ctx, 'P6'), prsOf(ctx, 'P6'));
    if (found.length === 0) return no('P6 has no self-merged event');
    return found.some((e) => e.data.reason === 'internal') ? ok('P6 self-merged with reason internal') : no(`P6 self-merged with reason ${found.map((e) => e.data.reason).join(', ')}`);
  },
  30(ctx) {
    const s = scope(ctx, ['P8']);
    if (s.stop) return s.stop;
    const problems = [];
    const intake = events(ctx, KINDS.work).find((e) => e.data?.id === work(ctx, 'P8'));
    if (!intake || intake.data.visible !== false) problems.push('intake did not mark P8 as not visible');
    const gate = piece(ctx, 'P8').gate;
    if (!gate || gate.visible !== true) problems.push('the gate did not read P8 as visible');
    else if (!(gate.reasons ?? []).some((r) => /text|string|literal/i.test(r))) problems.push('the gate gave no text reason');
    const prs = prsOf(ctx, 'P8');
    if (selfMerges(ctx, work(ctx, 'P8'), prs).length > 0) problems.push('P8 self-merged');
    if (!prs.some((p) => approvalCards(ctx, p.number).length > 0)) problems.push('P8 has no approval card');
    return verdict(problems, 'intake not visible, the gate saw text, no self-merge, an approval card');
  },
  31(ctx) {
    const s = scope(ctx, ['P4']);
    if (s.stop) return s.stop;
    const files = prsOf(ctx, 'P4').flatMap(filesOf).filter((f) => f.startsWith('docs/decisions/'));
    return files.length > 0 ? ok(`decision record ${files[0]}`) : no('no file under docs/decisions/ from decision 1');
  },
  32(ctx) {
    const branch = (ctx.prs ?? []).find(isBranch(RECORDS_BRANCH)) ?? null;
    const named = branch?.head ?? (ctx.branches ?? []).find((b) => RECORDS_BRANCH.test(b));
    const problems = [];
    if (!named) problems.push('no wheelhouse/decisions-<date> branch');
    if (!events(ctx, KINDS.selfMerged).some((e) => e.data?.reason === 'decision-records')) problems.push('no self-merged event with reason decision-records');
    return verdict(problems, `${named} opened and self-merged as decision-records (the hour it was made is not read)`);
  },
  33(ctx) {
    const s = scope(ctx, ['P1']);
    if (s.stop) return s.stop;
    const change = work(ctx, 'P1');
    const resumes = (ctx.incidents ?? []).filter((i) => i.kind === KINDS.resumed && i.work === change);
    const problems = [];
    if (resumes.length === 0) problems.push('no resumed incident for P1');
    if (resumes.length > RESUME_LIMIT) problems.push(`${resumes.length} resumes, over ${RESUME_LIMIT}`);
    if (!prsOf(ctx, 'P1').some((p) => p.mergedAt)) problems.push('P1 did not merge');
    return verdict(problems, `${resumes.length} resume(s), within ${RESUME_LIMIT}, and P1 merged`);
  },
  34(ctx) {
    const fault = logOf(ctx, STEPS.fault('F3b'))[0];
    if (!fault) return unknown('F3b was not run');
    // The recovery raise leaves no record of its own; its sign is a run of P7 starting after the foreman was killed.
    const p7 = work(ctx, 'P7');
    const from = ms(fault.at);
    const starts = [
      ...events(ctx, KINDS.run).filter((e) => e.data?.state === 'started' && (p7 === undefined || e.data.work === p7)).map((e) => ms(e.at)),
      ...logOf(ctx, STEPS.start).filter((e) => p7 === undefined || e.work === p7).map((e) => ms(e.at)),
    ].filter((t) => t >= from);
    const lost = (ctx.incidents ?? []).filter((i) => i.kind === KINDS.lost);
    const finding = lost.length > 0 ? `; finding: ${lost.length} lost row(s) in reliability.jsonl` : '';
    if (starts.length === 0) return no(`no start of P7 after F3b${finding}`);
    const gap = Math.min(...starts) - from;
    return gap <= 10 * MINUTE ? ok(`P7 started ${Math.round(gap / 1000)} seconds after F3b${finding}`) : no(`P7 started ${Math.round(gap / MINUTE)} minutes after F3b, over 10${finding}`);
  },
  35(ctx) {
    // A routine move leaves only a watcher-side trace, no record the runner reads, so this row reports what reliability.jsonl holds.
    const rows = ctx.incidents ?? [];
    const counts = {};
    for (const i of rows) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
    const over = Object.entries(counts).filter(([, n]) => n >= BAR).map(([kind, n]) => `${kind} ${n}`);
    return unknown(`no record of a routine move is readable here; ${rows.length} reliability row(s)${over.length > 0 ? `; at or over ${BAR}: ${over.join(', ')}` : ''}`);
  },
  36(ctx) {
    const found = (ctx.prs ?? []).filter((p) => UNDO_BRANCH.test(p.head ?? '') && p.title.startsWith(undoTitle('x').slice(0, -1)) && p.mergedAt);
    if (found.length === 0) return logOf(ctx, STEPS.fault('F5a')).length === 0 ? unknown(NOT_REACHED('the undo of P6 (F5a)')) : no('no merged "Take back:" pull request on a wheelhouse/undo branch');
    const files = ctx.mainFiles ?? {};
    if (typeof files['package.json'] !== 'string') return unknown(`main could not be read, so ${P6_FILE} could not be checked`);
    return typeof files[P6_FILE] === 'string' ? no(`main still holds ${P6_FILE}`) : ok(`the undo merged and main no longer holds ${P6_FILE}`);
  },
  37(ctx) {
    if (logOf(ctx, STEPS.fault('F5b')).length === 0) return unknown(NOT_REACHED('the undo of P2 (F5b)'));
    const reply = 'The undo clashes with later work, so nothing was changed: it is now a decision for the director';
    const problems = [];
    if (!paneAll(ctx).includes(reply)) problems.push('the clash reply was not seen');
    const card = events(ctx, KINDS.card).map((c) => new RegExp(CONFLICT_LINE.source).exec(`${c.data?.line ?? ''} ${c.data?.question ?? ''}`)).find(Boolean);
    if (!card) problems.push('no "Undo of the merge <sha> clashes with later work" card');
    else if ((ctx.branches ?? []).some((b) => b.startsWith(`wheelhouse/undo-${card[1].slice(0, 12)}`))) problems.push('an undo branch exists for the clashing merge');
    return verdict(problems, 'the clash reply, the clash card, and no undo branch for it');
  },
  38(ctx) {
    const set = logOf(ctx, STEPS.stopSet)[0];
    if (!set) return unknown(NOT_REACHED('All stop (F6)'));
    const problems = [];
    const at = ms(set.at);
    if (logOf(ctx, STEPS.start).some((e) => ms(e.at) > at && ms(e.at) < at + 5 * MINUTE)) problems.push('a new start came within 5 minutes of All stop');
    if (![...paneTexts(ctx), ...(ctx.runLog ?? []).map((e) => e.note ?? '')].some((t) => t.includes('All stop is on'))) problems.push('no merge was refused with "All stop is on"');
    return verdict(problems, 'stop set, no start for 5 minutes, a merge refused');
  },
  39(ctx) {
    const set = logOf(ctx, STEPS.stopSet)[0];
    const lift = events(ctx, KINDS.action).find((e) => e.data?.action === KINDS.liftStop);
    const problems = [];
    if (!paneAll(ctx).includes('All stop is on')) problems.push('the stop-guard hook refusal was not seen');
    if (set) {
      const end = lift ? ms(lift.at) : Infinity;
      const early = (ctx.prs ?? []).filter((p) => UNDO_BRANCH.test(p.head ?? '') && ms(p.createdAt) >= ms(set.at) && ms(p.createdAt) < end);
      if (early.length > 0) problems.push('an undo branch was made while All stop was on');
    }
    return verdict(problems, 'the undo was refused while stopped, and no undo branch was made');
  },
  40(ctx) {
    const lift = events(ctx, KINDS.action).find((e) => e.data?.action === KINDS.liftStop);
    if (!lift) return logOf(ctx, 'f6-lift').length === 0 ? unknown(NOT_REACHED('lifting All stop (F6)')) : no('no signed lift-stop answer');
    const card = events(ctx, KINDS.card).some((c) => c.data?.kind === 'lift-stop');
    const resumed = logOf(ctx, STEPS.start).some((e) => ms(e.at) > ms(lift.at));
    const problems = [];
    if (!card) problems.push('no lift card');
    if (!resumed) problems.push('no start after the lift');
    return verdict(problems, 'lift card answered, lift-stop recorded, starts resumed');
  },
  41(ctx) {
    const raised = events(ctx, KINDS.incident)[0];
    if (!raised) return unknown('no incident was raised');
    const lifted = [...events(ctx, KINDS.action).filter((e) => e.data?.action === KINDS.liftIncident), ...events(ctx, KINDS.incidentClosed)].some((e) => ms(e.at) >= ms(raised.at));
    const refused = [...paneTexts(ctx), ...(ctx.runLog ?? []).map((e) => e.note ?? '')].some((t) => /incident .* is open, so only its fix may merge|an incident is open/.test(t));
    const problems = [];
    if (!refused) problems.push('no merge was refused for the incident');
    if (!lifted) problems.push('the incident was not lifted');
    return verdict(problems, 'the incident froze merges and was lifted');
  },
  42(ctx) {
    if (typeof ctx.digestAt !== 'string') return unknown('digestAt was not recorded');
    const arrivals = [...logOf(ctx, STEPS.digest).map((e) => e.at), ...(ctx.ntfy ?? []).filter((m) => /digest/i.test(m.text ?? '')).map((m) => m.at)].map(ms).filter((t) => t >= ms(ctx.digestAt));
    if (arrivals.length === 0) return no('the digest did not arrive after digestAt');
    const gap = Math.min(...arrivals) - ms(ctx.digestAt);
    return gap <= 2 * MINUTE ? ok(`the digest arrived ${Math.round(gap / 1000)} seconds after digestAt`) : no(`the digest arrived ${Math.round(gap / MINUTE)} minutes after digestAt, over 2`);
  },
  43(ctx) {
    const messages = (ctx.ntfy ?? []).map((m) => m.text ?? '');
    const expected = ctx.projectName === undefined ? /^1 decision waits in [A-Za-z0-9_-]+$/ : new RegExp(`^${alertText({ count: 1, project: ctx.projectName })}$`);
    if (messages.some((t) => expected.test(t.trim()))) return ok('ntfy received "1 decision waits in <project>"');
    // The click that sets ntfy up is the director's: a run that did not get it covers nothing here.
    if (ctx.ntfySetUp !== true) return unknown('not covered: ntfy was not set up in this run (the director\'s click in the helper window)');
    return no(`no ntfy message reading "1 decision waits in <project>" among ${messages.length}`);
  },
  44(ctx) {
    const own = ctx.scores?.detail?.ownTests;
    const points = own?.points ?? ctx.scores?.parts?.ownTests;
    if (!Number.isFinite(points)) return unknown('the project\'s own tests were not scored');
    // Green CI and kept tests are points the seed gives for free, so the row asks for tests the builders wrote.
    const written = own?.parts?.written;
    const shown = `parts ${JSON.stringify(own?.parts ?? {})}`;
    if (Number.isFinite(written)) return written > 0 ? ok(`own tests scored ${points}, ${written} written; ${shown}`) : no(`the builders wrote no test the scorer counts; own tests scored ${points}; ${shown}`);
    return points > 0 ? ok(`own tests scored ${points}; ${shown}`) : no(`own tests scored 0; ${shown}`);
  },
  45(ctx) {
    const models = ctx.audit?.models ?? { clean: false, offenders: [] };
    const peek = ctx.audit?.peek ?? { clean: false, hits: [] };
    if (!models.clean || !peek.clean) {
      const problems = [];
      if (!models.clean) problems.push(`model offenders: ${(models.offenders ?? []).map((o) => `${o.role} (${o.model}, ${o.count})`).join(', ') || 'unknown'}`);
      if (!peek.clean) problems.push(`peek hits: ${(peek.hits ?? []).map((h) => `${h.role} (${h.tool})`).join(', ') || 'unknown'}`);
      return no(problems.join('; '));
    }
    // A clean audit of nothing proves nothing: each role must have left at least one transcript.
    const have = new Set((ctx.transcripts ?? []).map((t) => t.role));
    const absent = ['front-desk', 'feature', 'foreman'].filter((role) => !have.has(role));
    if (absent.length > 0) return unknown(`no transcript was found for ${absent.join(', ')}, so the audit has nothing to say about them`);
    return ok(`every model is ${ctx.model ?? 'haiku'} and no session read the held-back files`);
  },
};

// id, wave, pieces, path (spec section 6)
const TABLE = [
  [1, 1, [], 'Setup: all ten steps on a fresh project'],
  [2, 1, [], 'Front desk on Haiku: session start, plain replies'],
  [3, 2, PIECES.map((p) => p.id), 'Intake: nine questions, lane chosen'],
  [4, 2, ['P6'], 'Lane: quick'],
  [5, 2, ['P2', 'P4', 'P7'], 'Lane: small'],
  [6, 3, ['P5'], 'Lane: bug, reproduce first'],
  [7, 2, ['P1', 'P3'], 'Lane: feature, plan approval card'],
  [8, 2, ['P1', 'P3'], 'Card path with typed replies on'],
  [9, 3, [], 'Foreman: start, pace 3, feature lane 1'],
  [10, 4, PIECES.map((p) => p.id), 'Feature session: plan, build, tests, review, tester'],
  [11, 3, ['P3'], 'Own-engine slices'],
  [12, 4, ['P4', 'P7'], 'Same-file clash wait'],
  [13, 4, ['P4'], 'Decision raised by an agent, right shape'],
  [14, 3, ['P3'], 'Shape check sends back a wrong-shaped decision'],
  [15, 3, ['P3'], 'Stuck after three send-backs'],
  [16, 4, ['P4'], 'Hold while a decision waits'],
  [17, 4, ['P4'], 'wait-for frees the slot'],
  [18, 4, ['P4'], 'Typed reply recorded, live'],
  [19, 4, [], 'Typed reply edge cases'],
  [20, 4, ['P4'], 'Private answer on a public project'],
  [21, 4, [], 'Why fork on Haiku'],
  [22, 3, ['P2', 'P3'], 'Line: agent logs its own call'],
  [23, 3, ['P3'], 'Line refuses a director kind'],
  [24, 4, [], 'Pull-back of a logged call'],
  [25, 5, PIECES.map((p) => p.id), 'Proof note: all headings'],
  [26, 4, ['P1', 'P3', 'P4', 'P7'], 'Proof note: pictures'],
  [27, 2, ['P1'], 'Proof note: data before and after'],
  [28, 4, ['P1', 'P2', 'P3', 'P7'], 'Visible change waits for the director'],
  [29, 2, ['P6'], 'Self-merge, case internal'],
  [30, 3, ['P8'], 'Gate reads visible text the intake missed'],
  [31, 4, ['P4'], 'Records: decision files'],
  [32, 5, [], 'Records: daily batch, self-merged'],
  [33, 2, ['P1'], 'Crash: lost feature session resumed'],
  [34, 4, [], 'Crash: lost foreman recovered'],
  [35, 5, [], 'Routine moves handled without the foreman'],
  [36, 3, [], 'Undo, clean'],
  [37, 4, [], 'Undo that clashes with later work'],
  [38, 3, [], 'All stop'],
  [39, 3, [], 'Undo refused under All stop'],
  [40, 3, [], 'Lift All stop'],
  [41, 5, [], 'Incident freezes merges'],
  [42, 4, [], 'Digest at digestAt'],
  [43, 4, ['P4'], 'Alert for a waiting decision (ntfy)'],
  [44, 5, [], "Project's own tests written and kept"],
  [45, 5, [], 'Model binding'],
];

export const ROWS = TABLE.map(([id, wave, pieces, rowPath]) => ({
  id, path: rowPath, pieces, wave, smoke: SMOKE.has(id) && !FULL_ONLY.includes(id), check: checks[id],
}));

// Runs the rows. In a smoke run, rows outside the smoke list and the full-only rows are left out.
export function checkAll(ctx, { smoke = false } = {}) {
  const rows = smoke ? ROWS.filter((r) => r.smoke) : ROWS;
  return rows.map((r) => {
    let result;
    try {
      result = r.check({ ...ctx, smoke });
    } catch (error) {
      result = no(`the check threw: ${error.message}`);
    }
    return { id: r.id, path: r.path, pass: result.pass, evidence: String(result.evidence ?? '') };
  });
}

const tryOr = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const REPO = 'repos/{owner}/{repo}';

// Reads the project's record, the pull requests (through `gh api`), the incidents and the transcripts audit into one context.
export async function gatherContext({
  project, gh, runLog = [], panes = {}, transcripts = [], pieces = {}, scores = null, previews = 'none', enrolled,
  config = null, ntfy = [], ntfySetUp, faults = {}, branches = [], mainFiles = null, model = 'haiku', digestAt = null, projectName,
}) {
  const events = listEvents(stateDir(project), { report: () => {} });
  const views = buildViews(events, enrolled ?? tryOr(() => readEnrolled(), []));
  const prs = [];
  for (const raw of (await gh(['api', `${REPO}/pulls?state=all&per_page=100`])) ?? []) {
    const commits = [];
    const statuses = [];
    for (const c of (await gh(['api', `${REPO}/pulls/${raw.number}/commits?per_page=100`])) ?? []) {
      const detail = await gh(['api', `${REPO}/commits/${c.sha}`]);
      commits.push({ sha: c.sha, date: c.commit?.committer?.date ?? c.commit?.author?.date, message: c.commit?.message ?? '', files: (detail?.files ?? []).map((f) => f.filename) });
      for (const s of (await gh(['api', `${REPO}/commits/${c.sha}/statuses`])) ?? []) {
        statuses.push({ context: s.context, description: s.description ?? '', state: s.state, createdAt: s.created_at });
      }
    }
    prs.push({
      number: raw.number, title: raw.title, head: raw.head?.ref, headSha: raw.head?.sha, body: raw.body ?? '', createdAt: raw.created_at,
      mergedAt: raw.merged_at ?? null, mergeSha: raw.merge_commit_sha ?? null, commits, statuses,
    });
  }
  const runs = ((await gh(['api', `${REPO}/actions/runs?per_page=100`]))?.workflow_runs ?? [])
    .map((r) => ({ id: r.id, headSha: r.head_sha, branch: r.head_branch, conclusion: r.conclusion, createdAt: r.created_at }));
  const incidents = tryOr(() => readIncidents(), []).filter((i) => i.project === project);
  const audit = { models: auditModels(transcripts, { model }), peek: auditPeek(transcripts) };
  return {
    events, views, prs, runs, transcripts, audit, panes, runLog, incidents, pieces, scores, previews,
    config, ntfy, ntfySetUp, faults, branches, mainFiles, digestAt, project, projectName, model,
  };
}
