// scripts/lib/calm-words.js
// The Calm interface's set words, named once: the labels, notes and lines the pane and the cards
// say the same way everywhere (design sections 23.2, 23.3, 23.7 and 23.8). Each is one line of
// British English. Times are given as 24-hour "hh:mm" text and said as given.

// The button that hands the director's own words to the front desk. It is never an answer.
export const SUGGEST = 'Suggest a change…';
// The button that opens a card's reason in place, and the one that closes it again.
export const WHY = 'Why?';
export const HIDE_WHY = 'Hide why';
// The button that shows what a change looks like before it is decided.
export const SHOW_ME = 'Show me';
// The button that leaves a card waiting.
export const NOT_NOW = 'Not now';
// A parked pull request's card (delegated decisions design, section 8.1): its work goes back to be reworked, signed as Approve is.
export const SEND_BACK = 'Send it back';
// The line that tells the director more is there for the asking.
export const TO_KNOW_MORE = 'To know more, just ask.';
// The line that stands in for it on a question that has four options of its own, where there is no
// room for Suggest a change… and a change goes in the typed answer.
export const TO_CHANGE_IT = 'To change it, type what you\'d change.';
// What a revised card says first about how it differs from the card it replaces, then the sentence.
export const WHAT_CHANGED = 'What changed:';
// What Suggest a change… does, said under its button.
export const SUGGEST_SAYS = 'Tell me what you\'d change; I\'ll come back with a new proposal.';
// The prompt shown when the director has chosen to suggest a change.
export const WHAT_WOULD_YOU_CHANGE = 'What would you change?';
// The note shown once the director's words have been handed to the front desk.
export const SENT_TO_FRONT_DESK = 'Sent to the First Mate. A new proposal will follow.';
// The note for a suggestion made at a time: a new proposal is coming and nothing goes live meanwhile.
export const suggestedAt = (hhmm) => `You suggested a change at ${hhmm}. A new proposal is on its way, and nothing goes live meanwhile.`;
// The note for a suggestion typed in the chat, naming the card it is about.
export const typeYourChange = (n) => `Type your change in the chat, and I'll know it's about card ${n}.`;
// The note shown while a press is being written down.
export const RECORDING = 'Recording…';
// The note shown when a suggestion could not be handed to the front desk.
export const NOT_HANDED = 'That didn\'t reach the First Mate. Type it in the chat instead.';
// The note shown when a press could not be written down at all.
export const NOT_RECORDED = 'That wasn\'t recorded. Try again, or type it in the chat.';
// The note shown in place of the pane while setup is still running.
export const SETTING_UP = 'Setup is still running. This pane opens when it finishes.';
// The note shown in a chat that is not the front desk's.
export const NOT_HERE = 'This pane lives in the First Mate\'s chat. Type /wheelhouse there.';
// The note shown when a setting is changed while STOP is on.
export const SETTINGS_UNDER_STOP = 'Settings can\'t change while All stop is on. Lift All stop first.';
// The line shown when the latest state could not be read: when it failed and which reading is shown.
export const staleLine = (failedAt, shownAt) => `Couldn't read the latest at ${failedAt}. Showing ${shownAt}'s.`;
// The verdict when no card is waiting, and the note shown when a card was replaced under the director.
export const NOTHING_NEEDS_YOU = 'Nothing needs you.';
export const CHANGED_WHILE_READING = 'That card changed while you were reading. Here is the new one.';
// What STOP does, and who can undo it.
export const STOP_HALTS = 'Halts the whole Crew at once.';
export const ONLY_YOU_LIFT = 'Only you can lift it.';

const NUMBER_WORDS = ['Nothing', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
// The pane's one-line verdict: how many things need the director and how many are broken. A number
// opening a sentence is a word up to nine and a figure from ten; after the first word it is a figure.
export function verdict({ waiting, broken }) {
  const needs = waiting === 0 ? NOTHING_NEEDS_YOU
    : `${waiting < 10 ? NUMBER_WORDS[waiting] : waiting} ${waiting === 1 ? 'thing needs' : 'things need'} you.`;
  const state = broken === 0 ? 'Nothing is broken.' : broken === 1 ? 'One thing is broken.' : `${broken} things are broken.`;
  return `${needs} ${state}`;
}
// The line shown when the director returns, naming when they were last here.
export const sinceLine = (hhmm) => `Since you were last here at ${hhmm}.`;

// The note shown when Suggest a change… is sent with nothing written in it.
export const WRITE_FIRST = 'Write what you\'d change first';
// The note shown when Undo is pressed for a setting with no change to undo.
export const NOTHING_TO_UNDO = 'There\'s nothing to undo now';
// The note shown when Undo is pressed after its minute has passed.
export const TOO_LATE_TO_UNDO = 'It\'s too late to undo that. Undo lasts one minute.';
// What Undo is offered as, said after a setting's pick that can be undone.
export const UNDO_IN_PANE = 'Undo in the pane for a minute.';
// How long ago a card was asked: "asked just now", "asked 2 hours ago".
export const ASKED_JUST_NOW = 'asked just now';
export const askedAgo = (n, unit) => `asked ${n} ${unit}${n === 1 ? '' : 's'} ago`;
// How long ago a card was asked, from the time it was made to `now` (a Date or milliseconds):
// "asked 2 hours ago"; null when either can't be read or the card is from after now.
export function askedSince(at, now) {
  const then = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (Number.isNaN(then) || typeof nowMs !== 'number' || Number.isNaN(nowMs) || then > nowMs) return null;
  const minutes = Math.floor((nowMs - then) / 60000);
  if (minutes < 1) return ASKED_JUST_NOW;
  if (minutes < 60) return askedAgo(minutes, 'minute');
  if (minutes < 60 * 24) return askedAgo(Math.floor(minutes / 60), 'hour');
  return askedAgo(Math.floor(minutes / (60 * 24)), 'day');
}

// What the pane and the board say of a piece of work the director sees only when it is done, or
// before it merges, and the heading of the column that says it.
export const SEE_BEFORE_MERGE = 'Before it merges';
export const SEE_IN_BRIEFING = 'In your briefing when it is done';
export const YOULL_SEE_IT = 'You\'ll see it';
// The board's note under its rulings, and the briefing's and the board's closing lines.
export const RULINGS_NOTE = 'For a glance, not a decision. Disagree? Say so and it becomes a question for you.';
export const ASK_ME_ANYTHING = 'Ask me anything.';
export const FULL_BOARD = 'For the full Logbook, type /wheelhouse:logbook.';
export const USAGE_ON_TRACK = 'On track.';
// The line that points the director to the board when a briefing is cut to nothing else.
export const ASK_FOR_THE_BOARD = 'Ask for the Logbook.';
// The mark on a card that can wait, with the minutes it takes.
export const optionalMark = (minutes) => `optional · ${minutes} min`;
// The front desk's recommendation on a card ("Approve, because the checks passed.").
export const recommends = (recommendation) => `I recommend ${recommendation}`;
// What the board says of the changes the director need not see.
export const behindTheScenes = (n) => `Plus ${n} ${n === 1 ? 'change' : 'changes'} behind the scenes you don't need to see.`;
// "Since 09:10, about 5 hours": when the director was last briefed and how long ago that was.
export function sinceAbout(hhmm, ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  let about;
  if (minutes < 2) about = 'about a minute';
  else if (minutes < 60) about = `about ${minutes} minutes`;
  else if (minutes < 60 * 2) about = 'about an hour';
  else if (minutes < 60 * 48) about = `about ${Math.round(minutes / 60)} hours`;
  else about = `about ${Math.round(minutes / (60 * 24))} days`;
  return `Since ${hhmm}, ${about}`;
}
// A count that opens a sentence is a word up to nine and a figure from ten.
export const startCount = (n) => (n < 10 ? NUMBER_WORDS[n] : String(n));
// The build view's one-sentence headline: how much is being built and how much waits to join.
export function buildHeadline({ building, joining }) {
  const first = building === 0 ? 'Nothing is being built' : `${startCount(building)} ${building === 1 ? 'feature is' : 'features are'} being built`;
  const second = joining === 0 ? 'no change is waiting to join' : `${joining} ${joining === 1 ? 'change is' : 'changes are'} waiting to join`;
  return `${first} and ${second}.`;
}
// What a part with nothing in it is called when empty parts are folded into one dim line,
// "Nothing changed for your users, no ideas yet."
export const EMPTY_PARTS = {
  waiting: 'nothing waiting on you',
  launch: 'no launch blockers',
  building: 'nothing being built',
  changed: 'nothing changed for your users',
  ideas: 'no ideas yet',
  health: 'nothing to report on health',
  rulings: 'no rulings',
  features: 'no features',
  joining: 'no changes waiting to join',
  quality: 'no reviews this week',
  decisions: 'no decisions along the way',
  risks: 'no shortcuts or risks',
  usage: 'no usage by part',
  briefingChanged: 'nothing changed for users',
  briefingProgress: 'nothing in progress',
  briefingWatch: 'nothing to watch',
};
// An italic line (Markdown) folding the empty parts named by `keys` into one: "Nothing a, none b."
export function foldedParts(keys) {
  const said = keys.map((key) => EMPTY_PARTS[key]).filter(Boolean).join(', ');
  return said === '' ? '' : `*${said.charAt(0).toUpperCase()}${said.slice(1)}.*`;
}

// What each deciding button is said to have done, in the past.
const DECIDED = { Approve: 'Approved', [SEND_BACK]: 'Sent back', Confirm: 'Confirmed', 'Lift All stop': 'All stop lifted', 'Lift STOP': 'All stop lifted', 'Do it': 'Done', 'Push it': 'Pushed', 'Change it': 'Changed', 'End it': 'Ended', 'Merge the fix': 'Merged', Start: 'Started' };
const decidedWord = (label) => DECIDED[label];
// A meanwhile that says when something happens ("It goes live within the hour"), as opposed to
// one that says only what waits.
const SAYS_WHEN = /\b(within (?:the|an?) (?:hour|day|week|minute)|within \d+ (?:minutes?|hours?|days?)|in \d+ (?:minutes?|hours?|days?)|in an? (?:minute|hour)|(?:by|at|until|before) \d{1,2}:\d{2}|today|tomorrow|tonight|this (?:morning|afternoon|evening)|shortly)\b/i;
// The toast for a deciding press that was recorded (one of DECIDED's labels): "<Label>d." and then what happens, taken from
// the card's meanwhile when it says when, else nothing more. The first sentence that says when.
export function decidedToast(label, meanwhile) {
  const sentence = typeof meanwhile === 'string'
    ? meanwhile.split(/(?<=[.;])\s+/).map((part) => part.trim().replace(/[.;]$/, '')).find((part) => SAYS_WHEN.test(part))
    : undefined;
  const said = `${decidedWord(label)}.`;
  return sentence === undefined ? said : `${said} ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
// The toast for a pick of Availability: what it is now, and that it can be undone for a minute.
export const awayToast = (said, undoable) => (undoable ? `${said}. ${UNDO_IN_PANE}` : `${said}.`);

// What a setup step is, said as the doing of it ("Connecting to GitHub"), and what has happened once it is done.
export const SETUP_DOING = Object.freeze({
  1: 'Installing Wheelhouse',
  2: 'Setting up the tools',
  3: 'Connecting to your code host',
  4: 'Asking three questions',
  5: 'Reading the rules found',
  6: 'Changing this computer\'s settings',
  7: 'Putting the project\'s files up',
  8: 'Locking Wheelhouse in',
  9: 'Testing phone notifications',
  10: 'Checking that everything is safe',
});
// Step 3 names the host once it is known.
export const connectingTo = (host) => (host === 'github' ? 'Connecting to GitHub' : host === 'gitlab' ? 'Connecting to GitLab' : host === 'local' ? 'Setting your project up on this computer' : SETUP_DOING[3]);
export const SETUP_DONE = Object.freeze({
  1: 'Wheelhouse is installed.',
  2: 'The tools are in place.',
  3: 'The project is connected.',
  4: 'Your three answers are kept.',
  5: 'The rules found are noted.',
  6: 'This computer\'s settings are changed.',
  7: 'The project\'s files are up.',
  8: 'Wheelhouse\'s checks are locked in.',
  9: 'Phone notifications are tested.',
  10: 'The health check is done.',
});
// What has happened, said for step 9 when it settled on something other than a test that arrived
// just now: the test of an earlier setup on this computer, or a test that didn't arrive.
export const PHONE_TESTED_EARLIER = 'Phone notifications reached your phone in an earlier setup.';
export const PHONE_TEST_MISSED = 'The test notification didn\'t arrive. The Logbook says what to check.';
export const PHONE_SKIPPED = 'Phone notifications skipped for now: ask the First Mate to set them up any time.';
// The line that opens a setup step: its place among the steps this computer runs and its minutes.
export const setupStepLine = (position, total, minutes) => `Step ${position} of ${total} · about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
// What carries on while the director's step is asked, and that it needs nothing from them.
export const setupMeanwhile = (what) => `Meanwhile, ${what}. Nothing for you to do there.`;
// What is going on, said for a step that runs by itself.
export const SETUP_GOING = Object.freeze({
  2: 'the tools are still installing',
  7: 'the project\'s files are still going up',
  10: 'the health checks are still running',
});
export const toolsInstalling = (tools) => `${tools.join(' and ')} ${tools.length === 1 ? 'is' : 'are'} still installing`;
// What reaches the director's phone, said on the phone step's card.
export const PHONE_REACHES = 'Only things that need you, finished features and breakages reach your phone.';
// How the director carries setup on in a new session: the sandbox's network limit takes effect
// only in a session started after setup wrote it (step 7).
export const NEW_SESSION = 'Start a new session on this folder, then say "carry on with setup"';
// Setup's closing verdict: how many of the health check's checks passed. `waiting`, how many of
// those that didn't pass only need a new session: when they are all that is left, it says so.
export const healthVerdict = (passed, total, waiting = 0) => {
  if (passed === total) return `All ${total} checks passed. Wheelhouse is ready.`;
  if (waiting > 0 && passed + waiting === total) return `${passed} of ${total} checks passed; the rest need one new session, as setup expects. ${NEW_SESSION}: the last checks run there.`;
  return `${passed} of ${total} checks passed. Here is what to do.`;
};

// The notification's title, and what it says when STOP is on (design section 23.8). A notification
// carries counts and card numbers only, never a card's words.
export const NOTIFICATION_TITLE = 'Wheelhouse';
export const NOTIFICATION_TITLE_STOP = 'Wheelhouse · All stop is on';
export const STOP_NOTIFICATION = 'The whole Crew has halted. Open Claude to see why.';
// "2 waiting on you: cards 3 and 4." from the cards' numbers, in order.
export function waitingOnYou(numbers) {
  const named = numbers.length === 1 ? String(numbers[0]) : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
  return `${numbers.length} waiting on you: ${numbers.length === 1 ? 'card' : 'cards'} ${named}.`;
}
