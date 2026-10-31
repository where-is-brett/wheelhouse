// probes/82-check-sandbox/run.js
// Check 82: a real Mac app's tests under the check sandbox (spec section 4.4). Three phases:
//
//   node probes/82-check-sandbox/run.js ways [--profile deny|draft|tight] [--stage test|prepare] [--prompts]    every way out, from inside the sandbox
//                                          (--prompts includes the Apple Events ways under draft: they raise a prompt)
//   node probes/82-check-sandbox/run.js fixture [--profile draft|tight|open] [--once]    a made-up app: is a test still inside?
//   node probes/82-check-sandbox/run.js swift [--profile ...]              a made-up Swift package: the table's next row
//   node probes/82-check-sandbox/run.js project <folder> [--profile ...] [--scheme S] [--container rel] [--minutes 20]
//   node probes/82-check-sandbox/run.js runner <folder>|--fixture [--test "command"] [--prepare "command"] [--minutes 20]
//                                          the check runner itself, from fetch to word, on a copy of the folder's head
//   node probes/82-check-sandbox/run.js hang <folder> [--test "command"] [--prepare "command"] [--after 120] [--minutes 15]
//                                          runner, with the sandbox's refusals read live; once a test process has lived
//                                          --after seconds it and all it started are sampled, and the check is ended
//
// `deny` is the check runner's own profile (scripts/checks/profile.js) and the default. Don't use draft or open on a
// project: `xcodebuild test` has the system start the project's app outside the sandbox (see docs/checks/82-check-sandbox.md).
//
// `project` changes nothing in <folder>: it reads the folder's head commit by `git fetch` into a check folder of its
// own under ~/Library/Caches, outside the temporary folders the profile lets a check write, as the real check folder
// is. What it prints has the project's names taken out, so the output can go into a public note; the whole log stays
// in the check folder until that goes to the Trash at the end (--keep leaves it).
//
// A way out counts as open only on proof: a job started from inside the sandbox reads a planted secret that the
// profile denies and writes it beside the secret, in a folder the profile can't write. Keys are never printed:
// anything near one is counted in characters. It must run outside any other sandbox (macOS refuses to nest them).
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { testEnv } from '../../scripts/lib/local-git.js';
import { credentialPaths } from '../../scripts/lib/credentials.js';
import { archonDenyRules, KEYCHAINS } from '../../scripts/protection/settings.js';
import { checkProfile } from '../../scripts/checks/profile.js';
import { endCheck, runCheck } from '../../scripts/checks/run.js';
import { writeFixture } from './fixture.js';

const REAL_HOME = os.homedir();
const XCODE = '/Applications/Xcode.app/Contents/Developer';
const SANDBOX = '/usr/bin/sandbox-exec';
const SWITCHES = ['-IDEPackageSupportDisableManifestSandbox=YES', '-IDEPackageSupportDisablePackageSandbox=YES'];
const OUTPUT = '.build/checks';
const MARK = 'wheelhouse-check-82';
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const quoted = (text) => `"${String(text).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const shq = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;
const expand = (p) => (p.startsWith('~/') ? path.join(REAL_HOME, p.slice(2)) : p);

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

function makeRoot() {
  // Laid out as the real check folder is, deep inside a folder on the deny list (~/.wheelhouse/engine/checks/<project>).
  const outer = path.join(REAL_HOME, 'Library', 'Caches', `${MARK}-${crypto.randomBytes(3).toString('hex')}`);
  const root = path.join(outer, 'engine', 'checks', 'project');
  const paths = { outer, root, tree: path.join(root, 'tree'), gitDir: path.join(root, 'tree.git'), home: path.join(root, 'home'), mainHome: path.join(root, 'main-home'), outside: path.join(outer, 'outside') };
  for (const dir of [paths.tree, paths.home, paths.mainHome, path.join(paths.home, 'tmp'), paths.outside]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(paths.outside, 'secret.txt'), crypto.randomBytes(16).toString('hex'));
  return paths;
}

async function darwinFolder(name) {
  const got = await run('/usr/bin/getconf', [name]);
  return fs.realpathSync(got.stdout.trim());
}

// The deny list of scripts/protection/settings.js as paths, with the check's planted secret beside it.
function denyList(paths) {
  const engine = archonDenyRules().denyRead.map(expand);
  return [...new Set([expand('~/.wheelhouse'), expand(KEYCHAINS), ...credentialPaths('darwin').map((p) => path.join(REAL_HOME, p)), ...engine, paths.outside])];
}

const subpaths = (list) => list.map((p) => `(subpath ${quoted(p)})`).join(' ');

// The draft of spec 4.4, with the device files every program needs. The last matching rule wins. `tight` adds what
// shuts the ways out that an allow-by-default profile leaves open.
export function profileFor({ paths, variant, stage = 'test', temp }) {
  if (variant === 'open') return '(version 1)\n(allow default)';
  if (variant === 'deny') return checkProfile({ paths, main: false, stage, network: false, denied: [...denyList(paths), paths.outer], temp: ['/private/tmp', '/private/var/tmp'], userHome: REAL_HOME });
  const writes = [paths.tree, paths.home, ...temp];
  const lines = [
    '(version 1)',
    '(allow default)',
    `(deny file-read* ${subpaths(denyList(paths))} (with message "${MARK}"))`,
  ];
  // Denying the home folder also denies the folders on the way down to the check folder, which a process must be able
  // to look at to start there.
  const above = [];
  for (let at = paths.root; at.length > 1 && at.startsWith(REAL_HOME); at = path.dirname(at)) above.push(at);
  if (stage === 'prepare') lines.push(`(deny file-read* (subpath ${quoted(REAL_HOME)}) (with message "${MARK}"))`, `(allow file-read* ${above.map((p) => `(literal ${quoted(p)})`).join(' ')})`);
  lines.push(
    `(allow file-read* ${subpaths([paths.tree, paths.home])})`,
    `(deny file-write* (with message "${MARK}"))`,
    `(allow file-write* ${subpaths(writes)} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/tty") (literal "/dev/dtracehelper") (literal "/dev/ptmx") (regex #"^/dev/(fd|ttys)"))`,
  );
  if (stage !== 'prepare') lines.push(`(deny network-outbound (with message "${MARK}"))`, '(allow network-outbound (remote ip "localhost:*") (remote unix-socket))');
  if (variant === 'tight') {
    lines.push(
      `(deny appleevent-send (with message "${MARK}"))`,
      `(deny lsopen (with message "${MARK}"))`,
      `(deny job-creation (with message "${MARK}"))`,
      `(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.coreservices.sharedfilelistd") (global-name "com.apple.coreservices.sharedfilelistd.xpc") (global-name "com.apple.pasteboard.1") (with message "${MARK}"))`,
      `(deny process-info* (with message "${MARK}"))`,
      '(allow process-info* (target self))',
      `(deny signal (with message "${MARK}"))`,
      '(allow signal (target same-sandbox))',
      `(deny network-outbound (remote unix-socket (path-regex ${quoted(`^${path.join(REAL_HOME).replaceAll('.', '\\.')}/`)})) (with message "${MARK}"))`,
    );
  }
  return lines.join('\n');
}

const childEnv = (paths, more = {}) => ({ ...more, HOME: paths.home, CFFIXED_USER_HOME: paths.home, DEVELOPER_DIR: XCODE, TMPDIR: path.join(paths.home, 'tmp') });

// One command under the profile, or with none when `profile` is null (the control).
async function jailed(profile, command, { paths, timeoutMs = 20000, env = {}, cwd = paths.tree } = {}) {
  const args = profile ? ['-p', profile, '/bin/sh', '-c', command] : null;
  const file = profile ? SANDBOX : '/bin/sh';
  return run(file, args ?? ['-c', command], { cwd, baseEnv: testEnv(), env: childEnv(paths, env), timeoutMs, limit: 256 * 1024 });
}

async function waitFor(file, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fs.existsSync(file)) return true;
    await sleep(250);
  }
  return fs.existsSync(file);
}

// ---- The ways out ------------------------------------------------------------------------------------------------

function payload(paths, way) {
  const file = path.join(paths.tree, `payload-${way}.sh`);
  fs.writeFileSync(file, `#!/bin/sh\ncat ${shq(path.join(paths.outside, 'secret.txt'))} > ${shq(path.join(paths.outside, `proof-${way}`))}\n`, { mode: 0o755 });
  return file;
}

// A small app whose program is the payload: what LaunchServices would start outside the sandbox.
function payloadApp(paths, way) {
  const app = path.join(paths.tree, `Way${way.replaceAll('-', '')}.app`);
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>go</string><key>CFBundleIdentifier</key><string>invalid.wheelhouse.check82.${way}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>\n`);
  fs.copyFileSync(payload(paths, way), path.join(app, 'Contents', 'MacOS', 'go'));
  fs.chmodSync(path.join(app, 'Contents', 'MacOS', 'go'), 0o755);
  return app;
}

function agentPlist(paths, way, label) {
  const file = path.join(paths.tree, `${label}.plist`);
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>/bin/sh</string><string>${payload(paths, way)}</string></array><key>RunAtLoad</key><true/></dict></plist>\n`);
  return file;
}

// A compiled program opening the app: no named tool to deny, so it tests the services and not the commands.
async function compiledOpener(paths) {
  const source = path.join(paths.root, 'opener.swift');
  const program = path.join(paths.root, 'opener');
  fs.writeFileSync(source, 'import AppKit\nimport CoreServices\nlet url = URL(fileURLWithPath: CommandLine.arguments[1])\nlet done = CommandLine.arguments.count > 2 ? LSOpenCFURLRef(url as CFURL, nil) == 0 : NSWorkspace.shared.open(url)\nRunLoop.current.run(until: Date().addingTimeInterval(3))\nexit(done ? 0 : 3)\n');
  const got = await run('/usr/bin/xcrun', ['swiftc', '-O', source, '-o', program], { env: { DEVELOPER_DIR: XCODE }, timeoutMs: 180000 });
  return got.code === 0 ? program : null;
}

async function listener(file) {
  const seen = { connected: false };
  const server = net.createServer((socket) => { seen.connected = true; socket.end('hello\n'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(file, resolve); });
  return { seen, close: () => new Promise((resolve) => { server.close(resolve); }) };
}

function ways(paths, opener, ctx) {
  const uid = process.getuid();
  const label = (way) => `invalid.wheelhouse.check82.${way}.${path.basename(paths.root).slice(-6)}`;
  const proved = (way) => path.join(paths.outside, `proof-${way}`);
  const list = [
    { way: 'read-denied-file', run: `cat ${shq(path.join(paths.outside, 'secret.txt'))} | wc -c`, control: true, read: (got) => /\b32\b/.test(got.stdout) },
    { way: 'write-outside', run: `echo x > ${shq(path.join(paths.outside, 'proof-write-outside'))}`, control: true, proof: 'write-outside' },
    { way: 'read-keychain-file', run: `head -c 16 ${shq(path.join(expand(KEYCHAINS), 'login.keychain-db'))} | wc -c`, control: true, read: (got) => /\b16\b/.test(got.stdout) },
    { way: 'read-keychain-security', run: `/usr/bin/security show-keychain-info ${shq(path.join(expand(KEYCHAINS), 'login.keychain-db'))} >/dev/null 2>&1; echo $?`, read: (got) => got.stdout.trim() === '0' },
    { way: 'git-credential-osxkeychain', run: `printf 'protocol=https\\nhost=github.com\\n\\n' | ${XCODE}/usr/libexec/git-core/git-credential-osxkeychain get 2>/dev/null | wc -c`, read: (got) => Number(got.stdout.trim()) > 0 },
    { way: 'gh-auth-token', run: `HOME=${shq(REAL_HOME)} /opt/homebrew/bin/gh auth token 2>/dev/null | wc -c`, read: (got) => Number(got.stdout.trim()) > 0 },
    { way: 'read-wheelhouse-folder', run: `ls -a ${shq(expand('~/.wheelhouse'))} | wc -l`, control: true, read: (got) => Number(got.stdout.trim()) > 0 },
    { way: 'read-ssh-folder', run: `ls -a ${shq(expand('~/.ssh'))} | wc -l`, control: true, read: (got) => Number(got.stdout.trim()) > 0 },
    { way: 'curl-out', run: 'curl -sS -m 8 -o /dev/null -w "%{http_code}" https://example.com', control: true, read: (got) => /^[23]\d\d/.test(got.stdout) },
    { way: 'launchctl-submit', run: (way) => `/bin/launchctl submit -l ${label(way)} -- /bin/sh ${shq(payload(paths, way))}`, control: true, proof: 'launchctl-submit', after: (way) => ['/bin/launchctl', ['remove', label(way)]] },
    { way: 'launchctl-bootstrap', run: (way) => `/bin/launchctl bootstrap gui/${uid} ${shq(agentPlist(paths, way, label(way)))}`, control: true, proof: 'launchctl-bootstrap', after: (way) => ['/bin/launchctl', ['bootout', `gui/${uid}/${label(way)}`]] },
    { way: 'open-app', run: (way) => `/usr/bin/open -g -n ${shq(payloadApp(paths, way))}`, control: true, proof: 'open-app' },
    ...(opener ? [
      { way: 'compiled-open-app', run: (way) => `${shq(opener)} ${shq(payloadApp(paths, way))}`, control: true, proof: 'compiled-open-app' },
      { way: 'compiled-ls-open-app', run: (way) => `${shq(opener)} ${shq(payloadApp(paths, way))} ls`, control: true, proof: 'compiled-ls-open-app' },
    ] : []),
    { way: 'osascript-finder-open', run: (way) => `/usr/bin/osascript -e ${shq(`tell application "Finder" to open POSIX file ${JSON.stringify(payloadApp(paths, way))}`)}`, proof: 'osascript-finder-open' },
    { way: 'osascript-terminal-script', run: (way) => `/usr/bin/osascript -e ${shq(`tell application "Terminal" to do script ${JSON.stringify(`/bin/sh ${payload(paths, way)}; exit`)}`)}`, proof: 'osascript-terminal-script' },
    { way: 'login-item-events', run: (way) => `/usr/bin/osascript -e ${shq(`tell application "System Events" to make login item at end with properties {path:${JSON.stringify(payloadApp(paths, way))}, hidden:true}`)}`, proof: null, loginItem: (way) => `Way${way.replaceAll('-', '')}` },
    { way: 'login-item-file', run: (way) => `cp ${shq(agentPlist(paths, way, label(way)))} ${shq(path.join(REAL_HOME, 'Library', 'LaunchAgents', `${label(way)}.plist`))}`, file: (way) => path.join(REAL_HOME, 'Library', 'LaunchAgents', `${label(way)}.plist`) },
    { way: 'unix-socket-in-denied-folder', run: () => `/usr/bin/nc -U -w 3 ${shq(path.join(paths.outside, 's.sock'))} </dev/null`, control: true, socket: true },
    { way: 'other-process-environment', run: (way, ctx) => `/bin/ps eww -p ${ctx.victim.pid} | grep -c WHEELHOUSE_CHECK_82_CANARY`, control: true, read: (got) => Number(got.stdout.trim()) > 0 },
    { way: 'signal-other-process', run: (way, ctx) => `kill -0 ${ctx.victim.pid}; echo $?`, control: true, read: (got) => got.stdout.trim() === '0' },
    { way: 'clipboard-read', run: '/usr/bin/pbpaste 2>/dev/null | wc -c', control: true, read: (got) => Number(got.stdout.trim()) > 0 },
    { way: 'list-folder-above', run: `ls -a ${shq(paths.outer)} | wc -l`, control: true, read: (got) => Number(got.stdout.trim()) > 0 },
    { way: 'plant-in-user-temp', run: `echo x > ${shq(path.join(ctx.userTemp, `${MARK}-plant`))}`, control: true, file: () => path.join(ctx.userTemp, `${MARK}-plant`) },
    { way: 'preference-write', run: '/usr/bin/defaults write invalid.wheelhouse.check82 a b', control: true, file: () => path.join(REAL_HOME, 'Library', 'Preferences', 'invalid.wheelhouse.check82.plist') },
    ...(process.env.SSH_AUTH_SOCK ? [{ way: 'ssh-agent-socket', run: `/usr/bin/nc -U -w 3 ${shq(process.env.SSH_AUTH_SOCK)} </dev/null; echo $?`, control: true, read: (got) => got.stdout.trim() === '0' }] : []),
  ];
  return list.map((entry) => ({ proved: proved(entry.proof ?? entry.way), ...entry }));
}

async function tidy(entry, way) {
  if (entry.after) {
    const [file, args] = entry.after(way);
    await run(file, args);
  }
  if (entry.loginItem) await run('/usr/bin/osascript', ['-e', `tell application "System Events" to delete (every login item whose name is "${entry.loginItem(way)}")`], { timeoutMs: 15000 }).catch(() => {});
  if (entry.file && fs.existsSync(entry.file(way))) await run('/usr/bin/trash', [entry.file(way)]);
}

async function tryWay(entry, profile, ctx) {
  const { paths } = ctx;
  const way = entry.way;
  for (const name of fs.readdirSync(paths.outside)) if (name.startsWith('proof-')) fs.renameSync(path.join(paths.outside, name), path.join(paths.root, `was-${name}-${crypto.randomBytes(2).toString('hex')}`));
  let server = null;
  if (entry.socket) {
    fs.rmSync(path.join(paths.outside, 's.sock'), { force: true });
    server = await listener(path.join(paths.outside, 's.sock'));
  }
  const command = typeof entry.run === 'function' ? entry.run(way, ctx) : entry.run;
  const got = await jailed(profile, command, { paths, timeoutMs: 25000 });
  let open;
  if (entry.read) open = entry.read(got);
  else if (entry.socket) open = server.seen.connected;
  else if (entry.file) open = fs.existsSync(entry.file(way));
  else if (entry.loginItem) {
    const list = await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get the name of every login item'], { timeoutMs: 15000 }).catch(() => ({ stdout: '' }));
    open = list.stdout.includes(entry.loginItem(way));
  } else open = await waitFor(entry.proved, 6000);
  if (server) await server.close();
  await tidy(entry, way);
  const said = `${got.stdout}\n${got.stderr}`.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
  return { way, open, code: got.code, timedOut: got.timedOut === true, said: entry.read ? got.stdout.trim().slice(0, 40) : said.replaceAll(REAL_HOME, '~').slice(0, 160) };
}

async function phaseWays() {
  const paths = makeRoot();
  const temp = [await darwinFolder('DARWIN_USER_TEMP_DIR'), await darwinFolder('DARWIN_USER_CACHE_DIR'), '/private/tmp', '/private/var/tmp'];
  const opener = await compiledOpener(paths);
  const victim = spawn('/bin/sleep', ['600'], { env: { WHEELHOUSE_CHECK_82_CANARY: '1' }, stdio: 'ignore' });
  const ctx = { paths, victim, userTemp: temp[0] };
  const variants = [option('profile', 'deny')];
  const prompts = process.argv.includes('--prompts');
  const report = { compiledOpener: opener !== null, runs: {} };
  try {
    // Under a profile that lets Apple Events out, these reach macOS's consent prompt on the director's screen.
    const entries = ways(paths, opener, ctx).filter((e) => prompts || variants[0] !== 'draft' || !/^osascript|^login-item-events/.test(e.way));
    report.control = [];
    for (const entry of entries.filter((e) => e.control)) report.control.push(await tryWay(entry, null, ctx));
    for (const variant of variants) {
      const profile = profileFor({ paths, variant, stage: option('stage', 'test'), temp });
      const loads = await jailed(profile, 'echo loaded', { paths });
      report.runs[variant] = { loads: loads.code === 0, loadError: loads.code === 0 ? '' : loads.stderr.trim().slice(0, 300), ways: [] };
      if (loads.code !== 0) continue;
      for (const entry of entries) report.runs[variant].ways.push(await tryWay(entry, profile, ctx));
    }
  } finally {
    victim.kill();
    await finish(paths, report);
  }
}

// ---- A real build ------------------------------------------------------------------------------------------------

// The lines of a test run that name no test: its counts and its word. Test and suite names stay out of every report.
const summaryOf = (lines) => lines.filter((line) => /^\W*Test run with \d+ tests?\b|Executed \d+ tests?,|\*\* .* \*\*|Build complete|Compiling|error: (?:fatal|terminated)/.test(line) && !/Test Suite|Test Case|\.swift/.test(line));

// A path in a refusal, cut to the folders that say where it was, with no file's name.
function placeOf(what, root) {
  return what.replace(/\/\S.*$/, (full) => {
    if (full.startsWith(`${root}/`)) return `<check>/${full.slice(root.length + 1).split('/')[0]}`;
    if (full.startsWith(`${REAL_HOME}/`)) return `~/${full.slice(REAL_HOME.length + 1).split('/').slice(0, 3).join('/')}`;
    return full.split('/').slice(0, 5).join('/');
  });
}

// Takes the project's names out of a line.
function maskerOf(names) {
  const sorted = [...new Set(names.filter((n) => n && n.length > 1))].sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text).replaceAll(REAL_HOME, '~');
    sorted.forEach((name, i) => { out = out.split(name).join(`<name-${i + 1}>`); });
    return out.replace(/\S+\.(swift|m|mm|h|plist|xcconfig|storyboard|xib)\b/g, '<source file>').replace(/https?:\/\/\S+|git@\S+/g, '<address>');
  };
}

const git = (cwd, ...args) => run('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, baseEnv: withoutGitVars(testEnv()), env: { DEVELOPER_DIR: XCODE } });

// A copy of the folder's head commit in a check folder of its own: nothing links back, and nothing is written there.
async function fetchCopy(folder, paths) {
  const head = await git(folder, 'rev-parse', 'HEAD');
  if (head.code !== 0) throw new Error(`Not a git folder with a commit: ${head.stderr.trim()}`);
  const commit = head.stdout.trim();
  const steps = [
    ['init', '-q', `--separate-git-dir=${paths.gitDir}`, paths.tree],
    ['-C', paths.tree, 'fetch', '-q', '--no-tags', folder, 'HEAD'],
    ['-C', paths.tree, 'checkout', '-q', '--detach', 'FETCH_HEAD'],
  ];
  for (const step of steps) {
    const got = await git(paths.root, ...step);
    if (got.code !== 0) throw new Error(`git ${step.join(' ')}: ${got.stderr.trim()}`);
  }
  return commit;
}

function containerIn(tree, given) {
  if (given) return given;
  const skip = new Set(['.git', '.build', 'Pods', 'node_modules', 'Carthage']);
  const found = [];
  const walk = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (/\.(xcworkspace|xcodeproj)$/.test(entry.name)) found.push(path.relative(tree, full));
      else if (depth < 2) walk(full, depth + 1);
    }
  };
  walk(tree, 0);
  const workspace = found.find((f) => f.endsWith('.xcworkspace'));
  return workspace ?? found[0] ?? null;
}

function sharedSchemes(tree, container) {
  const out = [];
  const lookIn = (folder) => {
    const dir = path.join(tree, folder, 'xcshareddata', 'xcschemes');
    if (fs.existsSync(dir)) out.push(...fs.readdirSync(dir).filter((n) => n.endsWith('.xcscheme')).map((n) => n.slice(0, -'.xcscheme'.length)));
  };
  lookIn(container);
  if (container.endsWith('.xcworkspace')) {
    const data = path.join(tree, container, 'contents.xcworkspacedata');
    const text = fs.existsSync(data) ? fs.readFileSync(data, 'utf8') : '';
    for (const match of text.matchAll(/location\s*=\s*"group:([^"]+\.xcodeproj)"/g)) lookIn(path.join(path.dirname(container), match[1]));
  }
  return [...new Set(out)];
}

// The processes under the check folder or named as test runners, and whether each came down from the check's own
// process: one that didn't was started by a system service, outside the sandbox.
function watchProcesses(rootPid, root) {
  const seen = new Map();
  let stopped = false;
  const looks = /xctest|XCTRunner|\.app\/Contents\/MacOS\//i;
  const tick = async () => {
    while (!stopped) {
      const got = await run('/bin/ps', ['-axo', 'pid=,ppid=,command=']);
      const rows = got.stdout.split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
      const parent = new Map(rows.map((r) => [r.pid, r.ppid]));
      for (const row of rows) {
        if (!row.command.includes(root) || !looks.test(row.command)) continue;
        let at = row.pid;
        while (at > 1 && at !== rootPid) at = parent.get(at) ?? 1;
        const name = /xctest/i.test(row.command) ? 'a test bundle\'s process' : 'an app from the build';
        const key = `${name}:${at === rootPid ? 'inside' : 'outside'}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      await sleep(1000);
    }
  };
  const done = tick();
  return async () => { stopped = true; await done; return Object.fromEntries(seen); };
}

// The kernel's own lines about what the profile refused, by operation and folder.
async function denials(since) {
  const got = await run('/usr/bin/log', ['show', '--start', since, '--style', 'ndjson', '--predicate', 'eventMessage CONTAINS "deny(" AND eventMessage CONTAINS "Sandbox"'], { timeoutMs: 120000, limit: 4 * 1024 * 1024 });
  const counts = new Map();
  for (const line of got.stdout.split('\n')) {
    let message;
    try { message = JSON.parse(line).eventMessage; } catch { continue; }
    if (typeof message !== 'string') continue;
    const m = /Sandbox:\s+(\S+?)\(\d+\)\s+deny\(\d+\)\s+(\S+)\s*(.*?)\s*(?:wheelhouse-check-82)?$/.exec(message);
    if (!m) continue;
    const key = `${m[1]} ${m[2]} ${m[3].split('/').slice(0, 7).join('/')}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
}

// Ends what a stage left running from the check folder, one process at a time, and says how many there were: a check
// can't end what the system started for it.
async function leftovers(root) {
  const got = await run('/bin/ps', ['-axo', 'pid=,command=']);
  const pids = got.stdout.split('\n').map((line) => /^\s*(\d+)\s+(.*)$/.exec(line)).filter((m) => m && m[2].includes(root)).map((m) => Number(m[1]));
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* it has gone */ } }
  return pids.length;
}

// Runs one stage under the profile, timed.
async function stage(name, profile, argv, { paths, minutes, log, mask }) {
  const started = Date.now();
  // `log show` reads local time. Given UTC, it searches every hour of the difference and takes over a minute to do it.
  const local = new Date(started - 1000 - new Date().getTimezoneOffset() * 60000);
  const since = local.toISOString().replace('T', ' ').slice(0, 19);
  const command = argv.map(shq).join(' ');
  const child = spawn(SANDBOX, ['-p', profile, '/bin/sh', '-c', `exec ${command}`], { cwd: paths.tree, env: { ...testEnv(), ...childEnv(paths) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const stopWatch = watchProcesses(child.pid, paths.root);
  const out = fs.createWriteStream(log, { flags: 'a' });
  out.write(`\n===== ${name}: ${command}\n`);
  let tail = '';
  const keep = (chunk) => { out.write(chunk); tail = (tail + chunk.toString()).slice(-64 * 1024); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* it has gone */ } }, minutes * 60 * 1000);
  // Past the time limit the answer doesn't wait for whatever still holds the output open.
  const code = await new Promise((resolve) => {
    child.on('close', (c) => resolve(c));
    child.on('error', () => resolve(-1));
    setTimeout(() => resolve(null), minutes * 60 * 1000 + 15000).unref();
  });
  clearTimeout(timer);
  out.end();
  const seconds = Math.round((Date.now() - started) / 1000);
  const processes = await stopWatch();
  const left = await leftovers(paths.root);
  const lines = summaryOf(tail.split('\n').map(mask)).slice(-40);
  const refused = (await denials(since)).map(([what, count]) => [mask(what), count]);
  return { name, code, timedOut, left, seconds, processes, lines, refused };
}

// A failed first test stage tries once more with the test host taken out, which is how tests that need no app can run
// when the profile refuses to start one.
function xcodeCommands(container, scheme) {
  const where = container.endsWith('.xcworkspace') ? ['-workspace', container] : ['-project', container];
  const base = ['/usr/bin/xcrun', 'xcodebuild', ...where, '-scheme', scheme, '-derivedDataPath', OUTPUT, ...SWITCHES];
  const tests = [...base, 'test', '-destination', 'platform=macOS', 'CODE_SIGNING_ALLOWED=NO'];
  return { prepareCommand: [...base, '-resolvePackageDependencies'], tests, noHost: [...tests, 'TEST_HOST=', 'BUNDLE_LOADER='], output: OUTPUT };
}

const SWIFT = { prepareCommand: ['/usr/bin/xcrun', 'swift', 'package', 'resolve', '--disable-sandbox'], tests: ['/usr/bin/xcrun', 'swift', 'test', '--disable-sandbox'], noHost: null, output: '.build' };

async function buildAndTest({ paths, commands, profileName, minutes, mask, prepare = true }) {
  const { prepareCommand, tests, noHost, output: outputFolder } = commands;
  const temp = [await darwinFolder('DARWIN_USER_TEMP_DIR'), await darwinFolder('DARWIN_USER_CACHE_DIR'), '/private/tmp', '/private/var/tmp'];
  const log = path.join(paths.root, 'whole-log.txt');
  const test = profileFor({ paths, variant: profileName, stage: 'test', temp });
  const stages = [];
  if (prepare) stages.push(await stage('prepare', profileFor({ paths, variant: profileName, stage: 'prepare', temp }), prepareCommand, { paths, minutes, log, mask }));
  stages.push(await stage('test, nothing kept', test, tests, { paths, minutes, log, mask }));
  if (noHost && stages.at(-1).code !== 0) stages.push(await stage('test, with no test host', test, noHost, { paths, minutes, log, mask }));
  if (process.argv.includes('--once')) return { stages };
  const ignored = await git(paths.tree, 'check-ignore', '-q', outputFolder);
  if (ignored.code !== 0) fs.appendFileSync(path.join(paths.gitDir, 'info', 'exclude'), `${outputFolder}\n`);
  await git(paths.tree, 'reset', '-q', '--hard');
  await git(paths.tree, 'clean', '-qfd');
  const kept = fs.existsSync(path.join(paths.tree, outputFolder));
  stages.push(await stage('test, build output kept', test, tests, { paths, minutes, log, mask }));
  const home = await run('/usr/bin/du', ['-sk', paths.home]);
  const output = await run('/usr/bin/du', ['-sk', path.join(paths.tree, outputFolder)]);
  return {
    stages,
    outputIgnoredByProject: ignored.code === 0,
    outputSurvivedClean: kept,
    homeWritten: fs.readdirSync(paths.home, { recursive: true }).slice(0, 25).map(String).map(mask),
    homeKilobytes: Number(home.stdout.split(/\s/)[0]),
    outputKilobytes: Number(output.stdout.split(/\s/)[0]),
  };
}

async function phaseProject() {
  const folder = path.resolve(process.argv[3] ?? '');
  if (!process.argv[3] || !fs.existsSync(path.join(folder, '.git'))) throw new Error('Give the project folder');
  const paths = makeRoot();
  const report = {};
  try {
    const commit = await fetchCopy(folder, paths);
    const container = containerIn(paths.tree, option('container'));
    const remote = await git(folder, 'remote', 'get-url', 'origin');
    const manifest = path.join(paths.tree, 'Package.swift');
    const generated = fs.existsSync(path.join(paths.tree, 'project.yml'));
    if (!container && !fs.existsSync(manifest)) throw new Error('No workspace, Xcode project or Package.swift in the folder\'s head commit');
    report.commitLength = commit.length;
    report.projectYml = generated;
    if (!container) {
      const text = fs.readFileSync(manifest, 'utf8');
      const names = [path.basename(folder), path.basename(remote.stdout.trim()).replace(/\.git$/, ''), ...[...text.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])];
      report.route = 'swift package, no committed Xcode project';
      report.testTargets = (text.match(/\.testTarget\(/g) ?? []).length;
      report.xcodegenOnThisComputer = (await run('/bin/sh', ['-c', 'command -v xcodegen'], { env: { PATH: `${process.env.PATH}:/opt/homebrew/bin` } })).code === 0;
      report.hasPackageResolved = fs.readdirSync(paths.tree, { recursive: true }).some((f) => String(f).endsWith('Package.resolved'));
      Object.assign(report, await buildAndTest({ paths, commands: SWIFT, profileName: option('profile', 'deny'), minutes: Number(option('minutes', 20)), mask: maskerOf(names) }));
      return;
    }
    const shared = sharedSchemes(paths.tree, container);
    const scheme = option('scheme') ?? shared[0];
    if (!scheme) throw new Error('No shared scheme: give --scheme');
    const names = [path.basename(folder), path.basename(container).replace(/\.\w+$/, ''), scheme, ...shared, path.basename(remote.stdout.trim()).replace(/\.git$/, '')];
    const mask = maskerOf(names);
    report.containerKind = path.extname(container);
    report.sharedSchemes = shared.length;
    report.hasPackageResolved = fs.readdirSync(paths.tree, { recursive: true }).some((f) => String(f).endsWith('Package.resolved'));
    Object.assign(report, await buildAndTest({ paths, commands: xcodeCommands(container, scheme), profileName: option('profile', 'deny'), minutes: Number(option('minutes', 20)), mask }));
  } finally {
    await finish(paths, report);
  }
}

async function phaseFixture() {
  const paths = makeRoot();
  const report = {};
  try {
    const { scheme, container } = writeFixture(paths.tree, { outside: paths.outside, keychains: expand(KEYCHAINS) });
    await git(paths.root, 'init', '-q', `--separate-git-dir=${paths.gitDir}`, paths.tree);
    await git(paths.tree, 'add', '-A');
    await git(paths.tree, '-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid', 'commit', '-qm', 'The made-up app');
    Object.assign(report, await buildAndTest({ paths, commands: xcodeCommands(container, scheme), profileName: option('profile', 'deny'), minutes: Number(option('minutes', 20)), mask: (text) => String(text).replaceAll(REAL_HOME, '~'), prepare: false }));
    report.fromInsideTheTests = {};
    for (const kind of ['App', 'Hosted', 'Bare']) {
      const inTree = path.join(paths.tree, `where-${kind}.json`);
      const beside = path.join(paths.root, `where-${kind}.json`);
      const file = [inTree, beside].find((f) => fs.existsSync(f));
      report.fromInsideTheTests[kind] = file ? { ...JSON.parse(fs.readFileSync(file, 'utf8')), wroteIn: file === inTree ? 'tree' : 'beside the tree' } : 'no answer written';
    }
    report.proofsBesideTheSecret = fs.readdirSync(paths.outside).filter((n) => n.startsWith('proof-'));
  } finally {
    await finish(paths, report);
  }
}

// The table's Package.swift row: `prepare` under the prepare profile, then the tests.
async function phaseSwift() {
  const paths = makeRoot();
  const report = {};
  try {
    const temp = [await darwinFolder('DARWIN_USER_TEMP_DIR'), await darwinFolder('DARWIN_USER_CACHE_DIR'), '/private/tmp', '/private/var/tmp'];
    fs.mkdirSync(path.join(paths.tree, 'Sources', 'Fix82'), { recursive: true });
    fs.mkdirSync(path.join(paths.tree, 'Tests', 'Fix82Tests'), { recursive: true });
    fs.writeFileSync(path.join(paths.tree, 'Package.swift'), '// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "Fix82", targets: [.target(name: "Fix82"), .testTarget(name: "Fix82Tests", dependencies: ["Fix82"])])\n');
    fs.writeFileSync(path.join(paths.tree, 'Sources', 'Fix82', 'Add.swift'), 'public func sum(_ a: Int, _ b: Int) -> Int { a + b }\n');
    fs.writeFileSync(path.join(paths.tree, 'Tests', 'Fix82Tests', 'AddTests.swift'), 'import XCTest\nimport Fix82\nfinal class AddTests: XCTestCase { func testAdd() { XCTAssertEqual(sum(1, 2), 3) } }\n');
    const log = path.join(paths.root, 'whole-log.txt');
    const mask = (text) => String(text).replaceAll(REAL_HOME, '~');
    const variant = option('profile', 'deny');
    const prepare = profileFor({ paths, variant, stage: 'prepare', temp });
    const test = profileFor({ paths, variant, stage: 'test', temp });
    report.prepare = await stage('prepare', prepare, ['/usr/bin/xcrun', 'swift', 'package', 'resolve', '--disable-sandbox'], { paths, minutes: 5, log, mask });
    report.test = await stage('test', test, ['/usr/bin/xcrun', 'swift', 'test', '--disable-sandbox'], { paths, minutes: 8, log, mask });
    report.homeWritten = fs.readdirSync(paths.home, { recursive: true }).slice(0, 12).map(String);
  } finally {
    await finish(paths, report);
  }
}

// runCheck itself, in a Wheelhouse home of its own under a throwaway folder, on a bare copy of the folder's head. The
// helper's mirror stands for the same thing in real use. Swift's commands unless told otherwise; `--fixture` is the made-up
// app, whose `xcodebuild test` the sandbox refuses, so it shows the second try.
async function phaseRunner() {
  const fixture = process.argv.includes('--fixture');
  const folder = fixture ? null : path.resolve(process.argv[3] ?? '');
  if (!fixture && (!process.argv[3] || !fs.existsSync(path.join(folder, '.git')))) throw new Error('Give the project folder, or --fixture');
  const paths = makeRoot();
  const report = {};
  process.env.WHEELHOUSE_HOME = path.join(paths.outer, 'wheelhouse');
  try {
    const made = path.join(paths.outer, 'made');
    let names = [];
    if (fixture) {
      fs.mkdirSync(made);
      const { scheme, container } = writeFixture(made, { outside: paths.outside, keychains: expand(KEYCHAINS) });
      process.argv.push('--test', `xcodebuild test -project ${container} -scheme ${scheme} -destination 'platform=macOS' -derivedDataPath .build/checks ${SWITCHES.join(' ')} CODE_SIGNING_ALLOWED=NO`);
      await git(paths.root, 'init', '-q', made);
      await git(made, 'add', '-A');
      await git(made, '-c', 'user.name=probe', '-c', 'user.email=probe@wheelhouse.invalid', 'commit', '-qm', 'The made-up app');
    } else {
      const text = fs.existsSync(path.join(folder, 'Package.swift')) ? fs.readFileSync(path.join(folder, 'Package.swift'), 'utf8') : '';
      const remote = await git(folder, 'remote', 'get-url', 'origin');
      names = [path.basename(folder), path.basename(remote.stdout.trim()).replace(/\.git$/, ''), ...[...text.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])];
    }
    const from = fixture ? made : folder;
    const source = path.join(paths.outer, 'source.git');
    const cloned = await git(paths.outer, 'clone', '-q', '--bare', '--no-hardlinks', from, source);
    if (cloned.code !== 0) throw new Error(`git clone: ${cloned.stderr.trim()}`);
    await git(source, 'remote', 'remove', 'origin');
    const commit = (await git(source, 'rev-parse', 'HEAD')).stdout.trim();
    const settings = {
      testCommand: option('test', 'swift test --disable-sandbox'),
      prepare: option('prepare', fixture ? null : 'swift package resolve --disable-sandbox'),
      minutes: Number(option('minutes', 20)),
      network: false,
    };
    const mask = maskerOf(names);
    const got = await runCheck({ project: 'project', commit, main: true, settings, source });
    report.result = got.result;
    report.minutes = got.minutes;
    report.summary = summaryOf(mask(got.tail).split('\n'));
    report.proofsBesideTheSecret = fs.readdirSync(paths.outside).filter((n) => n.startsWith('proof-'));
  } finally {
    await finish(paths, report);
  }
}

// The kernel's lines about what the profile refused, read as they come. Only the check's own processes, or a program a
// check uses, count: the system's daemons have sandboxes of their own and are refused things all day.
function watchRefusals(belongs) {
  const log = spawn('/usr/bin/log', ['stream', '--style', 'ndjson', '--predicate', 'process == "kernel" AND eventMessage CONTAINS "Sandbox:"'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const counts = new Map();
  let held = '';
  log.stdout.on('data', (chunk) => {
    const lines = (held + chunk).split('\n');
    held = lines.pop();
    for (const line of lines) {
      let message;
      try { message = JSON.parse(line).eventMessage; } catch { continue; }
      const m = /(?:(\d+) duplicate reports for )?Sandbox:\s+(.+?)\((\d+)\)\s+deny\(\d+\)\s+(\S+)\s*(.*)$/.exec(String(message));
      if (!m || !belongs(m[2], Number(m[3]))) continue;
      const key = `${m[4]} ${m[5]}`.trim();
      counts.set(key, (counts.get(key) ?? 0) + Number(m[1] ?? 1));
    }
  });
  return { counts, stop: () => log.kill() };
}

async function processTable() {
  const got = await run('/bin/ps', ['-axo', 'pid=,ppid=,etime=,command=']);
  return got.stdout.split('\n').map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)).filter(Boolean).map((m) => {
    const [mm, ss] = m[3].split(':').slice(-2).map(Number);
    const parts = m[3].split(/[-:]/).map(Number);
    return { pid: Number(m[1]), ppid: Number(m[2]), seconds: parts.length > 3 ? 86400 : (parts.length === 3 ? parts[0] * 3600 : 0) + mm * 60 + ss, command: m[4] };
  });
}

// A sample's call graph with the project's own code hidden: a frame from something built in the check folder shows as
// <project code>, so only what it was waiting in remains.
function cleanSample(text, mask, checkFolder) {
  const images = new Set();
  for (const line of text.split('\n')) {
    const image = line.includes(checkFolder) ? /-\s+0x[0-9a-f]+\s+\+?(.+?)\s+[(<]/.exec(line) : null;
    if (image) images.add(image[1]);
  }
  const start = text.indexOf('Call graph:');
  const end = text.indexOf('Binary Images:');
  const body = text.slice(start === -1 ? 0 : start, end === -1 ? undefined : end);
  const shown = body.split('\n').map((line) => {
    const frame = /^(.*?[+!:|\s])(\d+\s+)(.+?)\s+\(in ([^)]+)\)/.exec(line);
    if (frame && (images.has(frame[4]) || /\.swift:\d|<compiler-generated>/.test(line))) return `${frame[1]}${frame[2]}<project code>`;
    return line.replace(/ \+ \d+ \[0x[0-9a-f]+\]| \[0x[0-9a-f]+\]/g, '').replace(/(DispatchQueue_\d+: )(?!com\.apple)\S+/, '$1<a queue>');
  });
  return mask(shown.filter(Boolean).join('\n')).split('\n').slice(0, 220);
}

// What a hung check is waiting on: the runner as `phaseRunner` runs it, on the real profile, with the refusals read live.
async function phaseHang() {
  const folder = path.resolve(process.argv[3] ?? '');
  if (!process.argv[3] || !fs.existsSync(path.join(folder, '.git'))) throw new Error('Give the project folder');
  const paths = makeRoot();
  const report = {};
  process.env.WHEELHOUSE_HOME = path.join(paths.outer, 'wheelhouse');
  const roots = new Set();
  const seen = new Set();
  const TOOLS = new Set(['swift-test', 'swiftpm-testing-helper', 'xctest', 'swift-build', 'swift-package', 'sh']);
  const refusals = watchRefusals((name, pid) => seen.has(pid) || TOOLS.has(name));
  try {
    const text = fs.existsSync(path.join(folder, 'Package.swift')) ? fs.readFileSync(path.join(folder, 'Package.swift'), 'utf8') : '';
    const remote = await git(folder, 'remote', 'get-url', 'origin');
    const mask = maskerOf([path.basename(folder), path.basename(remote.stdout.trim()).replace(/\.git$/, ''), ...[...text.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])]);
    const source = path.join(paths.outer, 'source.git');
    const cloned = await git(paths.outer, 'clone', '-q', '--bare', '--no-hardlinks', folder, source);
    if (cloned.code !== 0) throw new Error(`git clone: ${cloned.stderr.trim()}`);
    await git(source, 'remote', 'remove', 'origin');
    const commit = (await git(source, 'rev-parse', 'HEAD')).stdout.trim();
    const settings = { testCommand: option('test', 'swift test --disable-sandbox'), prepare: option('prepare', 'swift package resolve --disable-sandbox'), minutes: Number(option('minutes', 15)), network: false };
    let finished = false;
    const checked = runCheck({ project: 'project', commit, main: true, settings, source, spawn: (...args) => { const child = spawn(...args); roots.add(child.pid); return child; } })
      .finally(() => { finished = true; });
    const after = Number(option('after', 120));
    const samples = [];
    const below = (table) => {
      const all = new Set(roots);
      for (let grew = true; grew;) {
        grew = false;
        for (const row of table) if (all.has(row.ppid) && !all.has(row.pid)) { all.add(row.pid); grew = true; }
      }
      return table.filter((row) => all.has(row.pid));
    };
    while (!finished) {
      await sleep(2000);
      const table = await processTable();
      const ours = below(table);
      for (const row of ours) seen.add(row.pid);
      if (!ours.some((row) => /xctest|swiftpm-testing-helper/.test(row.command) && row.seconds >= after)) continue;
      report.processes = ours.map((row) => ({ name: mask(path.basename(row.command.split(' ')[0])), seconds: row.seconds, parent: row.ppid, pid: row.pid }));
      for (const row of ours.filter((r) => !/^(?:\/usr\/bin\/sandbox-exec|\/bin\/sh)\b/.test(r.command))) {
        const file = path.join(paths.outer, `sample-${row.pid}.txt`);
        const got = await run('/usr/bin/sample', [String(row.pid), '5', '-mayDie', '-f', file], { timeoutMs: 60000 });
        samples.push({ process: mask(path.basename(row.command.split(' ')[0])), sampled: got.code === 0, said: got.code === 0 ? '' : mask(got.stderr.trim().slice(-200)), stacks: fs.existsSync(file) ? cleanSample(fs.readFileSync(file, 'utf8'), mask, paths.root) : [] });
      }
      report.sampledAfterSeconds = after;
      endCheck('project');
      break;
    }
    const got = await checked;
    await sleep(2500);
    report.result = got.result;
    report.minutes = got.minutes;
    report.summary = summaryOf(mask(got.tail).split('\n'));
    const places = new Map();
    for (const [what, count] of refusals.counts) {
      const place = mask(placeOf(what, paths.root));
      places.set(place, (places.get(place) ?? 0) + count);
    }
    report.refused = [...places.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
    report.samples = samples;
    report.proofsBesideTheSecret = fs.readdirSync(paths.outside).filter((n) => n.startsWith('proof-'));
  } finally {
    refusals.stop();
    await finish(paths, report);
  }
}

// The report goes to the screen and the check folder; the folder goes to the Trash unless --keep. Never deleted outright.
async function finish(paths, report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(path.join(paths.root, 'report.json'), text);
  process.stdout.write(text);
  if (process.argv.includes('--keep')) {
    process.stdout.write(`Kept: ${paths.outer.replace(REAL_HOME, '~')}\n`);
    return;
  }
  const got = await run('/usr/bin/trash', [paths.outer]);
  process.stdout.write(got.code === 0 ? 'The check folder went to the Trash.\n' : `The check folder stays at ${paths.outer.replace(REAL_HOME, '~')}: ${got.stderr.trim()}\n`);
}

const phases = { ways: phaseWays, fixture: phaseFixture, swift: phaseSwift, project: phaseProject, runner: phaseRunner, hang: phaseHang };
const phase = phases[process.argv[2]];
if (!phase) throw new Error('Give ways, fixture, swift, project, runner or hang');
await phase();
