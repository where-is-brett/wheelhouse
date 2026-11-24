// scripts/agents/copilot/ask-click.js
// Reads Copilot's question card out of a hook's input, and the answer that came back, for the recording of a click
// (hook-entry.js, the helper's /cards/hook-shown and /cards/hook-click). Input is the translated one (translate.js):
// `tool_name`, `tool_input`, `tool_response`.
//
// Two shapes came back in check 59:
//   - VS Code's chat, `vscode_askQuestions`: `tool_response` is a JSON string `{ answers: { <header>: { selected,
//     freeText, skipped } } }`;
//   - the CLI harness, `ask_user`: the answer is only the text "User responded: <label>" in `textResultForLlm`.
// A click is an answer naming exactly one of the card's own options. Anything else is no click: free text (a click and
// typed text look alike in the CLI, so a binding card allows none), a closed card, and an answer the harness gave by
// itself. A closed card is told apart as `closed`, so the First Mate hears one line. The harness's own answer (Autopilot,
// `chat.autoReply`: checks 59 and 97) is told apart as `auto`, so the First Mate can be told to ask no more and the
// director to switch it off.
import copilotTools from '../../../adapters/copilot/tools.js';

export const VSCODE_ASK = 'vscode_askQuestions';
export const AUTO_LINE = 'Copilot\'s Autopilot is answering your cards for you; switch it off.';
// What the hook tells the First Mate on the first auto-answer.
export const AUTO_TELL = `Copilot answered a card by itself, with no click from the director, so that answer counts for nothing. Stop: ask no more cards, take no step that waited on it, and say this one line to the director, in plain words: "${AUTO_LINE}"`;

// What the hook tells the First Mate when the director closed the card without choosing.
export const CLOSED_LINE = 'The director closed the card without choosing an option, so nothing was recorded.';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const RESPONDED = /^User responded: ([\s\S]+)$/;
// The harness's own answer: "The user is not available…" (CLI, both checks; VS Code's words are alike). A person closing
// the CLI's card: "User cancelled the request." (check 59).
const NOT_AVAILABLE = /not available/i;
const CANCELLED = /^User cancelled/i;

// The labels a card offers, from the call's input: `choices` or `options` (words or `{ label }`), or the CLI's
// `requestedSchema` (an `enum`, or `oneOf` entries with a `const` or `title`).
export function labelsIn(input) {
  const given = input?.choices ?? input?.options;
  if (Array.isArray(given)) return given.map((o) => (isObject(o) ? o.label : o)).filter((l) => typeof l === 'string' && l !== '');
  const properties = input?.requestedSchema?.properties;
  if (isObject(properties)) {
    for (const property of Object.values(properties)) {
      if (Array.isArray(property?.enum)) return property.enum.filter((l) => typeof l === 'string' && l !== '');
      if (Array.isArray(property?.oneOf)) return property.oneOf.map((o) => o?.const ?? o?.title).filter((l) => typeof l === 'string' && l !== '');
    }
  }
  return [];
}

// The card as the call asked it, `{ message, options }`, or null: one question, with its options.
export function askOf(input) {
  const given = input?.tool_input;
  if (input?.tool_name === copilotTools.ask && typeof given?.message === 'string') {
    const options = labelsIn(given);
    return options.length > 0 ? { message: given.message, options } : null;
  }
  if (input?.tool_name === VSCODE_ASK && Array.isArray(given?.questions) && given.questions.length === 1) {
    const [q] = given.questions;
    const options = labelsIn(q);
    return typeof q?.question === 'string' && options.length > 0 ? { message: q.question, options, header: typeof q.header === 'string' ? q.header : q.question, free: q.allowFreeformInput === true } : null;
  }
  return null;
}

// What came back: `{ kind: 'click', label }`, `{ kind: 'closed' }` (the person closed the card), `{ kind: 'auto' }`
// (the harness answered by itself) or `{ kind: 'none' }`.
export function answerOf(input) {
  const ask = askOf(input);
  const none = { kind: 'none' };
  if (ask === null) return none;
  if (input.tool_name === VSCODE_ASK) {
    let response = input.tool_response;
    try {
      if (typeof response === 'string') response = JSON.parse(response);
    } catch {
      return none;
    }
    const answer = response?.answers?.[ask.header];
    if (!isObject(answer) || !Array.isArray(answer.selected)) return none;
    if (answer.skipped === true) return { kind: 'closed' };
    const hasWords = typeof answer.freeText === 'string' && answer.freeText.trim() !== '';
    // VS Code's own answer chooses nothing, with its "not available" words or none; words of any other kind are typed.
    if (answer.selected.length === 0) return !hasWords || NOT_AVAILABLE.test(answer.freeText) ? { kind: 'auto' } : none;
    if (ask.free || hasWords || answer.selected.length !== 1 || !ask.options.includes(answer.selected[0])) return none;
    return { kind: 'click', label: answer.selected[0] };
  }
  const result = input.tool_response;
  const text = isObject(result) && typeof result.textResultForLlm === 'string' ? result.textResultForLlm : null;
  if (text === null || (result.resultType !== undefined && result.resultType !== 'success')) return none;
  if (CANCELLED.test(text)) return { kind: 'closed' };
  const said = RESPONDED.exec(text.trim());
  if (said === null) return none;
  if (NOT_AVAILABLE.test(said[1]) && !ask.options.includes(said[1])) return { kind: 'auto' };
  return ask.options.includes(said[1]) ? { kind: 'click', label: said[1] } : none;
}
