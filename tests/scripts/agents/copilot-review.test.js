// tests/scripts/agents/copilot-review.test.js
// Copilot's half of the signed review (adapters/copilot/review.js, ruling P7-17): the exact argv, the review's own
// home and environment, the version pin, and one session against the stand-in Copilot. No real Copilot runs: the
// stand-ins come first on the PATH, and the session's runs go to a fake that answers as check 66's route b did.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { run } from '../../../scripts/lib/run.js';
import { COPILOT_VERSION } from '../../../scripts/lib/copilot-numbers.js';
import { EXPECTED_DISABLED_TOOLS as PROBE_DISABLED_TOOLS } from '../../../probes/66-clean-review/run.js';
import copilotReview, {
  EXPECTED_DISABLED_TOOLS, FIRST_LINE, REVIEW_KIND, firstLineOf, makeReview, reviewArgs, reviewEnv, reviewerAgent, runSession, versionOf, writeReviewHome,
} from '../../../adapters/copilot/review.js';
import { REVIEWS } from '../../../scripts/agents/reviews.js';
import { REVIEW_KINDS } from '../../../scripts/lib/copilot-numbers.js';

const standIns = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran');
  assert.deepEqual(standIns.calls(), [], 'no stood-in program ran from the PATH');
});
after(() => standIns.restore());

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'copilot', 'review', 'fake-reviewer.js');
const NONCE = 'fedcba9876543210fedcba9876543210';
const SHA = 'abcdef1234567890abcdef1234567890abcdef12';

test("the adapter's disabled tools are the probe's recorded route b set, and its kind is a review kind", () => {
  assert.deepEqual([...EXPECTED_DISABLED_TOOLS], [...PROBE_DISABLED_TOOLS]);
  assert.ok(REVIEW_KINDS.includes(REVIEW_KIND));
  assert.equal(REVIEWS.copilot, copilotReview);
  assert.equal(REVIEWS['claude-code'], null);
});

test('the session is started with exactly the review flags and none of the trust or allow-everything ones', () => {
  assert.deepEqual(reviewArgs({ prompt: 'Review it.', logDir: '/logs' }), [
    '-p', 'Review it.', '--output-format', 'json', '--no-auto-update', '--no-ask-user', '--log-dir', '/logs', '--log-level', 'debug',
    '--agent', 'reviewer', '--no-custom-instructions', '--disable-builtin-mcps', '--available-tools', 'view', 'glob', 'rg',
    '--allow-tool=view', '--allow-tool=glob', '--allow-tool=rg',
  ]);
});

test("the review's home holds only the sign-in keys and the reviewer, whose first instruction is the review's own line", () => {
  const from = tempFolder('wh-review-from-');
  fs.writeFileSync(path.join(from, 'config.json'), JSON.stringify({ loggedInUsers: [{ login: 'someone' }], lastLoggedInUser: { login: 'someone' }, trustedFolders: ['/'], model: 'model-a' }));
  fs.mkdirSync(path.join(from, 'agents'));
  fs.writeFileSync(path.join(from, 'agents', 'mine.agent.md'), 'x');
  const home = path.join(tempFolder('wh-review-home-'), 'home');
  writeReviewHome({ home, signedInFrom: from, nonce: NONCE });
  assert.deepEqual(fs.readdirSync(home).sort(), ['agents', 'config.json']);
  assert.deepEqual(fs.readdirSync(path.join(home, 'agents')), ['reviewer.agent.md']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')), { loggedInUsers: [{ login: 'someone' }], lastLoggedInUser: { login: 'someone' } });
  const agent = fs.readFileSync(path.join(home, 'agents', 'reviewer.agent.md'), 'utf8');
  assert.match(agent, /^---\nname: "reviewer"\n/);
  assert.match(agent, /^tools: \["view", "glob", "rg"\]$/m);
  assert.ok(agent.indexOf(firstLineOf(NONCE)) < agent.indexOf('You are an independent reviewer'));
  assert.equal(firstLineOf(NONCE), `${FIRST_LINE} ${NONCE}`);
  assert.doesNotMatch(agent, /wheelhouse-reviewer/);
  assert.throws(() => reviewerAgent('not-a-nonce'), /32 hexadecimal/);
  // A home with no sign-in refuses.
  const unsigned = tempFolder('wh-review-unsigned-');
  fs.writeFileSync(path.join(unsigned, 'config.json'), JSON.stringify({ trustedFolders: ['/'] }));
  assert.throws(() => writeReviewHome({ home: path.join(tempFolder('wh-review-home-'), 'home'), signedInFrom: unsigned, nonce: NONCE }), /isn't signed in/);
});

test("the review's environment carries neither variable that adds instructions or skills, nor any token", () => {
  const env = reviewEnv({
    PATH: '/bin', HOME: '/h', GH_TOKEN: 't', GITHUB_TOKEN: 't', COPILOT_GITHUB_TOKEN: 't', COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '/i', COPILOT_SKILLS_DIRS: '/s', COPILOT_ALLOW_ALL: '1',
  }, { home: '/review-home' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', COPILOT_HOME: '/review-home' });
});

test('versions are read from what Copilot prints', () => {
  assert.equal(versionOf(`GitHub Copilot CLI ${COPILOT_VERSION}.\n`), COPILOT_VERSION);
  assert.equal(versionOf('no number'), null);
});

// One session in a folder of its own, against the fake, with `knobs`. Gives the session's result and what the fake saw.
async function session(knobs = {}, extra = {}) {
  const dir = tempFolder('wh-review-session-');
  const folder = path.join(dir, 'folder');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'change.diff'), '+x\n');
  const record = path.join(dir, 'seen.jsonl');
  const knobsFile = path.join(dir, 'knobs.json');
  fs.writeFileSync(knobsFile, JSON.stringify({ version: COPILOT_VERSION, record, ...knobs }));
  const from = path.join(dir, 'from');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'config.json'), JSON.stringify({ loggedInUsers: [{ login: 'someone' }] }));
  const tmp = path.join(dir, 'tmp');
  fs.mkdirSync(tmp);
  const fakeRun = (file, args, options) => (file === 'copilot-review-stand-in' ? run(process.execPath, [FAKE, knobsFile, ...args], options) : hostGuard(file, args, options));
  const result = await runSession({
    folder, prompt: `Review pull request 7, at its head commit ${SHA}.`, env: { PATH: process.env.PATH, HOME: '/h', COPILOT_SKILLS_DIRS: '/s' },
    copilot: { kind: 'direct', file: 'copilot-review-stand-in' }, run: fakeRun, signedInFrom: from, tmp, ...extra,
  });
  const seen = fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  return { result, seen, tmp };
}

test('a session that runs as route b did is clean, its answer opens with its own line, and its home goes when it ends', async () => {
  const { result, seen, tmp } = await session();
  assert.deepEqual(result.reasons, []);
  assert.equal(result.clean, true);
  assert.ok(result.answer.startsWith(`${result.firstLine}\n`));
  assert.match(result.firstLine, /^WHEELHOUSE CLEAN REVIEWER [0-9a-f]{32}$/);
  assert.equal(seen.length, 6);
  assert.ok(!seen[5].args[1].includes(result.firstLine.split(' ').at(-1)), 'the nonce is not in the prompt');
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.equal(copilotReview.ready(), false);
  assert.deepEqual(makeReview({ ready: true }).kinds(), ['clean-session']);
});

test('a session with an extra agent, an extra disabled tool, no agent count or no own line is not clean', async () => {
  for (const [knobs, pattern] of [
    [{ extraAgent: 'claude-reviewer' }, /agents besides the Lookout/],
    [{ extraDisabled: 'lsp' }, /beyond it: lsp/],
    [{ agents: null }, /no agent count/],
    [{ agents: 2 }, /2 agents were loaded/],
    [{ answer: 'no-nonce' }, /Lookout's own line/],
    [{ instructions: [{ id: 'nested-agents', location: 'working-directory' }] }, /instruction sources/],
    [{ skills: 'Project skills:\n  planted\n\nBuiltin skills:\n  x\n' }, /skills besides the built-in ones/],
  ]) {
    const { result } = await session(knobs);
    assert.equal(result.clean, false, JSON.stringify(knobs));
    assert.ok(result.reasons.some((r) => pattern.test(r)), `${JSON.stringify(knobs)}: ${result.reasons.join('; ')}`);
  }
});

test('another Copilot version, a .cmd program or a missing sign-in refuses before any session starts', async () => {
  const other = await session({ version: '9.9.9' });
  assert.equal(other.result.clean, false);
  assert.match(other.result.reasons[0], new RegExp(`9\\.9\\.9.*only on ${COPILOT_VERSION.replace(/\./g, '\\.')}`));
  assert.equal(other.seen.length, 1);
  const shim = await session({}, { copilot: { kind: 'cmd', file: 'C:\\copilot.cmd' } });
  assert.match(shim.result.reasons[0], /can't be started through a \.cmd program/);
  assert.equal(shim.seen.length, 0);
  const unsigned = await session({}, { signedInFrom: tempFolder('wh-review-nobody-') });
  assert.match(unsigned.result.reasons[0], /isn't signed in/);
  assert.equal(unsigned.seen.length, 0);
});

test('a file added to the folder or the home while the session runs makes it not clean', async () => {
  for (const [knobs, pattern] of [
    [{ plantFolder: '.github/copilot-instructions.md' }, /folder gained files that steer an agent: \.github/],
    [{ plantFolder: 'src/AGENTS.md' }, /folder gained files that steer an agent: src\/AGENTS\.md/],
    [{ plantHome: 'skills/x/SKILL.md' }, /home gained what Wheelhouse didn't write: skills/],
    [{ plantHome: 'agents/other.agent.md' }, /home gained what Wheelhouse didn't write: agents\/other\.agent\.md/],
  ]) {
    const { result } = await session(knobs);
    assert.equal(result.clean, false, JSON.stringify(knobs));
    assert.ok(result.reasons.some((r) => pattern.test(r)), `${JSON.stringify(knobs)}: ${result.reasons.join('; ')}`);
  }
  // Copilot's own state in the home is not an addition.
  const { result } = await session({ plantHome: 'session-state/abc/events.jsonl' });
  assert.deepEqual(result.reasons, []);
});

test('under STOP the session starts no further program', async () => {
  for (const after of [0, 1, 3, 5]) {
    let calls = 0;
    const { result, seen } = await session({}, { stopped: () => calls++ >= after });
    assert.equal(result.stopped, true, String(after));
    assert.equal(result.clean, false);
    assert.deepEqual(result.reasons, ['All stop is on']);
    assert.equal(seen.length, after, String(after));
  }
});

test('STOP coming on while the session runs ends the session, and nothing of it is taken (ruling P8-14)', async () => {
  const dir = tempFolder('wh-review-stop-');
  const folder = path.join(dir, 'folder');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'change.diff'), '+x\n');
  const knobsFile = path.join(dir, 'knobs.json');
  fs.writeFileSync(knobsFile, JSON.stringify({ version: COPILOT_VERSION, record: path.join(dir, 'seen.jsonl') }));
  const from = path.join(dir, 'from');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'config.json'), JSON.stringify({ loggedInUsers: [{ login: 'someone' }] }));
  let stop = false;
  let ended = null;
  // The listings run as the stand-in; the session runs until its signal is aborted, as run.js ends a program.
  const fakeRun = (file, args, options) => {
    if (file !== 'copilot-review-stand-in') return hostGuard(file, args, options);
    if (args[0] !== '-p') return run(process.execPath, [FAKE, knobsFile, ...args], options);
    stop = true;
    return new Promise((resolve) => {
      options.signal.addEventListener('abort', () => { ended = Date.now(); resolve({ code: 1, stdout: '', stderr: '', stopped: true }); }, { once: true });
    });
  };
  const started = Date.now();
  const result = await runSession({
    folder, prompt: `Review pull request 7, at its head commit ${SHA}.`, env: { PATH: process.env.PATH, HOME: '/h' },
    copilot: { kind: 'direct', file: 'copilot-review-stand-in' }, run: fakeRun, signedInFrom: from, tmp: dir, stopped: () => stop, stopPollMs: 20,
  });
  assert.ok(ended !== null, 'the session was ended');
  assert.ok(ended - started < 60_000);
  assert.deepEqual(result, { clean: false, reasons: ['All stop is on'], answer: null, firstLine: null, stopped: true });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('wheelhouse-review-home-')), [], 'its home goes too');
});
