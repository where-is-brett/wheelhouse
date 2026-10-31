// scripts/hooks/chat-question.js
// On Stop, adds one `chat-question` count when a First Mate turn ends on a question with no card (delegated decisions
// design, section 7.5). The record holds its time and never the words, and the audit samples from the transcript.
//
// It only counts: nothing here is ever returned, so it can't change a turn, and a failure anywhere is passed over. What
// it can't show isn't counted: with no transcript to read, it can't say that no card was asked. On an agent with no
// Stop hook, the audit reads the transcript instead.
import { projectOf, readTailEntries, runAndExit } from './kit.js';
import { featureSlug } from './session-start.js';
import { sessionRole } from '../lib/role.js';
import { helperClient } from '../host/helper-client.js';
import { helperGrace } from '../lib/helper-grace.js';
import { startedAsScript } from '../lib/started-as-script.js';

const BUDGET_MS = 3000;
// The tool a card is asked with.
const CARD_TOOL = 'AskUserQuestion';
const QUESTION_MARKS = /[?？؟]$/u;
// Emphasis around the last words; a closing quote or backtick is left, so a quotation doesn't read as asking.
const EMPHASIS = /[*_~\s]+$/u;

// Whether the text's last line ends on a question of its own. A quoted line or a fence is someone else's words.
export function endsOnQuestion(text) {
  if (typeof text !== 'string') return false;
  const last = text.replace(/\p{Cf}/gu, '').trimEnd().split('\n').at(-1).trim();
  return !last.startsWith('>') && QUESTION_MARKS.test(last.replace(EMPHASIS, ''));
}

const blocks = (entry) => (Array.isArray(entry?.message?.content) ? entry.message.content : []);
const isPrompt = (entry) => entry?.type === 'user' && entry.isMeta !== true
  && (typeof entry.message?.content === 'string' || blocks(entry).some((b) => b?.type !== 'tool_result'));

// The entries after the director's last prompt: its words at the end, and whether a card was asked.
function lastTurn(entries) {
  const turn = entries.slice(entries.findLastIndex(isPrompt) + 1).filter((e) => e?.type === 'assistant' && e.isSidechain !== true);
  const said = turn.flatMap(blocks).filter((b) => b?.type === 'text' && typeof b.text === 'string').at(-1)?.text;
  return { text: said, asked: turn.flatMap(blocks).some((b) => b?.type === 'tool_use' && b.name === CARD_TOOL) };
}

export async function decide(input, { dir, projectOf: find = projectOf, env = process.env, client, now = () => new Date(), slugOf = featureSlug } = {}) {
  try {
    if (input.stop_hook_active === true || typeof input.cwd !== 'string') return undefined;
    const found = find(input.cwd, { dir });
    if (!found || slugOf(input.cwd) !== null || sessionRole({ sessionId: input.session_id, env, cwd: input.cwd }) !== 'front-desk') return undefined;
    const entries = readTailEntries(input.transcript_path);
    if (entries === null) return undefined;
    const { text, asked } = lastTurn(entries);
    if (asked || !endsOnQuestion(typeof input.last_assistant_message === 'string' ? input.last_assistant_message : text)) return undefined;
    await (client ?? helperClient({ timeout: BUDGET_MS + helperGrace() })).state.write({ project: found.project, kind: 'chat-question', data: { at: now().toISOString() } });
  } catch {
    // A count lost, and nothing else.
  }
  return undefined;
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'Stop' });
}
