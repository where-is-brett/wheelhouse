// scripts/hooks/node-floor.cjs
// What every hook in hooks/hooks.json is started through: `node node-floor.cjs <hook script>`.
// It checks this computer's Node.js against Wheelhouse's floor before the hook's own modules are
// loaded, so a Node.js that is too old gets a plain message rather than whatever error the hook's
// first newer call throws. At the floor or above, it hands over to the hook as though node had
// been started with the hook's path (process.argv[1], which startedAsScript reads), and does
// nothing else.
//
// Below the floor, what it does depends on the event (read from the hook's input):
//   PreToolUse    the message on stderr and exit code 2, so the tool call is refused with these
//                 words, as a guard that fails refuses it (onFailure block, check 35);
//   SessionStart  the message shown to the director (systemMessage) and given to the session
//                 (additionalContext), so the agent can say it in its own reply;
//   any other     nothing, exit code 0: every tool call is refused already.
//
// Before refusing, it looks for another Node.js on this computer, version 22 or later, in the places
// version managers and installers put one (nvm, Volta, fnm, asdf, mise, Homebrew, the Windows program
// folders). The PATH of a session can put an old one first even though a fitting one is installed. If
// it finds one, it runs this same check again under that Node.js, with the same arguments, input and
// environment, and exits with its exit code. The second run is marked in the environment
// (WHEELHOUSE_NODE_FLOOR_RERUN) and never searches again.
//
// A computer with no Node.js at all never reaches this file.
//
// Written as plain CommonJS with no newer syntax (var, function, no arrows or template strings),
// so that an old Node.js can read it.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var url = require('url');
var childProcess = require('child_process');

// Set on the second run, so that it never searches again.
var RERUN = 'WHEELHOUSE_NODE_FLOOR_RERUN';

// scripts/lib/setup-numbers.js NODE_FLOOR's major version; tests/scripts/hooks/node-floor.test.js
// keeps the two in step.
var FLOOR_MAJOR = 22;

function majorOf(version) {
  var major = parseInt(String(version).replace(/^v/, '').split('.')[0], 10);
  return isNaN(major) ? 0 : major;
}

// What to do, the same in both messages.
var REMEDY = 'Download the version marked LTS from https://nodejs.org and install it, then start a new conversation. ' +
  'Nothing else needs to change, and nothing has been lost.';

// The words the director and the session see. `version` is the Node.js found, such as "20.9.0".
function message(version) {
  return 'Wheelhouse needs a free program called Node.js, version ' + FLOOR_MAJOR + ' or later, and this computer has version ' +
    version + '. ' + REMEDY;
}

// The same for a computer with no Node.js at all.
function missingMessage() {
  return 'Wheelhouse needs a free program called Node.js, version ' + FLOOR_MAJOR + ' or later, and this computer doesn\'t have it. ' + REMEDY;
}

// What the hook writes for an event, below the floor: { stdout, stderr, code }.
function refusal(event, version) {
  var words = message(version);
  if (event === 'PreToolUse') return { stdout: '', stderr: words + '\n', code: 2 };
  if (event === 'SessionStart') {
    var context = 'Wheelhouse cannot run on this computer yet: its Node.js is version ' + version + ', and Wheelhouse needs ' +
      FLOOR_MAJOR + ' or later. Every tool call will be refused until it is installed. Tell the director, in these plain words, ' +
      'and do nothing else: "' + words + '"';
    return {
      stdout: JSON.stringify({ systemMessage: words, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }) + '\n',
      stderr: '',
      code: 0,
    };
  }
  return { stdout: '', stderr: '', code: 0 };
}

// The event named in the hook's input, or null when it can't be read.
function eventOf(text) {
  try {
    var input = JSON.parse(text);
    return input && typeof input.hook_event_name === 'string' ? input.hook_event_name : null;
  } catch (e) {
    return null;
  }
}

// Whether this Node.js may run the hooks.
function atFloor(version) {
  return majorOf(version) >= FLOOR_MAJOR;
}

// "v22.4.0" or "22.4.0" as [22, 4, 0], or null.
function partsOf(version) {
  var m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version).trim());
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

// Positive when a is the newer.
function compareParts(a, b) {
  for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Where an installed Node.js may be: [{ file, hint }], hint being the version the folder is named
// for (or null for a shim or a plain install, whose version has to be asked). Nothing is run here.
// `list(dir)` names a folder's entries; `system` (default: the fixed system places) is a list of files.
function candidates(options) {
  var env = options.env || {};
  var win = options.platform === 'win32';
  var home = options.home;
  var join = win ? path.win32.join : path.join;
  var list = options.list || function (dir) {
    try { return fs.readdirSync(dir); } catch (e) { return []; }
  };
  var exe = win ? 'node.exe' : 'node';
  var found = [];
  // Every folder under `base` whose name is a version, with `rest` below it.
  function versions(base, rest) {
    list(base).forEach(function (name) {
      var hint = partsOf(name);
      if (hint) found.push({ file: join.apply(null, [base, name].concat(rest)), hint: hint });
    });
  }
  function plain(file) {
    found.push({ file: file, hint: null });
  }
  if (win) {
    var roaming = env.APPDATA || (home ? join(home, 'AppData', 'Roaming') : '');
    var local = env.LOCALAPPDATA || (home ? join(home, 'AppData', 'Local') : '');
    var programs = env.ProgramFiles || 'C:\\Program Files';
    if (env.NVM_HOME) versions(env.NVM_HOME, [exe]);
    if (roaming) versions(join(roaming, 'nvm'), [exe]);
    plain(join(programs, 'nodejs', exe));
    if (local) plain(join(local, 'Programs', 'nodejs', exe));
    if (env.VOLTA_HOME) plain(join(env.VOLTA_HOME, 'bin', exe));
    if (local) plain(join(local, 'Volta', 'bin', exe));
    if (env.FNM_DIR) versions(join(env.FNM_DIR, 'node-versions'), ['installation', exe]);
    if (local) versions(join(local, 'fnm', 'node-versions'), ['installation', exe]);
    if (roaming) versions(join(roaming, 'fnm', 'node-versions'), ['installation', exe]);
    return found;
  }
  if (home) {
    versions(join(env.NVM_DIR || join(home, '.nvm'), 'versions', 'node'), ['bin', exe]);
    plain(join(env.VOLTA_HOME || join(home, '.volta'), 'bin', exe));
    [env.FNM_DIR, join(home, '.local', 'share', 'fnm'), join(home, 'Library', 'Application Support', 'fnm'), join(home, '.fnm')]
      .forEach(function (dir) { if (dir) versions(join(dir, 'node-versions'), ['installation', 'bin', exe]); });
    var asdf = env.ASDF_DATA_DIR || join(home, '.asdf');
    versions(join(asdf, 'installs', 'nodejs'), ['bin', exe]);
    plain(join(asdf, 'shims', exe));
    var mise = env.MISE_DATA_DIR || join(home, '.local', 'share', 'mise');
    versions(join(mise, 'installs', 'node'), ['bin', exe]);
    plain(join(mise, 'shims', exe));
  }
  (options.system || ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', '/home/linuxbrew/.linuxbrew/bin/node']).forEach(plain);
  return found;
}

// The version a node file reports, as [major, minor, patch], or null when it won't say.
function askVersion(file) {
  try {
    var ran = childProcess.spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
    return ran.status === 0 ? partsOf(ran.stdout) : null;
  } catch (e) {
    return null;
  }
}

// The newest installed Node.js at the floor or above, as the path of its executable, or null.
// Folders named for a version below the floor are not run.
function findFittingNode(options) {
  var opts = options || {};
  var all = candidates({
    env: opts.env || process.env,
    platform: opts.platform || process.platform,
    home: opts.home || os.homedir(),
    list: opts.list,
    system: opts.system,
  });
  var best = null;
  var seen = {};
  all.forEach(function (c) {
    if (seen[c.file]) return;
    seen[c.file] = true;
    if (c.hint && c.hint[0] < FLOOR_MAJOR) return;
    if (best && c.hint && compareParts(c.hint, best.parts) < 0) return;
    if (!fs.existsSync(c.file)) return;
    var parts = askVersion(c.file);
    if (!parts || parts[0] < FLOOR_MAJOR) return;
    if (!best || compareParts(parts, best.parts) > 0) best = { file: c.file, parts: parts };
  });
  return best ? best.file : null;
}

// Runs this check again under `file`, with this one's arguments, input, environment and exit code.
// Returns false when it could not be started, so the caller refuses as before.
function rerunWith(file) {
  var env = {};
  Object.keys(process.env).forEach(function (key) { env[key] = process.env[key]; });
  env[RERUN] = '1';
  var ran = childProcess.spawnSync(file, [__filename].concat(process.argv.slice(2)), { stdio: 'inherit', env: env, windowsHide: true });
  if (ran.error) return false;
  process.exitCode = typeof ran.status === 'number' ? ran.status : 1;
  return true;
}

function main() {
  var target = process.argv[2];
  if (typeof target !== 'string' || target === '') {
    process.stderr.write('node-floor.cjs: no hook script named\n');
    process.exitCode = 1;
    return;
  }
  var version = process.versions.node;
  if (atFloor(version)) {
    process.argv.splice(1, 1);
    // A hook that fails to load fails as it would started directly: the rejection is reported and
    // node exits non-zero, which a guard's onFailure block turns into a refusal.
    import(url.pathToFileURL(target).href).catch(function (error) {
      process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
      process.exitCode = 1;
    });
    return;
  }
  if (!process.env[RERUN]) {
    var fitting = findFittingNode();
    if (fitting && rerunWith(fitting)) return;
  }
  var input = '';
  try {
    input = fs.readFileSync(0, 'utf8');
  } catch (e) {
    input = '';
  }
  var out = refusal(eventOf(input), version);
  if (out.stdout) process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  process.exitCode = out.code;
}

module.exports = { FLOOR_MAJOR: FLOOR_MAJOR, atFloor: atFloor, message: message, missingMessage: missingMessage, refusal: refusal, eventOf: eventOf,
  candidates: candidates, findFittingNode: findFittingNode };

if (require.main === module) main();
