// probes/mac-sitting/prepare.mjs
// Makes the scratch Wheelhouse project for checks 33 and 41, as tests/e2e/mod.test.js makes its
// computer: the plugin as committed at the worktree's HEAD, a bare repository standing in for the
// host with pull request 7 on it, the director's checkout, a Wheelhouse home with an enrolled key,
// the project registered with its state cloned, the profile on its own bare repository, and a real
// helper on the home's socket with gh and glab stood in for (helper.mjs). Then the waiting cards,
// each composed by the front desk's own command (scripts/frontdesk/cli.js), and one tick through
// the bridge as the mod runs it, to show what the pane will draw.
//
//   node prepare.mjs                      a separate home, <scratch>/home (the default)
//   node prepare.mjs --real-home --approved
//                                         the director's own ~/.wheelhouse, only if the sitting
//                                         finds a Desktop session's bridge doesn't get the
//                                         project's WHEELHOUSE_HOME (see the run sheet). Not run
//                                         during preparation.
//
// Everything made is listed in made.json, which undo.mjs reads. Nothing is written in the
// repository, and in the default mode nothing under ~/.wheelhouse or ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import {
  BASE, CONFIG, LOGS, MADE, PLUGIN, PR, PROFILE_REPO, PROJECT, PROJECT_DIR, REAL_BEFORE, REAL_HOME, REMOTES, REPO,
  SCRATCH_HOME, WORKTREE, fromPlugin, readMade,
} from './layout.mjs';
import { snapshot } from './snapshot.mjs';

const args = process.argv.slice(2);
const realHome = args.includes('--real-home');
if (realHome && !args.includes('--approved')) {
  console.error('--real-home writes the director\'s own ~/.wheelhouse: run it only after they approved that card, with --approved');
  process.exit(2);
}
if (readMade() !== null) {
  console.error(`Already prepared (${MADE}). Run undo.mjs first to start again.`);
  process.exit(2);
}
const HOME = realHome ? REAL_HOME : SCRATCH_HOME;
if (realHome) {
  for (const taken of ['keys', 'enrolled.json', 'profile.json', path.join('projects', PROJECT), 'STOP']) {
    if (fs.existsSync(path.join(REAL_HOME, taken))) {
      console.error(`~/.wheelhouse already has ${taken}; the sitting won't write over it`);
      process.exit(2);
    }
  }
}

const made = { mode: realHome ? 'real-home' : 'scratch-home', home: HOME, base: BASE, project: PROJECT, folder: PROJECT_DIR, startedAt: new Date().toISOString(), cards: {} };
const keep = () => fs.writeFileSync(MADE, `${JSON.stringify(made, null, 2)}\n`);
const say = (line) => process.stdout.write(`${line}\n`);

// 0. What ~/.wheelhouse holds before anything runs, so undo.mjs can say what appeared in it.
fs.writeFileSync(REAL_BEFORE, `${JSON.stringify(snapshot(REAL_HOME), null, 2)}\n`);
keep();

// 1. The plugin as committed at the worktree's HEAD.
const commit = execFileSync('git', ['-C', WORKTREE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.mkdirSync(PLUGIN, { recursive: true });
execFileSync('/bin/sh', ['-c', `git -C "${WORKTREE}" archive --format=tar ${commit} | tar -x -C "${PLUGIN}"`]);
made.pluginCommit = commit;
keep();
say(`plugin: ${PLUGIN} at ${commit.slice(0, 12)}`);

process.env.WHEELHOUSE_HOME = HOME;
delete process.env.WHEELHOUSE_ROLE;
const { g } = await fromPlugin('tests/helpers/git-fixture.js');
const { writeProject } = await fromPlugin('scripts/lib/projects.js');
const { enrol, makeSigningKey } = await fromPlugin('scripts/state/signing.js');
const { stateDir, wheelhouseHome, helperAddress } = await fromPlugin('scripts/lib/paths.js');
const { helperClient } = await fromPlugin('scripts/host/helper-client.js');
const { projectConfig } = await fromPlugin('scripts/watcher/main.js');
const { projectSettings, localSettings, frontDeskCommand } = await fromPlugin('scripts/protection/settings.js');
if (wheelhouseHome() !== HOME) throw new Error('WHEELHOUSE_HOME was not taken');

// 2. The stand-in host: bare repositories named by owner/name, main with the product and its
// configuration, and pull request 7 one commit on top.
const bare = (repo) => {
  const dir = path.join(REMOTES, `${repo}.git`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', dir]);
  return dir;
};
const remote = bare(REPO);
const profileRemote = bare(PROFILE_REPO);
const seed = path.join(BASE, 'seed');
fs.mkdirSync(path.join(seed, '.claude'), { recursive: true });
await g(seed, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(seed, 'README.md'), 'The product.\n');
fs.writeFileSync(path.join(seed, '.claude', 'wheelhouse.json'), `${JSON.stringify(CONFIG)}\n`);
await g(seed, 'add', '-A');
await g(seed, 'commit', '-q', '-m', 'The product');
await g(seed, 'push', '-q', remote, 'HEAD:refs/heads/main');
fs.mkdirSync(path.join(seed, 'src'), { recursive: true });
fs.writeFileSync(path.join(seed, 'src', 'sign-in.js'), 'export const signIn = true;\n');
await g(seed, 'add', '-A');
await g(seed, 'commit', '-q', '-m', 'The sign-in page');
await g(seed, 'push', '-q', remote, `HEAD:refs/pull/${PR}/head`);
made.head = await g(seed, 'rev-parse', 'HEAD');
fs.rmSync(seed, { recursive: true, force: true });
keep();
say(`stand-in host: ${remote}, pull request #${PR} at ${made.head.slice(0, 12)}`);

// 3. The director's checkout: main with one commit, and a branch called feature.
fs.mkdirSync(PROJECT_DIR, { recursive: true });
await g(PROJECT_DIR, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(PROJECT_DIR, 'app.txt'), 'hello\n');
await g(PROJECT_DIR, 'add', '-A');
await g(PROJECT_DIR, 'commit', '-q', '-m', 'Start');
await g(PROJECT_DIR, 'branch', 'feature');
const folder = fs.realpathSync.native(PROJECT_DIR);

// 4. The home: the project's record, this computer's key enrolled, the profile, and the host
// facts as a fresh cache, so reading the board never asks the stand-in host.
writeProject(PROJECT, { folder, remoteUrl: remote, host: 'github', repo: REPO, connection: { host: 'github', mode: 'quick', project: REPO } });
enrol({ ...makeSigningKey(), enrolledAt: new Date().toISOString() });
fs.writeFileSync(path.join(HOME, 'profile.json'), JSON.stringify({
  remoteUrl: profileRemote, host: 'github', repo: PROFILE_REPO, connection: { host: 'github', mode: 'quick', project: PROFILE_REPO },
}));
const factsFile = path.join(stateDir(PROJECT), '..', 'host-facts.json');
fs.mkdirSync(path.dirname(factsFile), { recursive: true });
fs.writeFileSync(factsFile, `${JSON.stringify({ at: new Date().toISOString(), facts: { protection: 'on', ci: 'present' } })}\n`);
say(`home: ${HOME}, project ${PROJECT} registered for ${folder}`);

// 5. The project's Claude settings: Standard's shared settings, less the marketplace and the
// pinned kits (the plugin comes by hot reloading), with the sandbox and the deny rules naming this
// home as well; and the local settings: the home for this folder's sessions, the helper's socket,
// and the front desk's command allowed by its full path for the extracted copy.
const address = helperAddress();
const shared = projectSettings(CONFIG);
delete shared.extraKnownMarketplaces;
shared.enabledPlugins = Object.fromEntries(Object.entries(shared.enabledPlugins).filter(([, on]) => on === false));
if (!realHome) {
  shared.permissions.deny.push(`Read(/${HOME}/**)`, `Edit(/${HOME}/**)`);
  shared.sandbox.filesystem.denyRead.push(HOME);
  shared.sandbox.filesystem.denyWrite.push(HOME);
}
const local = localSettings({ address, node: null, pluginRoot: PLUGIN });
if (!realHome) local.env = { WHEELHOUSE_HOME: HOME };
fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), `${JSON.stringify(shared, null, 2)}\n`);
fs.writeFileSync(path.join(folder, '.claude', 'settings.local.json'), `${JSON.stringify(local, null, 2)}\n`);
made.frontDeskCommand = frontDeskCommand(PLUGIN);
keep();

// 6. The helper, detached, logging to logs/helper.log.
fs.mkdirSync(LOGS, { recursive: true });
const log = fs.openSync(path.join(LOGS, 'helper.log'), 'a');
const child = spawn(process.execPath, [path.join(BASE, 'helper.mjs')], { cwd: BASE, detached: true, stdio: ['ignore', log, log], env: { ...process.env, WHEELHOUSE_HOME: HOME } });
child.unref();
made.helper = { pid: child.pid, address, script: path.join(BASE, 'helper.mjs') };
keep();
const client = helperClient({ address });
const until = Date.now() + 20000;
while ((await client.health().catch(() => null))?.ok !== true) {
  if (Date.now() > until) throw new Error(`The helper didn't answer; see ${path.join(LOGS, 'helper.log')}`);
  await new Promise((r) => setTimeout(r, 200));
}
const cloned = await client.state.clone({ project: PROJECT });
if (cloned?.ok !== true) throw new Error(`The state clone failed: ${JSON.stringify(cloned)}`);
if ((await projectConfig(PROJECT, client)).config?.watcherShape !== 2) throw new Error('The configuration was not read from the default branch');
say(`helper: pid ${child.pid} on ${address}; state cloned; Shape 2 read from main`);

// 7. The cards, through the front desk's own command, as the scratch session would run it.
const cli = (argv, input) => {
  const out = execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'frontdesk', 'cli.js'), ...argv], {
    cwd: folder, env: { ...process.env, WHEELHOUSE_HOME: HOME }, input: input === undefined ? '' : JSON.stringify(input), encoding: 'utf8',
  });
  return JSON.parse(out);
};
const write = async (kind, data) => {
  const got = await client.state.write({ project: PROJECT, kind, data });
  if (got?.ok !== true) throw new Error(`The ${kind} wasn't recorded: ${JSON.stringify(got)}`);
  return got.id;
};

made.cards.approval = cli(['card'], {
  kind: 'approval', level: 3, what: `Pull request #${PR} adds the sign-in page.`,
  why: 'It changes what users see, which is yours to decide at level 3.',
  options: [{ label: 'Approve', says: 'It goes ahead.' }], recommend: 'Approve', because: 'the checks passed and the change is small',
  meanwhile: 'Nothing is released and the agents carry on with other work.', target: { pr: PR },
}).id;
keep();
// A setting the front desk records, with the confirm card its command composes for it.
const setting = (key, value) => {
  const got = cli(['record', 'setting'], { key, value });
  if (got.card === undefined) throw new Error(`No confirm card came with the ${key} setting`);
  return { setting: got.id, card: got.card.id };
};
made.cards.confirm = setting('showFirst', 'always');
keep();
// A feature's question, recorded as the build records one, made into its answer card by `cards`.
await write('work', { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] });
const questionId = await write('question', {
  id: 'q-export-csv-1', work: 'export-csv', what: 'The export needs to know which separator to use.', why: 'It changes the file people download.',
  options: [{ label: 'Comma', says: 'Commas between values; opens in any spreadsheet.' }, { label: 'Tab', says: 'Tabs between values.' }],
  recommendation: 'Comma', level: 2,
});
const visit = cli(['cards']);
made.cards.answer = { question: questionId, asked: visit.questions.map((q) => q.header) };
keep();
made.cards.product = cli(['card'], {
  kind: 'question', level: 2, what: 'Which colour goes on the sign-in button?', why: 'It is what users see first.',
  options: [{ label: 'Blue', says: 'The button is blue, like the logo.' }, { label: 'Green', says: 'The button is green, so it stands out.' }],
  recommend: 'Blue', because: 'it matches the logo', meanwhile: 'The button stays grey.',
}).id;
keep();
// Launch progress for check 42: five blockers, three of them cleared.
for (const [key, what, resolved] of [
  ['login', 'People can sign in', true], ['terms', 'A terms page', true], ['help', 'A help page', true],
  ['pay', 'Taking a payment', false], ['mail', 'Sending a welcome email', false],
]) await write('blocker', { key, what, resolved });
keep();
// Check 33's two cards with a confirmation line and a reply code: one answered by a typed code,
// one by a code sent from the phone.
made.cards.check33Typed = setting('milestones', 'demos');
made.cards.check33Phone = setting('efficiency', 'lean');
keep();
say(`cards: ${JSON.stringify(made.cards)}`);

made.preparedAt = new Date().toISOString();
keep();
say(`made: ${MADE}`);
await client.close?.();
process.exit(0);
