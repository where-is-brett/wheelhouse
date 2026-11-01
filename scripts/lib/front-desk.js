// scripts/lib/front-desk.js
// The front desk's numbers and the words its cards share, named once.

// AskUserQuestion's limits: questions per call, options per question, the header's length, and
// the most characters a card's question may have.
export const CARD = Object.freeze({ questions: 4, options: 4, fewestOptions: 2, header: 12, chars: 1200 });
// How many cards on different days, answered without Explain more, before a concept is proposed as known.
export const KNOWN_AFTER = 3;
// How many times a level 3 topic is approved unchanged before it is proposed for level 2.
export const DELEGATE_AFTER = 5;
// The page sizes a preview is photographed at, and how long one page may take.
export const SCREEN_SIZES = Object.freeze([Object.freeze({ width: 1280, height: 800 }), Object.freeze({ width: 390, height: 844 })]);
export const SCREEN_TIMEOUT_MS = 30000;
// How long a page's own scripts may run, in the browser's time, before its picture is taken.
export const SCREEN_SETTLE_MS = 5000;

// The one file in a project's main folder the front desk writes a command's JSON input to when its
// session has no scratchpad (ruling F85): git ignores `.wheelhouse/`, and the local settings let
// the front desk write this file without asking. Relative to the project's folder.
export const FRONT_DESK_INPUT = '.wheelhouse/front-desk.json';
// Where the front desk writes a work's report or brief, `<id>.md` (the intake's bug route), and the
// local settings' rule that lets it write those files without asking: Markdown files directly in the
// folder, nothing below it or beside it. Relative to the project's folder.
export const WORK_REPORTS = '.wheelhouse/work/';
export const WORK_REPORTS_RULE = `Edit(/${WORK_REPORTS}*.md)`;

// What a card is about: the cards with a set line, and the one without. A baseline card reads
// the private note's figures back (scripts/measures/baseline.js); the helper composes it, and it
// is never a card event in the state. A trust card asks to trust another of the director's
// computers here (ruling R80); the session start composes it, and its click is kept on this computer.
// A blind card shows a question's options first, with no recommendation (scripts/delegation/blind.js).
// A take-over card asks to take the lock from another computer that holds it (design section 9); the session start
// composes it, and its click is the director's Take over here, which the helper acts on.
// Uninstall's card asks to remove Wheelhouse from a project (ruling R90); the helper composes it, and
// its click is kept on this computer, as a setup click is. A keep-control-files card asks to keep a
// feature's files that steer agents as they are now (ruling P7-31), so the watcher wakes it again. A
// usage card offers a Thoroughness switch (design section 14.6); the session start composes it, and
// the click on its switch is the setting change and the director's confirmation of it at once. The
// premium model's card offers its separate opt-in (design section 14.6); the helper composes it, and
// the click on one of its Allow options is the premium setting and the director's confirmation of it.
export const CARD_KINDS = Object.freeze([
  'approval', 'confirm', 'lift-stop', 'ci-push', 'runbook', 'approve-work', 'answer', 'amend',
  'lift-incident', 'incident-fix', 'setup', 'confirm-all', 'baseline', 'trust', 'take-over', 'uninstall', 'question',
  'keep-control-files', 'usage', 'premium', 'pair', 'blind',
]);
// Labels that ask for more or put a card off: a click on one never answers it.
// Why? and Suggest a change… only steer the front desk; the director's own words never sign anything.
export const PUT_OFF = Object.freeze(['Not now', 'Explain more', 'Show me', 'Why?', 'Suggest a change…']);
// The option a confirm card for a proposal offers in place of Show me (ruling F48): it decides the
// card, signs nothing, and holds the proposal back for a while.
export const KEEP_AS_IS = 'Keep as is';
