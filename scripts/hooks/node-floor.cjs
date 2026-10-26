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
// A computer with no Node.js at all never reaches this file; the mod says so instead
// (hooks/mod/ask.ts, NODE_MISSING).
//
// Written as plain CommonJS with no newer syntax, so that an old Node.js can read it.
'use strict';

var fs = require('fs');
var url = require('url');

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

// The same for a computer with no Node.js at all, which the mod shows (hooks/mod/numbers.ts
// NODE_MISSING holds these words).
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

module.exports = { FLOOR_MAJOR: FLOOR_MAJOR, atFloor: atFloor, message: message, missingMessage: missingMessage, refusal: refusal, eventOf: eventOf };

if (require.main === module) main();
