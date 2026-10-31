// tests/scripts/checks/profile.test.js
// The check's sandbox as text on any system, and as a real sandbox on the Mac.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkProfile, CHECK_SERVICES } from '../../../scripts/checks/profile.js';
import { ENGINE_ROOM_PORT } from '../../../scripts/protection/archon.js';
import { sandboxDenyPaths } from '../../../scripts/protection/settings.js';
import { tempFolder } from '../../helpers/homes.js';

const mac = { skip: process.platform !== 'darwin' };
const USER = '/Users/someone';
const ROOT = `${USER}/.wheelhouse/engine/checks/p`;
const paths = (root = ROOT) => ({ root, tree: `${root}/tree`, gitDir: `${root}/tree.git`, home: `${root}/home`, mainHome: `${root}/main-home` });
const DENIED = [`${USER}/.wheelhouse`, `${USER}/Library/Keychains`, `${USER}/.ssh`];
const TEMP = ['/private/tmp', '/private/var/tmp'];
const profile = (extra = {}) => checkProfile({ paths: paths(), main: false, stage: 'test', network: false, denied: DENIED, temp: TEMP, userHome: USER, ...extra });
// The rules of `text` for one operation, one rule to a line.
const rules = (text, start) => text.split('\n').filter((l) => l.startsWith(start));

test('the profile starts from deny-by-default and never allows by default', () => {
  const text = profile();
  assert.ok(text.startsWith('(version 1)\n(deny default'));
  assert.doesNotMatch(text, /\(allow default\)/);
});

test('the profile denies each deny-list path', () => {
  const denies = rules(profile(), '(deny file-read*').join('\n');
  for (const p of DENIED) assert.ok(denies.includes(`(subpath "${p}")`), p);
});

test('nothing that starts work outside the sandbox is allowed', () => {
  for (const stage of ['test', 'prepare']) {
    const text = profile({ stage });
    for (const operation of ['appleevent-send', 'lsopen', 'job-creation', 'mach-register', 'mach-bootstrap']) assert.doesNotMatch(text, new RegExp(`\\(allow ${operation}`), operation);
    assert.doesNotMatch(text, /(?:launchservicesd|sharedfilelistd|pasteboard|SecurityServer|securityd|coreservices\.launch|launchd)"/);
    assert.doesNotMatch(text, /\(allow process-info\*\)/);
    assert.doesNotMatch(text, /\(allow signal\)/);
  }
});

test('the system services are named one by one', () => {
  assert.ok(CHECK_SERVICES.length > 0);
  for (const name of CHECK_SERVICES) assert.match(name, /^com\.apple\.[A-Za-z0-9._@-]+$/);
  assert.doesNotMatch(profile(), /\(allow mach-lookup\)/);
});

test('the services that start programs, or name the per-user folders, are left out', () => {
  for (const name of ['com.apple.bsd.dirhelper', 'com.apple.testmanagerd.control', 'com.apple.coreservices.launchservicesd']) assert.ok(!CHECK_SERVICES.includes(name), name);
});

test('only the tests have the map of file types, and never the service that writes it', () => {
  const service = /"com\.apple\.lsd\.mapdb"/;
  assert.match(profile({ stage: 'test' }), service);
  assert.doesNotMatch(profile({ stage: 'prepare' }), service);
  for (const stage of ['test', 'prepare']) assert.doesNotMatch(profile({ stage }), /lsd\.modifydb/);
});

test('only the tests have the services a media or free-space call waits on', () => {
  for (const name of ['com.apple.audio.AudioComponentRegistrar', 'com.apple.cache_delete.public', 'com.apple.PerfPowerTelemetryClientRegistrationService']) {
    assert.ok(profile({ stage: 'test' }).includes(`"${name}"`), name);
    assert.ok(!profile({ stage: 'prepare' }).includes(`"${name}"`), name);
  }
  assert.doesNotMatch(profile({ stage: 'test' }), /"com\.apple\.cache_delete"/);
});

test('a head writes its own folders and never main-home', () => {
  const writes = rules(profile(), '(allow file-write*').join('\n');
  assert.ok(writes.includes(`(subpath "${paths().tree}")`));
  assert.ok(writes.includes(`(subpath "${paths().home}")`));
  assert.ok(!writes.includes('main-home'));
});

test('a main-line check writes main-home and not a head\'s home', () => {
  const writes = rules(profile({ main: true }), '(allow file-write*').join('\n');
  assert.ok(writes.includes(`(subpath "${paths().mainHome}")`));
  assert.ok(!writes.includes(`(subpath "${paths().home}")`));
});

test('the git folder is readable and never writable', () => {
  const text = profile();
  assert.ok(rules(text, '(allow file-read*').join('\n').includes(`(subpath "${paths().gitDir}")`));
  assert.ok(!rules(text, '(allow file-write*').join('\n').includes('tree.git'));
});

test('only the temporary folders named are writable, and the per-user ones are not', () => {
  const writes = rules(profile(), '(allow file-write*').join('\n');
  assert.ok(writes.includes('"/private/tmp"'));
  assert.ok(!writes.includes('/var/folders'));
});

test('only prepare has the network unless checks.network', () => {
  const open = /\(allow network-outbound \(remote ip "\*:\*"\)\)/;
  assert.doesNotMatch(profile({ stage: 'test' }), open);
  assert.match(profile({ stage: 'prepare' }), open);
  assert.match(profile({ stage: 'test', network: true }), open);
});

test('a test still reaches this computer\'s own ports', () => {
  assert.match(profile(), /\(allow network-outbound \(remote ip "localhost:\*"\)\)/);
  assert.match(profile(), /\(allow network-bind \(local ip "localhost:\*"\)\)/);
});

test('sockets are reached only inside the check\'s own folders', () => {
  for (const stage of ['test', 'prepare']) {
    const text = profile({ stage });
    assert.doesNotMatch(text, /\(remote unix-socket\)/);
    const sockets = rules(text, '(allow network-outbound (remote unix-socket').join('\n');
    assert.ok(sockets.includes(paths().tree));
    assert.ok(!sockets.includes(`${USER}/.ssh`));
  }
});

test('each stage denies the home folder, then opens only the tools kept there and never a deny-list path', () => {
  for (const stage of ['test', 'prepare']) {
    const text = profile({ stage });
    const lines = text.split('\n');
    const home = lines.indexOf(`(deny file-read* (subpath "${USER}"))`);
    const tools = lines.findIndex((l) => l.startsWith('(allow file-read*') && l.includes(`"${USER}/.nvm"`));
    const again = lines.findLastIndex((l) => l.startsWith('(deny file-read*') && l.includes(`"${USER}/.ssh"`));
    assert.ok(home > -1 && home < tools && tools < again, stage);
    assert.doesNotMatch(text, /"[^"]*\/\.cargo"/);
    for (const dir of paths().root.split('/').slice(1).map((_, i, all) => `/${all.slice(0, i + 1).join('/')}`)) assert.match(text, new RegExp(`\\(allow file-read-metadata .*\\(literal "${dir.replaceAll('.', '\\.')}"\\)`), dir);
  }
});

test('the folders above a check folder under a denied folder can be looked at, not listed', () => {
  const text = profile();
  assert.ok(rules(text, '(allow file-read-metadata').join('\n').includes(`(literal "${USER}/.wheelhouse")`));
  assert.ok(!rules(text, '(allow file-read* ').join('\n').includes(`(literal "${USER}/.wheelhouse")`));
});

test('a folder name with a quote doesn\'t break the profile', () => {
  const text = checkProfile({ paths: paths('/Users/a"b\\c/checks/p'), main: false, stage: 'test', network: false, denied: ['/Users/a"b\\c/.ssh'], temp: TEMP, userHome: '/Users/a"b\\c' });
  assert.ok(text.includes('(subpath "/Users/a\\"b\\\\c/.ssh")'));
  assert.doesNotMatch(text, /[^\\]"b/);
});

test('a new line in a folder name is refused', () => {
  assert.throws(() => profile({ denied: ['/Users/a\nb'] }), /new line/);
});

test('sandboxDenyPaths names the private record, the keychain, the keys and the engine\'s private files', { skip: process.platform === 'win32' }, () => {
  const list = sandboxDenyPaths({ userHome: USER, platform: 'darwin' });
  assert.ok(list.some((p) => p === process.env.WHEELHOUSE_HOME || p === `${USER}/.wheelhouse`));
  for (const p of [`${USER}/Library/Keychains`, `${USER}/.ssh`, `${USER}/.aws`]) assert.ok(list.includes(p), p);
  assert.ok(list.some((p) => p.endsWith('credential-key')));
  assert.ok(list.every((p) => path.isAbsolute(p)));
});

// --- on the Mac: a real sandbox ---

function world() {
  const base = fs.realpathSync(tempFolder('wh-profile-'));
  const outer = path.join(base, 'outer');
  const root = path.join(outer, 'engine', 'checks', 'p');
  const p = paths(root);
  for (const dir of [p.tree, p.gitDir, p.home, p.mainHome]) fs.mkdirSync(dir, { recursive: true });
  const secret = path.join(outer, 'secret.txt');
  fs.writeFileSync(secret, 'the secret');
  return { base, outer, p, secret };
}
function sandboxed({ outer, p, base }, command, extra = {}) {
  const text = checkProfile({ paths: p, main: false, stage: 'test', network: false, denied: [outer], temp: TEMP, userHome: base, ...extra });
  return spawnSync('/usr/bin/sandbox-exec', ['-p', text, '/bin/sh', '-c', command], { cwd: p.tree, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: p.home } });
}

test('the profile loads and a command runs inside it', mac, () => {
  const got = sandboxed(world(), 'pwd');
  assert.equal(got.status, 0, got.stderr);
});

test('a denied file can\'t be read, and its folder can\'t be listed', mac, () => {
  const w = world();
  assert.notEqual(sandboxed(w, `cat '${w.secret}'`).status, 0);
  assert.notEqual(sandboxed(w, `ls '${w.outer}'`).status, 0);
});

test('a test can write in its tree and its home, and nowhere else', mac, () => {
  const w = world();
  assert.equal(sandboxed(w, `echo x > '${w.p.tree}/a' && echo x > '${w.p.home}/a'`).status, 0);
  assert.notEqual(sandboxed(w, `echo x > '${w.outer}/a'`).status, 0);
  assert.notEqual(sandboxed(w, `echo x > '${w.p.mainHome}/a'`).status, 0);
  assert.notEqual(sandboxed(w, `echo x > '${os.homedir()}/wheelhouse-check-test'`).status, 0);
});

test('a head\'s sandbox can\'t write a main-line check\'s tree, and one main-line check\'s can\'t write the next one\'s', mac, () => {
  const w = world();
  const next = path.join(w.p.root, 'main', 'next', 'tree');
  fs.mkdirSync(next, { recursive: true });
  assert.notEqual(sandboxed(w, `echo x > '${next}/a'`).status, 0);
  const earlier = { ...w.p, tree: path.join(w.p.root, 'main', 'earlier', 'tree') };
  fs.mkdirSync(earlier.tree, { recursive: true });
  const text = checkProfile({ paths: earlier, main: true, stage: 'test', network: false, denied: [w.outer], temp: TEMP, userHome: w.base });
  const got = spawnSync('/usr/bin/sandbox-exec', ['-p', text, '/bin/sh', '-c', `echo x > '${earlier.tree}/a' && echo x > '${next}/a'`], { cwd: earlier.tree, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: w.p.mainHome } });
  assert.notEqual(got.status, 0);
  assert.equal(fs.existsSync(path.join(earlier.tree, 'a')), true);
  assert.equal(fs.existsSync(path.join(next, 'a')), false);
});

test('a test can\'t swap its tree or its home for a link, and can still work inside them', mac, () => {
  const w = world();
  for (const folder of [w.p.tree, w.p.home]) {
    assert.notEqual(sandboxed(w, `cd / && rm -rf '${folder}' && ln -s '${w.outer}' '${folder}'`).status, 0);
    assert.equal(fs.lstatSync(folder).isDirectory(), true, folder);
    assert.equal(sandboxed(w, `mkdir '${folder}/d' && echo x > '${folder}/d/a' && rm -r '${folder}/d'`).status, 0);
  }
});

test('a test can\'t read the home folder, but can read a tool kept there', mac, () => {
  const w = world();
  fs.writeFileSync(path.join(w.base, 'notes.txt'), 'private');
  fs.mkdirSync(path.join(w.base, '.nvm'));
  fs.writeFileSync(path.join(w.base, '.nvm', 'node'), 'a tool');
  for (const stage of ['test', 'prepare']) {
    assert.notEqual(sandboxed(w, `cat '${w.base}/notes.txt'`, { stage }).status, 0, stage);
    assert.equal(sandboxed(w, `cat '${w.base}/.nvm/node'`, { stage }).status, 0, stage);
  }
});

test('the engine room\'s port is refused last, whatever the stage or the network', () => {
  for (const options of [{ stage: 'test' }, { stage: 'test', network: true }, { stage: 'prepare' }]) {
    const lines = profile(options).split('\n').filter((l) => /network-outbound/.test(l));
    assert.equal(lines.at(-1), `(deny network-outbound (remote ip "*:${ENGINE_ROOM_PORT}"))`);
  }
});

test('a test reaches a local port, but not the engine room\'s', mac, async (t) => {
  const open = (port) => new Promise((resolve) => {
    const server = net.createServer((socket) => { socket.on('error', () => {}); socket.end(); });
    server.once('error', () => resolve(null));
    server.listen(port, '::', () => resolve(server));
  });
  const engine = await open(ENGINE_ROOM_PORT);
  if (engine === null) { t.skip('the port is in use here'); return; }
  const other = await open(0);
  t.after(() => { engine.close(); other.close(); });
  const w = world();
  for (const options of [{ stage: 'test' }, { stage: 'test', network: true }, { stage: 'prepare' }]) {
    const knock = (port, host) => sandboxed(w, `/usr/bin/nc -z -w 2 ${host} ${port}`, options).status;
    assert.equal(knock(other.address().port, '127.0.0.1'), 0);
    for (const host of ['127.0.0.1', 'localhost', '::1']) assert.notEqual(knock(ENGINE_ROOM_PORT, host), 0, host);
  }
});

test('a test can\'t write tree.git', mac, () => {
  const w = world();
  fs.mkdirSync(path.join(w.p.gitDir, 'hooks'));
  assert.notEqual(sandboxed(w, `echo x > '${w.p.gitDir}/hooks/post-checkout'`).status, 0);
  assert.equal(sandboxed(w, `ls '${w.p.gitDir}'`).status, 0);
});

test('the per-user temporary folder can\'t be written, so nothing trusted there is planted', mac, () => {
  const w = world();
  const folder = spawnSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).stdout.trim();
  assert.notEqual(sandboxed(w, `echo x > '${folder}wheelhouse-check-test'`).status, 0);
});

test('the keychain and ~/.wheelhouse can\'t be read', mac, () => {
  const user = os.homedir();
  const w = world();
  const denied = sandboxDenyPaths({ userHome: user, platform: 'darwin' }).concat(w.outer, path.join(user, '.wheelhouse'));
  const keychains = path.join(user, 'Library', 'Keychains');
  assert.notEqual(sandboxed(w, `ls '${keychains}'`, { denied }).status, 0);
  assert.notEqual(sandboxed(w, `ls '${path.join(user, '.wheelhouse')}'`, { denied }).status, 0);
});

test('curl is stopped', mac, () => {
  const got = sandboxed(world(), 'curl -sS -m 5 -o /dev/null https://example.com');
  assert.notEqual(got.status, 0);
});

test('open, osascript and launchctl get nowhere', mac, () => {
  const w = world();
  const proof = path.join(w.outer, 'proof');
  const job = path.join(w.p.tree, 'job.sh');
  fs.writeFileSync(job, `#!/bin/sh\ncat '${w.secret}' > '${proof}'\n`, { mode: 0o755 });
  assert.notEqual(sandboxed(w, '/usr/bin/osascript -e \'tell application "Finder" to get name of startup disk\'').status, 0);
  assert.notEqual(sandboxed(w, `/usr/bin/open -g '${job}'`).status, 0);
  assert.notEqual(sandboxed(w, `/bin/launchctl submit -l invalid.wheelhouse.profile-test -- /bin/sh '${job}'`).status, 0);
  assert.equal(fs.existsSync(proof), false);
});
