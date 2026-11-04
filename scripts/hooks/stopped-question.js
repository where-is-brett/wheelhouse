// scripts/hooks/stopped-question.js
// Whether the last card question was stopped, read from the transcript's tail. A question the director stops
// (Esc) or skips comes back to the session as an error result that holds no answers, and records nothing. The
// match leans on that shape and not on the error's words, which Claude Code words as it likes (design section 9,
// item 4). The words it gives today are "The user doesn't want to proceed with this tool use." and
// "[Request interrupted by user for tool use]".

const CARD_TOOL = 'AskUserQuestion';
const INTERRUPTED = /^\s*\[Request interrupted by user/u;

const blocks = (entry) => (Array.isArray(entry?.message?.content) ? entry.message.content : []);

// The words of a user entry that is the director's own, or null: a tool result, a meta entry and the note Claude Code
// adds when a tool use is interrupted are not.
function promptText(entry) {
  if (entry?.type !== 'user' || entry.isMeta === true || entry.isSidechain === true) return null;
  const content = entry.message?.content;
  if (typeof content === 'string') return INTERRUPTED.test(content) ? null : content;
  const parts = blocks(entry);
  if (parts.some((b) => b?.type === 'tool_result')) return null;
  const text = parts.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return text === '' || INTERRUPTED.test(text) ? null : text;
}

const resultOf = (entry, id) => blocks(entry).find((b) => b?.type === 'tool_result' && b.tool_use_id === id);

// stoppedQuestion(entries, { prompt }) -> the question texts of the last card question when it was stopped, or null.
// Stopped means its tool result is an error that holds no answers. It is null for an answered question, for one with
// no result yet, and when a prompt of the director's came after it: `prompt` is the one now arriving, which the
// transcript may already hold, and does not count.
export function stoppedQuestion(entries, { prompt } = {}) {
  if (!Array.isArray(entries)) return null;
  const asked = entries.findLastIndex((e) => e?.type === 'assistant' && e.isSidechain !== true
    && blocks(e).some((b) => b?.type === 'tool_use' && b.name === CARD_TOOL));
  if (asked === -1) return null;
  const use = blocks(entries[asked]).findLast((b) => b?.type === 'tool_use' && b.name === CARD_TOOL);
  const after = entries.slice(asked + 1);
  const found = after.findIndex((e) => resultOf(e, use.id) !== undefined);
  if (found === -1) return null;
  const result = resultOf(after[found], use.id);
  const held = after[found].toolUseResult?.answers;
  const answered = result.is_error !== true || (held !== null && typeof held === 'object' && Object.keys(held).length > 0);
  if (answered) return null;
  const later = after.slice(found + 1).map(promptText).filter((t) => t !== null);
  if (later.some((t, i) => !(i === later.length - 1 && typeof prompt === 'string' && t.trim() === prompt.trim()))) return null;
  const questions = Array.isArray(use.input?.questions) ? use.input.questions : [];
  const texts = questions.map((q) => q?.question).filter((t) => typeof t === 'string' && t !== '');
  return texts.length === 0 ? null : texts;
}
