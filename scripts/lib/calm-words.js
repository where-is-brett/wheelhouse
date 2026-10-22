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
export const SENT_TO_FRONT_DESK = 'Sent to the front desk. A new proposal will follow.';
// The note for a suggestion made at a time: a new proposal is coming and nothing goes live meanwhile.
export const suggestedAt = (hhmm) => `You suggested a change at ${hhmm}. A new proposal is on its way, and nothing goes live meanwhile.`;
// The note for a suggestion typed in the chat, naming the card it is about.
export const typeYourChange = (n) => `Type your change in the chat, and I'll know it's about card ${n}.`;
// The note shown while a press is being written down.
export const RECORDING = 'Recording…';
// The note shown when a suggestion could not be handed to the front desk.
export const NOT_HANDED = 'That didn\'t reach the front desk. Type it in the chat instead.';
// The note shown when a press could not be written down at all.
export const NOT_RECORDED = 'That wasn\'t recorded. Try again, or type it in the chat.';
// The note shown in place of the pane while setup is still running.
export const SETTING_UP = 'Setup is still running. This pane opens when it finishes.';
// The note shown in a chat that is not the front desk's.
export const NOT_HERE = 'This pane lives in the front desk\'s chat. Type /wheelhouse there.';
// The note shown when a setting is changed while STOP is on.
export const SETTINGS_UNDER_STOP = 'Settings can\'t change while STOP is on. Lift STOP first.';
// The line shown when the latest state could not be read: when it failed and which reading is shown.
export const staleLine = (failedAt, shownAt) => `Couldn't read the latest at ${failedAt}. Showing ${shownAt}'s.`;
// The verdict when no card is waiting, and the note shown when a card was replaced under the director.
export const NOTHING_NEEDS_YOU = 'Nothing needs you.';
export const CHANGED_WHILE_READING = 'That card changed while you were reading. Here is the new one.';
// What STOP does, and who can undo it.
export const STOP_HALTS = 'Halts every builder at once.';
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
// The note shown when Undo is pressed after its minute has passed.
export const NOTHING_TO_UNDO = 'There\'s nothing to undo now';
// What Undo is offered as, said after a setting's pick that can be undone.
export const UNDO_IN_PANE = 'Undo in the pane for a minute.';
// How long ago a card was asked: "asked just now", "asked 2 hours ago".
export const ASKED_JUST_NOW = 'asked just now';
export const askedAgo = (n, unit) => `asked ${n} ${unit}${n === 1 ? '' : 's'} ago`;

// What each deciding button is said to have done, in the past.
const DECIDED = { Approve: 'Approved', Confirm: 'Confirmed', 'Lift STOP': 'STOP lifted', 'Do it': 'Done', 'Push it': 'Pushed', 'Change it': 'Changed', 'End it': 'Ended', 'Merge the fix': 'Merged' };
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
