// scripts/agents/chat-clicks.js
// What a click in an agent's chat may be recorded as, for the helper's /cards/chat-click: the proofs a chat click
// can name, and the steps no chat click decides. The helper is core code that never names an agent, so it reads
// these from here.

// `chat-click` is the agent's own account of the click.
export const CHAT_PROOFS = Object.freeze(['chat-click']);
// The steps that need the director's confirmed click outside the chat (the window, Task 4): never a chat click.
export const CONFIRMED_STEPS = Object.freeze(['lift-stop', 'guardrail-change', 'unattended', 'runbook-step', 'ci-push', 'ask-allowance']);
// A card's hash in a click: its sha256, in full and in lower case.
export const CARD_HASH = /^[0-9a-f]{64}$/;
// The helper's rule for a click's hash, as a pure check: the refusal it gives, or null when the hash is a card's sha256.
export const HASH_REFUSAL = 'the card\'s hash must be its sha256, in lower case';
export const hashRefusal = (hash) => (typeof hash === 'string' && CARD_HASH.test(hash) ? null : HASH_REFUSAL);
