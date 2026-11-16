// scripts/setup/render-cards.js
// Setup's cards as the director reads them, on a pretend computer: the one card, Customise, steps 1 to 3,
// each card in full and in order, through the real engine (scripts/setup/engine.js), the real steps 2 to 4
// and the real prompt record, which keeps each answer as a click on the card does. Nothing is reached on
// the network and nothing outside a scratch folder is read or written: the programs the steps run are
// stand-ins (`fakeRun`), and the Wheelhouse home, the Claude Code folder and the user's home are made for the run.
//
//   node scripts/setup/render-cards.js [a|b|c|d|e|all] [--desktop]
//
// The paths:
//   a  a company's GitLab, on Windows, no real users, Quick chosen, GitLab's tool can't be had here
//   b  the same, with Narrow chosen
//   c  the public GitLab, on Windows
//   d  GitHub, on Windows
//   e  a company's GitLab on a Mac, with GitLab's tool in
// --desktop answers as the Desktop app can: a card whose question is the same as an earlier card's shows the
// earlier one, so the answer that comes back is the one given there.
//
// renderPath(name, { desktop }) gives { cards, end, said }: each card as { step, id, kind, card, answer }, how the
// run ended ({ step, how, why? }), and what step 2 said as it finished. printCards gives the cards as text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SETUP_TITLES } from '../state/card-lines.js';

const HERE = fileURLToPath(import.meta.url);
const T0 = new Date('2026-11-16T03:00:00.000Z');
export const COMPANY_ADDRESS = 'https://gitlab.example.com';

// What each path is: the computer, the host and the way the director picks, and how the cards are answered.
export const PATHS = Object.freeze({
  a: { title: 'A company\'s GitLab on Windows, no real users, Quick chosen, GitLab\'s tool not to be had', platform: 'win32', host: 'GitLab', where: 'company', way: 'Quick', glab: 'unavailable' },
  b: { title: 'A company\'s GitLab on Windows, no real users, Narrow chosen, GitLab\'s tool not to be had', platform: 'win32', host: 'GitLab', where: 'company', way: 'Narrow', glab: 'unavailable' },
  c: { title: 'The public GitLab on Windows', platform: 'win32', host: 'GitLab', where: 'gitlab.com', glab: 'unavailable' },
  d: { title: 'GitHub on Windows', platform: 'win32', host: 'GitHub', gh: 'in' },
  e: { title: 'A company\'s GitLab on a Mac, GitLab\'s tool in', platform: 'darwin', host: 'GitLab', where: 'company', glab: 'in' },
});

// ---- The pretend computer ----

const world = () => JSON.parse(fs.readFileSync(path.join(process.env.WHEELHOUSE_HOME, 'render-world.json'), 'utf8'));

// The programs the steps run, answered as the path's computer would: every tool in at a good version, but for a host
// tool the path leaves out, which is not found; git holds no key and no proxy; nothing is signed in.
export function fakeRun(w) {
  const missing = new Set([...(w.glab === 'in' ? [] : ['glab']), ...(w.gh === 'in' ? [] : ['gh'])]);
  const win = w.platform === 'win32';
  return async (file, args = []) => {
    const name = path.win32.basename(String(file)).replace(/\.exe$/i, '');
    const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
    if (name === 'which' || name === 'where') {
      if (missing.has(args[0])) return answer('', 1);
      return answer(win ? `C:\\Program Files\\${args[0]}\\${args[0]}.exe\r\n` : `/usr/bin/${args[0]}\n`);
    }
    if (missing.has(name)) throw Object.assign(new Error(`${name} is not found`), { code: 'ENOENT' });
    if (name === 'xcode-select' && args[0] === '-p') return answer('/Library/Developer/CommandLineTools\n');
    if (args[0] === '--version' || args[0] === 'version') return answer(name === 'node' ? 'v22.3.0\n' : `${name} version 2.60.0\n`);
    if (name === 'git' && args.includes('config')) return answer('', 1);
    if ((name === 'glab' || name === 'gh') && args[0] === 'auth') return answer('', 1);
    if (name === 'glab' && args[0] === 'config') return answer('', 1);
    if (name === 'tmutil') return answer('', 1);
    return answer('');
  };
}

const settles = (n) => ({ n, title: SETUP_TITLES[n], plan: async () => ({ settled: { record: {} } }), apply: async () => [] });

// The steps for the engine: the real steps 2, 3 and 4 on the pretend computer, read afresh from the world on each call;
// the others settle at once.
async function realSteps() {
  const { toolsStep } = await import('./tools.js');
  const { hostStep, directorKey } = await import('./host.js');
  const { questionsStep } = await import('./questions.js');
  directorKey.borrow = async () => null;
  const tools = () => {
    const w = world();
    return toolsStep({ engine: null, run: fakeRun(w), fetch: async () => { throw new Error('nothing is fetched here'); }, pluginRoot: w.pluginRoot, env: {} });
  };
  const host = () => {
    const w = world();
    return hostStep({
      run: fakeRun(w), fetch: async () => { throw new Error('nothing is fetched here'); }, curlExists: () => true,
      certificateProbe: async () => 'trusted', views: () => ({}),
      findGit: async () => ({ ok: true, found: true, path: w.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git' }),
      via: { run: fakeRun(w), curl: null, platform: w.platform },
    });
  };
  const fresh = (made, n) => ({
    n, title: SETUP_TITLES[n], long: made().long, after: made().after, asksDuring: made().asksDuring,
    plan: (ctx) => made().plan(ctx), apply: (ctx, changes) => made().apply(ctx, changes),
  });
  return Object.keys(SETUP_TITLES).map(Number).sort((a, b) => a - b).map((n) => {
    if (n === 2) return fresh(tools, 2);
    if (n === 3) return fresh(host, 3);
    if (n === 4) return questionsStep();
    return settles(n);
  });
}

// The engine loads its steps from a module's STEPS: this one's, once the world is laid out.
export let STEPS = [];
if (process.env.WHEELHOUSE_RENDER_STEPS === '1') STEPS = await realSteps();

// ---- Answering ----

// The label the director picks on a card, by the path: the way the path names where the card offers it, else the
// recommendation; the company's address typed where a card asks for it.
function choose(p, { id, card }, { stepTwoDone }) {
  const labels = card.options.map((o) => o.label);
  const recommended = recommendedOf(card) ?? labels[0];
  const pick = (want) => labels.find((l) => l === want) ?? null;
  if (id === 'one-card' || /^plan-/.test(id)) return { label: stepTwoDone.customised ? 'Go ahead' : 'Customise' };
  if (id === 'real-users') return { label: pick('Not yet') };
  if (id === 'host' || /^join/.test(id)) return { label: pick(p.host) };
  if (/^gitlab-where/.test(id)) return p.where === 'company' ? { text: COMPANY_ADDRESS } : { label: pick('gitlab.com') };
  if (/^gitlab-address/.test(id)) return { text: COMPANY_ADDRESS };
  if (/^connection/.test(id) && p.way) {
    const way = labels.find((l) => l.startsWith(p.way));
    if (way) return { label: way };
  }
  return { label: recommended };
}

const bareLabel = (label) => String(label).replace(/ \(Recommended\)$/, '');

// The option a card recommends: the composer starts its description with "Recommended:".
export const recommendedOf = (card) => card.options.find((o) => /^Recommended:/.test(o.description ?? ''))?.label ?? null;

// ---- Running a path ----

export async function renderPath(name, { desktop = false, keep = false } = {}) {
  const p = PATHS[name];
  if (!p) throw new Error(`There is no path ${name}: choose one of ${Object.keys(PATHS).join(', ')}`);
  const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-render-')));
  const home = path.join(scratch, 'wh');
  const user = path.join(scratch, 'user');
  const config = path.join(user, 'claude config');
  const folder = path.join(user, 'Projects', 'Cafe Menu');
  for (const dir of [home, config, folder]) fs.mkdirSync(dir, { recursive: true });
  const env = { WHEELHOUSE_HOME: process.env.WHEELHOUSE_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, WHEELHOUSE_RENDER_STEPS: process.env.WHEELHOUSE_RENDER_STEPS };
  // The pretend computer has no proxy: this computer's own proxy settings are put aside for the run.
  for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) { env[k] = process.env[k]; delete process.env[k]; }
  process.env.WHEELHOUSE_HOME = home;
  process.env.CLAUDE_CONFIG_DIR = config;
  process.env.WHEELHOUSE_RENDER_STEPS = '1';
  fs.writeFileSync(path.join(home, 'render-world.json'), JSON.stringify({ ...p, pluginRoot: path.dirname(path.dirname(path.dirname(HERE))) }));
  const cards = [];
  const said = [];
  let end = null;
  try {
    const { setupRoutes } = await import('./engine.js');
    const { decide } = await import('../hooks/prompt-record.js');
    const { makeSigningKey, enrol } = await import('../state/signing.js');
    const { markStep, readJournal } = await import('./journal.js');
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-16T00:00:00.000Z' });
    // A fresh copy of this module for the engine, so its STEPS are made with the world in place.
    const stepsModule = path.join(scratch, 'steps.mjs');
    fs.writeFileSync(stepsModule, `export { STEPS } from ${JSON.stringify(`${pathToFileURL(HERE).href}?${path.basename(scratch)}`)};\n`);
    let clock = T0.getTime();
    const now = () => new Date(clock);
    const routes = setupRoutes({ now, userHome: user, platform: p.platform, stepsModule });
    const client = {
      prState: async () => ({ ok: false }),
      state: { write: async (body) => ({ ok: true, id: body.id }), record: async (body) => ({ ok: true, id: body.event?.id }) },
      profile: { record: async () => ({ ok: true }) },
    };
    const state = { customised: false };
    // What the director's click returns: on the Desktop app, a card whose question an earlier card had shows that earlier
    // card, so the answer is the one given there.
    const answer = async (step, ask) => {
      const { id, card } = ask;
      let got = choose(p, { id, card }, { stepTwoDone: state });
      let stale = false;
      if (desktop) {
        const earlier = cards.find((c) => c.card.question === card.question && c.answer !== undefined && JSON.stringify(c.card) !== JSON.stringify(card));
        if (earlier) {
          got = earlier.answer;
          stale = true;
        }
      }
      if (id.startsWith('plan-') && got.label === 'Customise') state.customised = true;
      cards.push({ step, id, kind: 'question', card, answer: got, ...(stale ? { stale: true } : {}) });
      const value = got.text ?? card.options.find((o) => bareLabel(o.label) === got.label)?.label ?? got.label;
      clock += 1000;
      await decide({
        cwd: folder, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [card] }, tool_response: { answers: { [card.question]: value } },
      }, { client, now: () => new Date(clock - 500) });
    };
    const plan = (step) => routes['/setup/plan']({ folder, step });
    const runId = () => readJournal().runs.find((r) => r.folder === folder)?.id;
    // The one card and Customise, until a Go ahead holds.
    for (let turn = 0; ; turn += 1) {
      if (turn > 20) { end = { step: 0, how: 'loop', why: 'the one card kept coming back' }; return { cards, end, said }; }
      const got = await plan(0);
      if (got.done) break;
      if (got.ask) await answer(0, got.ask);
      else if (got.asks) for (const ask of got.asks) await answer(ask.step, ask);
    }
    // Steps 1 to 3. Step 2's Go ahead is taken as done, with its fetch of a tool that can't be had refused, as on the computer.
    const seen = new Map();
    for (const n of [1, 2, 3]) {
      for (let turn = 0; ; turn += 1) {
        const got = await plan(n);
        if (got.done) break;
        if (got.wait !== undefined) { end = { step: n, how: 'pause', why: got.why }; return { cards, end, said }; }
        if (got.ask) {
          const key = `${n}.${got.ask.id}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
          if (seen.get(key) > 2 || turn > 12) { end = { step: n, how: 'loop', why: `${key} was asked again with its answer given` }; return { cards, end, said }; }
          await answer(n, got.ask);
          continue;
        }
        cards.push({ step: n, id: `go-ahead-${n}`, kind: 'go-ahead', card: got.card, covered: got.covered === true });
        if (n === 2) {
          const w = world();
          if (w.glab === 'unavailable' && got.changes.some((c) => c.action === 'fetch' && c.tool === 'glab')) said.push('glab could not be fetched on this computer, so Wheelhouse will reach the host without it');
          markStep(runId(), 2, 'doneAt', { now });
          break;
        }
        end = { step: n, how: 'finished' };
        break;
      }
    }
    return { cards, end, said };
  } catch (error) {
    // A card refused as it went out (the same words as another card, say) ends the run with the cards so far.
    return { cards, end: { step: null, how: 'refused', why: error instanceof Error ? error.message : String(error) }, said };
  } finally {
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    if (!keep) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// The cards as text, in order: each card's step, question, header, options with their descriptions, and the recommendation.
export function printCards(name, { cards, end, said }) {
  const lines = [`## Path ${name}: ${PATHS[name].title}`, ''];
  cards.forEach((c, i) => {
    const recommended = recommendedOf(c.card);
    lines.push(`### Card ${i + 1} (step ${c.step}${c.kind === 'go-ahead' ? ', Go-ahead card' : ''}${c.covered ? ', covered by the Go ahead' : ''})`);
    lines.push(`Header: ${c.card.header}`);
    lines.push(...c.card.question.split('\n'));
    for (const o of c.card.options) lines.push(`- ${o.label}: ${o.description}`);
    lines.push(`Recommended: ${recommended ?? 'none'}`);
    if (c.answer) lines.push(`Answer: ${c.answer.text ?? c.answer.label}${c.stale ? ' (the earlier card\'s, as the Desktop app shows it)' : ''}`);
    lines.push('');
  });
  for (const line of said) lines.push(`Said: ${line}`);
  lines.push(`End: step ${end?.step}, ${end?.how}${end?.why ? `: ${end.why}` : ''}`, '');
  return lines.join('\n');
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === HERE && process.env.WHEELHOUSE_RENDER_STEPS !== '1') {
  const which = process.argv[2] && process.argv[2] !== '--desktop' ? process.argv[2] : 'all';
  const desktop = process.argv.includes('--desktop');
  for (const name of which === 'all' ? Object.keys(PATHS) : [which]) {
    process.stdout.write(printCards(name, await renderPath(name, { desktop })));
  }
}
