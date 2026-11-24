// scripts/agents/chat-clicks.js
// What a click in an agent's chat may be recorded as, for the helper's /cards/chat-click: the proofs a chat click
// can name, and the steps no chat click decides. The helper is core code that never names an agent, so it reads
// these from here.

// `chat-click` is the agent's own account of the click.
export const CHAT_PROOFS = Object.freeze(['chat-click']);
// The steps that need the director's confirmed click outside the chat (the window, Task 4): never a chat click.
export const CONFIRMED_STEPS = Object.freeze(['lift-stop', 'guardrail-change', 'unattended', 'runbook-step', 'ci-push', 'ask-allowance']);
// `hook-click` is a click an agent's own hook saw come back from the question tool (the harness's answer, not the
// model's), recorded by /cards/hook-click for a card /cards/hook-shown recorded as shown to that session. It may decide
// every step in CONFIRMED_STEPS and a decision; a `chat-click` may not.
export const HOOK_PROOFS = Object.freeze(['hook-click']);
// How long after a card was shown its click is taken. The card waits for the director, who may read it for a while, so the
// window is ten minutes: past it the click is refused and the card is asked again. A click is taken once.
export const HOOK_CLICK_MS = 10 * 60 * 1000;
// The most shown cards the helper keeps at once; the oldest go first.
export const HOOK_SHOWN_MAX = 200;
// A card's hash in a click: its sha256, in full and in lower case.
export const CARD_HASH = /^[0-9a-f]{64}$/;
// The helper's rule for a click's hash, as a pure check: the refusal it gives, or null when the hash is a card's sha256.
export const HASH_REFUSAL = 'the card\'s hash must be its sha256, in lower case';
export const hashRefusal = (hash) => (typeof hash === 'string' && CARD_HASH.test(hash) ? null : HASH_REFUSAL);
