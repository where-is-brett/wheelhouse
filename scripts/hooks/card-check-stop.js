// scripts/hooks/card-check-stop.js
// The Stop half of the card check (scripts/hooks/card-check.js), in a module of its own so a Stop event loads what it needs and
// not the checks of a question card: a front-desk session's last message may not hold a decision block that isn't a waiting
// decision's exact text, nor ask the director a question in plain text. The decisions themselves are read only for a message that
// holds a block.
import { answer, projectOf, readTailEntries } from './kit.js';
import { sessionRole } from '../lib/role.js';
import { refreshSeat } from '../lib/first-mate-seat.js';
import { decisionText, blocksIn } from '../decisions/message.js';
import { startedByScript } from '../lib/started-by-script.js';

// What the First Mate's turn ended on: the hook's own field, else the text of the last assistant entry of the transcript's tail.
function lastMessageOf(input) {
  if (typeof input.last_assistant_message === 'string') return input.last_assistant_message;
  const entries = readTailEntries(input.transcript_path);
  const last = Array.isArray(entries) ? entries.findLast((e) => e?.type === 'assistant' && e.isSidechain !== true && Array.isArray(e.message?.content)
    && e.message.content.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text !== '')) : undefined;
  return last === undefined ? '' : last.message.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

const trimmed = (text) => text.split(/\r\n|[\n\r]/).map((l) => l.trimEnd()).join('\n').trim();

// checkShown(lastMessage, pending) -> { ok: true } | { ok: false, reason }. Every "Decision needed" block in the message must equal
// one waiting decision's text exactly, as `decision show <n>` prints it.
export function checkShown(lastMessage, pending) {
  const waiting = Array.isArray(pending) ? pending : [];
  for (const block of blocksIn(lastMessage)) {
    // Either form `decision show` prints: the typed reply's, or the one where this chat records no answer yet.
    if (waiting.some((d) => [decisionText(d), decisionText(d, { unrecorded: true })].some((text) => trimmed(block) === trimmed(text)))) continue;
    const named = Number(/^Decision needed \(([1-9][0-9]*)\)/.exec(block)?.[1]);
    const meant = waiting.find((d) => d.n === named) ?? (waiting.length === 1 ? waiting[0] : undefined);
    if (meant !== undefined) return { ok: false, reason: `Show decision ${meant.n} exactly as printed: run \`decision show ${meant.n}\` and copy its text word for word, with nothing added inside it.` };
    return { ok: false, reason: waiting.length === 0
      ? 'No decision is waiting, so a "Decision needed" block is not shown. Take it out; a decision is raised through the intake, and `decision list` says what waits.'
      : `That "Decision needed" block is not a waiting decision. Waiting: ${waiting.map((d) => d.n).join(', ')}. Show one exactly as \`decision show <n>\` prints it.` };
  }
  return { ok: true };
}

// plainQuestion(lastMessage) -> the first line that asks the director something in plain text, or null. A line asks when it
// ends with a question mark; lines in a code fence, quoted with ">", or in a message that holds a decision or a card copied
// word for word (its reply code line) are not counted, as those are the forms a question may take in the chat.
export function plainQuestion(lastMessage) {
  const text = String(lastMessage ?? '');
  if (blocksIn(text).length > 0 || /^\s*Reply code:/mu.test(text)) return null;
  let fenced = false;
  for (const raw of text.split(/\r\n|[\n\r]/)) {
    const line = raw.trim();
    if (/^(```|~~~)/u.test(line)) { fenced = !fenced; continue; }
    if (fenced || line.startsWith('>')) continue;
    if (/\?["'”’)*_]*$/u.test(line)) return line;
  }
  return null;
}

// The Stop check, in a front-desk session: a last message with a decision block that is not a waiting decision's exact text is
// sent back, and so is one that asks the director a question in plain text, since every question is a card. A turn already sent
// back once is let go, and any failure lets the message through.
export async function decideStop(input, { projectOf: find = projectOf, dir, role = sessionRole, env = process.env, decisions } = {}) {
  try {
    if (input.stop_hook_active === true || startedByScript(env)) return undefined;
    const message = lastMessageOf(input);
    const found = find(input.cwd, { dir });
    const holder = found && role({ sessionId: input.session_id, env, cwd: input.cwd }) === 'front-desk';
    if (holder) refreshSeat(found.project, input.session_id);
    if (!holder) return undefined;
    const asked = plainQuestion(message);
    if (asked !== null) return answer.block(`Your message asks the director a question in plain text ("${asked.length > 120 ? `${asked.slice(0, 119)}…` : asked}"). Every question is a card: write it as a card's JSON and ask it with \`card\`, as the front-desk skill says, whatever another skill says about asking in the chat. Don't repeat the question in the message.`);
    if (blocksIn(message).length === 0) return undefined;
    const checked = checkShown(message, (decisions ?? (await import('../decisions/pending.js')).readDecisions(found.project)).pending);
    return checked.ok ? undefined : answer.block(checked.reason);
  } catch {
    return undefined;
  }
}

// What the entry runs for a Stop: the check above, on the input as the hook gives it.
export const decide = (input, deps = {}) => decideStop(input, deps);
