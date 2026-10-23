// scripts/agents/chat-clicks.js
// What a click in an agent's chat may be recorded as, for the helper's /cards/chat-click: the proofs a chat click
// can name, and the steps no chat click decides. The helper is core code that never names an agent, so it reads
// these from here: this file imports only the design's numbers.
import { C6_PASSED, CONFIRMED_STEPS } from '../lib/copilot-numbers.js';

// `chat-click` is the agent's own account of the click. `hook-click`, a click a hook saw, waits on check 59 (C6).
export const CHAT_PROOFS = Object.freeze(C6_PASSED ? ['chat-click', 'hook-click'] : ['chat-click']);
// The steps that need the director's confirmed click outside the chat (the window, Task 4): never a chat click.
export { CONFIRMED_STEPS };
