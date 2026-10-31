// scripts/survey/take.js
// The survey taken for the state (design section 15, ruling A1; plan rulings P1 and P3): when
// setup finishes (scripts/setup/health.js's finishSetup) and, once, when the last one couldn't
// reach the host (the helper's /survey/again). It runs in the helper and only reads: the project's
// folder through setup's fenced git, and the host's open requests through the adapter.
//
// Taking it never throws and never stops setup: a survey that can't be taken at all is recorded as
// one that missed the host, so the next briefing looks again. What it records fits the state's
// `survey` shape (scripts/state/events.js), and anything in it that looks like a secret is left
// out before it is written, so the state's own scan, which refuses a whole event, has nothing to find.
import fs from 'node:fs';
import { surveyOf } from './look.js';
import { setupGit } from '../setup/git.js';
import { adapterOf } from '../host/adapter-for.js';
import { readProject } from '../lib/projects.js';
import { stateDir } from '../lib/paths.js';
import { run as realRun } from '../lib/run.js';
import { listEvents, SURVEY_MOST, SURVEY_TEXT, SURVEY_PATH, SURVEY_WORDS } from '../state/events.js';
import { scanContent } from '../state/secret-scan.js';

// The longest a survey may take, after which it is one that missed the host (setup finishes, and
// the next briefing looks again); and the longest each of its host and git calls may take.
export const SURVEY_DEADLINE_MS = 90 * 1000;
export const SURVEY_HOST_MS = 30 * 1000;

// A survey that found nothing because it couldn't look: the host not reached, every part empty.
export function missedSurvey() {
  return {
    v: 1, hostReached: false, requests: [], pushed: [], local: [], more: { pushed: false, local: false },
    instructions: { files: [], sections: [] }, scheduled: 0, secrets: 0, rules: [],
  };
}

const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
// Whether a string looks like it holds a secret, as written into the event's file or decoded.
const secretIn = (s) => scanContent(JSON.stringify(String(s))).length > 0;
// A text kept as the state takes it: cut to SURVEY_TEXT, and empty when it holds a secret.
const kept = (s) => (typeof s !== 'string' || secretIn(s) ? '' : s.slice(0, SURVEY_TEXT));
const name = (s) => typeof s === 'string' && s !== '' && s.length <= SURVEY_TEXT && !secretIn(s);
// A path or a rule's words kept whole or not at all: cut, it would name another file or misquote.
const wholeText = (s, most) => typeof s === 'string' && s !== '' && s.length <= most && !secretIn(s);
const whole = (x, least) => Number.isInteger(x) && x >= least;

// The survey as the state takes it: each part in its shape and within its limits, anything not
// shaped as the survey makes it left out. A title, subject or heading holding a secret is kept
// empty; a line, file or rule whose name or words hold one is left out.
export function shapedSurvey(survey) {
  const s = plain(survey) ? survey : {};
  const requests = list(s.requests).filter((r) => plain(r) && whole(r.number, 1))
    .map((r) => ({ number: r.number, title: kept(r.title), draft: r.draft === true })).slice(0, SURVEY_MOST.requests);
  const items = (xs) => list(xs).filter((i) => plain(i) && name(i.name) && typeof i.head === 'string' && /^[0-9a-f]{40,64}$/.test(i.head) && whole(i.commits, 1))
    .map((i) => ({
      name: i.name, head: i.head, commits: i.commits, subject: kept(i.subject),
      at: typeof i.at === 'string' && i.at.length <= SURVEY_TEXT && !Number.isNaN(Date.parse(i.at)) ? i.at : '',
    })).slice(0, SURVEY_MOST.lines);
  const ins = plain(s.instructions) ? s.instructions : {};
  const more = plain(s.more) ? s.more : {};
  return {
    v: 1,
    hostReached: s.hostReached === true,
    requests,
    pushed: items(s.pushed),
    local: items(s.local),
    more: { pushed: more.pushed === true, local: more.local === true },
    instructions: {
      files: list(ins.files).filter((f) => wholeText(f, SURVEY_PATH)).slice(0, SURVEY_MOST.files),
      sections: list(ins.sections).filter((x) => plain(x) && whole(x.line, 1)).map((x) => ({ heading: kept(x.heading), line: x.line })).slice(0, SURVEY_MOST.sections),
    },
    scheduled: whole(s.scheduled, 0) ? s.scheduled : 0,
    secrets: whole(s.secrets, 0) ? s.secrets : 0,
    rules: list(s.rules).filter((r) => plain(r) && wholeText(r.words, SURVEY_WORDS)
      && plain(r.source) && wholeText(r.source.file, SURVEY_PATH) && whole(r.source.line, 1))
      .map((r) => ({ words: r.words, source: { file: r.source.file, line: r.source.line } })).slice(0, SURVEY_MOST.rules),
  };
}

// Wheelhouse's own lines of work in the project, from its state: `feature/<work>` for each feature
// recorded, and the line a feature record names, sorted. None when the state can't be read.
export function ownLines(project, { dir = stateDir(project) } = {}) {
  const lines = new Set();
  try {
    for (const e of listEvents(dir, { report: () => {} })) {
      if (e.kind !== 'feature' || !plain(e.data)) continue;
      if (typeof e.data.work === 'string' && e.data.work !== '') lines.add(`feature/${e.data.work}`);
      if (typeof e.data.branch === 'string' && e.data.branch !== '') lines.add(e.data.branch);
    }
  } catch { /* no state yet: none of its own */ }
  return [...lines].sort();
}

// The default branch: the host's, else origin's HEAD as last fetched, else main.
async function defaultBranchOf(adapter, git) {
  try {
    const got = await adapter?.defaultBranch();
    if (typeof got === 'string' && got !== '') return got;
  } catch { /* the host can't say; git may */ }
  try {
    const ref = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
    const named = ref.code === 0 ? String(ref.stdout).trim() : '';
    if (named.startsWith('refs/remotes/origin/')) return named.slice('refs/remotes/origin/'.length);
  } catch { /* none here either */ }
  return 'main';
}

// takeSurvey({ project, record, run, adapter, rules, own, look, deadlineMs }) -> the survey,
// shaped for the state, never a throw, within `deadlineMs` (SURVEY_DEADLINE_MS): past it, a survey
// that missed the host. `record` is the project's record (its folder, host, repository and
// address); `adapter()` gives the host's adapter, by default with the director's own sign-in as
// setup's other steps use it, each of its calls given SURVEY_HOST_MS; `own` names Wheelhouse's own
// lines, by default from the state; `rules` are the rules found (step 5). `look` is surveyOf, for tests.
export async function takeSurvey({
  project, record = project === undefined ? null : readProject(project), run = realRun,
  adapter = async (r) => adapterOf(r, { run: (file, args, options = {}) => run(file, args, { ...options, timeoutMs: SURVEY_HOST_MS }) }),
  rules = [], own = project === undefined ? [] : ownLines(project), look = surveyOf, deadlineMs = SURVEY_DEADLINE_MS,
} = {}) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(missedSurvey()), deadlineMs); });
  try {
    return await Promise.race([late, surveyNow({ record, run, adapter, rules, own, look })]);
  } finally {
    clearTimeout(timer);
  }
}

async function surveyNow({ record, run, adapter, rules, own, look }) {
  try {
    const folder = record?.folder;
    if (typeof folder !== 'string' || !fs.existsSync(folder)) return missedSurvey();
    let host = null;
    let hostFailed = false;
    try {
      host = await adapter(record);
    } catch {
      hostFailed = true;
    }
    const git = setupGit({ run, cwd: folder, workTree: folder, timeoutMs: SURVEY_HOST_MS });
    const defaultBranch = await defaultBranchOf(host, git);
    // An adapter that couldn't be made is a host that couldn't be reached.
    const missing = { openRequests: async () => { throw new Error('the host adapter could not be made'); } };
    const got = await look({ folder, git, adapter: hostFailed ? missing : host, defaultBranch, rules, own });
    return shapedSurvey(got);
  } catch {
    return missedSurvey();
  }
}

// Records the survey `take()` gives with `write(data)`, the helper's own writer of a survey (no
// caller may write one, scripts/state/events.js's HELPER_ONLY_KINDS), with `again: true` when it is
// taken again. A survey the state refuses (other than under STOP) is recorded as one that missed
// the host, so the next briefing looks again. Never throws: the writer's answer, or { ok: false,
// refused } when it couldn't write.
export async function recordSurvey({ write: writeWith, take, again = false }) {
  const mark = (data) => (again ? { ...data, again: true } : data);
  const write = async (data) => {
    try {
      return await writeWith(mark(data));
    } catch {
      return { ok: false, refused: 'the helper could not be asked' };
    }
  };
  let data;
  try {
    data = shapedSurvey(await take());
  } catch {
    data = missedSurvey();
  }
  const got = await write(data);
  const missed = JSON.stringify(data) === JSON.stringify(missedSurvey());
  if (got?.ok === true || missed || got?.refused === 'All stop is on' || got?.refused === 'STOP is on' || got?.refused === 'the helper could not be asked') return got;
  return write(missedSurvey());
}
