// scripts/lib/front-desk.js
// The front desk's numbers and the words its cards share, named once.

// AskUserQuestion's limits: questions per call, options per question, the header's length, and
// the most characters a card's question may have.
export const CARD = Object.freeze({ questions: 4, options: 4, header: 12, chars: 1200 });
// How many cards on different days, answered without Explain more, before a concept is proposed as known.
export const KNOWN_AFTER = 3;
// How many times a level 3 topic is approved unchanged before it is proposed for level 2.
export const DELEGATE_AFTER = 5;
// The page sizes a preview is photographed at, and how long one page may take.
export const SCREEN_SIZES = Object.freeze([Object.freeze({ width: 1280, height: 800 }), Object.freeze({ width: 390, height: 844 })]);
export const SCREEN_TIMEOUT_MS = 30000;

// What a card is about: the cards with a set line, and the one without.
export const CARD_KINDS = Object.freeze([
  'approval', 'confirm', 'lift-stop', 'ci-push', 'runbook', 'approve-work', 'answer', 'amend',
  'lift-incident', 'incident-fix', 'setup', 'confirm-all', 'question',
]);
// Labels that ask for more or put a card off: a click on one never answers it.
export const PUT_OFF = Object.freeze(['Not now', 'Explain more', 'Show me']);
// The option a confirm card for a proposal offers in place of Show me (ruling F48): it decides the
// card, signs nothing, and holds the proposal back for a while.
export const KEEP_AS_IS = 'Keep as is';
