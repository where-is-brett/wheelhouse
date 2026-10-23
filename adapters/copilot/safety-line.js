// adapters/copilot/safety-line.js
// What Copilot can't enforce, in plain sentences, for the board's health line, the full board view and the
// data note (design section 6.6). Each line is the design's own words cut to one line, and none ends in a full
// stop. It imports only the design's numbers, so the board can read it without loading the adapter.
import { GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, LEVELS, TIERS } from '../../scripts/lib/copilot-numbers.js';

// Copilot lets through a guard that runs past its time-out (check 58), which is why a guard answers sooner.
const TIME_OUT = `Copilot lets a guard through if it runs past ${GUARD_TIMEOUT_SEC} seconds, so every guard answers within ${GUARD_DEADLINE_MS / 1000} seconds or refuses`;
const RULES_NOT_FENCE = `Copilot's permission rules are rules, not a fence; a guard that runs past ${GUARD_TIMEOUT_SEC} seconds is let through, so every guard answers within ${GUARD_DEADLINE_MS / 1000} seconds or refuses`;

// Section 6.6, item 1, by level: what holds on the computer without Copilot's sandbox.
const WITHOUT_SANDBOX = {
  guarded: 'Without Copilot\'s sandbox, at Guarded the network is open and only labelled folders are unreadable to builds',
  ask: 'Without Copilot\'s sandbox, at Ask a command you allowed can do whatever your account can, and leave lasting changes',
  unattended: 'Without Copilot\'s sandbox, at Unattended nothing holds on this computer',
};

// Section 6.6, item 6, by system.
function networkLine(platform) {
  if (platform === 'darwin') return 'The network is narrowed only by Copilot\'s sandbox, and listed hosts could still carry code out';
  if (platform === 'win32') return 'On Windows nothing on this computer holds the network against a program that connects directly';
  return 'Nothing on this computer holds the network against a program that connects directly';
}

// What Lean says of Wheelhouse's guards: with Node.js they run as Copilot hooks (design section 6.4); without
// it, on the Mac a shell guard can run once the kit holds one (check 69), and on Windows none is known yet.
function leanGuards({ node, platform, shellGuard }) {
  if (node) return { line: null, running: true };
  if (platform === 'darwin') {
    return shellGuard
      ? { line: 'Wheelhouse\'s shell guard runs on this Mac, and refuses a command it can\'t check', running: true }
      : { line: 'No Wheelhouse guards run on this computer yet', running: false };
  }
  if (platform === 'win32') return { line: 'No Wheelhouse guards run on Windows without Node.js, until a way is found', running: false };
  return { line: 'No Wheelhouse guards run on this computer without Node.js', running: false };
}

function lean(options) {
  const { node, addOn } = options;
  const guards = leanGuards(options);
  const lines = ['Nothing is held off this computer except the copy in your folder'];
  lines.push(node || addOn
    ? 'Everyday approvals are clicks in the chat; the steps that matter most are confirmed outside it'
    : 'Approvals are clicks in the chat, recorded as not proven');
  if (node) lines.push('STOP is enforced by Wheelhouse\'s guards, which run as Copilot hooks');
  else if (addOn) lines.push('STOP is enforced by the add-on, which also cancels the chat\'s running request');
  else lines.push('STOP isn\'t enforced: agents are told to stop, and VS Code\'s stop button ends the running request');
  if (guards.line !== null) lines.push(guards.line);
  if (guards.running) lines.push(TIME_OUT);
  lines.push(
    'A command you allow can change anything Wheelhouse keeps, history and record included',
    'Copilot\'s command prompts aren\'t a control',
    'Tests and second looks at a change aren\'t independent of the agent that built it',
    'Not for projects with real users',
  );
  return lines;
}

// One line for each item of section 6.6 that applies to the level and the system.
function upper({ level, sandbox, platform, phoneStop }) {
  const sandboxOn = level === 'sandbox' || sandbox === true;
  return [
    ...(sandboxOn ? [] : [WITHOUT_SANDBOX[level]]),
    'Your sign-ins and Wheelhouse\'s keys stay on this computer, and the code host\'s controls hold only while no agent reaches them',
    'The approval check, the second looks at changes and the activity record run on this computer, and hold only while build commands can\'t reach your level',
    RULES_NOT_FENCE,
    'At Standard, Wheelhouse\'s hooks run beside the agent, so no hook holds a secret an agent can\'t read',
    networkLine(platform),
    'You can lower the level, or switch the sandbox off, unless Locked or your company\'s settings hold it',
    ...(phoneStop === true ? [] : ['Phone STOP isn\'t available until a way is found']),
    'Wheelhouse can\'t pin VS Code or its Copilot runtime; it records them and runs its safety checks again when they change',
    'Your company\'s own settings win over Wheelhouse\'s, Locked included, and can stop its hooks loading or Copilot\'s command-line agent running',
  ];
}

// The board's line while Copilot has a tool Wheelhouse doesn't know (ruling P5-19, Review Focus 1): such a tool
// is refused, so a Copilot update is waiting on Wheelhouse.
export function updateWaiting(name) {
  return `Copilot has a tool Wheelhouse doesn't know yet, \`${name}\`: it is refused until Wheelhouse is updated`;
}

// safetyLine({ tier, level, platform, node, addOn, sandbox, shellGuard, phoneStop }) -> string[]
//   tier        'lean' (the default), 'middle' or 'full'
//   level       at Middle and Full, the level builds run at: 'sandbox', 'guarded', 'ask' or 'unattended' (default 'ask')
//   platform    the system, as process.platform names it
//   node        whether Wheelhouse's own Node.js program may run here
//   addOn       whether the VS Code add-on is installed
//   sandbox     whether Copilot's sandbox is in use, at a level that is not 'sandbox' itself
//   shellGuard  whether the kit holds the Mac's shell guard (check 69; false until the kit is built with it)
//   phoneStop   whether a route to STOP from the phone exists (check 12 finds none yet)
export default function safetyLine({ tier = 'lean', level, platform = process.platform, node = false, addOn = false, sandbox, shellGuard = false, phoneStop = false } = {}) {
  if (!TIERS.includes(tier)) throw new Error(`${JSON.stringify(tier)} is not a tier; the tiers are ${TIERS.join(', ')}`);
  if (level !== undefined && !LEVELS.includes(level)) throw new Error(`${JSON.stringify(level)} is not a level; the levels are ${LEVELS.join(', ')}`);
  if (tier === 'lean') return lean({ node: node === true, addOn: addOn === true, platform, shellGuard: shellGuard === true });
  return upper({ level: level ?? 'ask', sandbox, platform, phoneStop });
}
