// scripts/mod/reply.js
// A card that decides something carries a reply code, so the director can answer it with a
// typed or phoned message that is just the code and an option ("K7QD Approve"). Such a reply
// counts as the click: it earns exactly the signed record the click would have, through the
// prompt record's own code, and nothing else. A plain "yes" never counts. The bridge, run by
// the mod outside the sandbox, calls replyRecord. The message's text is only parsed: it is
// never written anywhere, and only the card's own spelling of the option is used.
import { earned, keepEarned, sendKept, SIGNED_LABELS } from '../hooks/prompt-record.js';
import { withinBudget, BUDGET_MS } from '../hooks/pending.js';
import { localViews } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift } from '../lib/stop.js';
import { stateDir } from '../lib/paths.js';
import { CODE_ALPHABET, RUNBOOK_TITLES, setLineOf, replyCode } from '../state/card-lines.js';
import { REPLY_CODE_DAYS } from '../lib/core-numbers.js';

const DAY = 24 * 60 * 60 * 1000;
// Longer than any option a card offers; a longer message is not a reply.
const LABEL_CHARS = 80;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fold = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

// The code and option a message is, or null. The whole message must be a code of four
// characters from the code alphabet and an option, in any case, with any spacing and one
// closing full stop.
export function parseReply(text) {
  if (typeof text !== 'string') return null;
  let words = text.replace(/\s+/g, ' ').trim();
  if (words.endsWith('.')) words = words.slice(0, -1).trimEnd();
  const m = /^([A-Za-z0-9]{4}) (.+)$/.exec(words);
  if (!m || m[2].length > LABEL_CHARS || /[\p{Cc}\p{Cf}]/u.test(m[2])) return null;
  const code = m[1].toUpperCase();
  if ([...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return { code, label: m[2] };
}

// The record a reply earned, in plain words.
function recordedAs(made, question) {
  const data = made.data ?? {};
  if (made.kind === 'approval') return `Approve pull request #${data.pr}`;
  if (made.kind === 'confirmation') {
    const kind = /^Confirm ([a-z-]+) /.exec(setLineOf(question) ?? '')?.[1];
    return kind ? `Confirm the ${kind}` : 'Confirm';
  }
  if (data.action === 'lift-stop') return 'Lift STOP';
  if (data.action === 'runbook') return `Runbook step ${data.step}: ${RUNBOOK_TITLES[data.step]}`;
  if (data.action === 'ci-push') return `Push the CI change on ${data.branch}`;
  return data.label ?? made.kind;
}

const no = (says) => ({ made: false, says });

// replyRecord({ project, text, client, now, liftStop, budget }) -> { made, says }
// Finds the code in the shown view the last sync wrote, refuses it when it is unknown, used,
// out of date, held by two cards or answered with an option its card didn't offer, then signs,
// keeps and sends what a click on that option would have earned.
export async function replyRecord({ project, text, client, now = () => new Date(), liftStop = defaultLift, budget = BUDGET_MS } = {}) {
  const reply = parseReply(text);
  if (!reply) return no('That isn\'t a reply code and an option, so nothing was recorded');
  try {
    stateDir(project);
  } catch {
    return no('That project isn\'t known here');
  }
  const views = localViews(project, ['shown', 'damaged']);
  const shown = isRecord(views?.shown) ? views.shown : null;
  if (!shown) return no('The cards shown can\'t be read yet');
  const { code } = reply;
  // The views name a code two cards hold in these words, and leave it out of the shown view.
  if (Array.isArray(views.damaged) && views.damaged.includes(`a shown code held by two different questions: ${code}`)) {
    return no('That code is held by two cards, so it can\'t be used');
  }
  const card = Object.hasOwn(shown, code) && isRecord(shown[code]) ? shown[code] : null;
  if (!card || typeof card.question !== 'string' || !Array.isArray(card.options)) return no('No card has that code');
  // A shown record names its code by its one set line; anything else is not a card's code.
  const line = setLineOf(card.question);
  if (line === null || replyCode(line) !== code) return no('No card has that code');
  if (card.spent !== false) return no('That code has been used');
  const age = now().getTime() - Date.parse(card.at);
  if (!Number.isFinite(age) || age < 0) return no('That code\'s card can\'t be dated, so it can\'t be used');
  if (age >= REPLY_CODE_DAYS * DAY) return no(`That code has run out: a code lasts ${REPLY_CODE_DAYS} days`);

  const offered = card.options.filter((o) => typeof o === 'string' && fold(o) === fold(reply.label));
  if (offered.length !== 1) return no(`That card doesn't offer ${reply.label}`);
  const [label] = offered;
  if (!SIGNED_LABELS.includes(label)) return no(`Nothing to record for ${label}`);

  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);
  let kept;
  try {
    const got = await earned({ project, question: card.question, label, client: api, now, left });
    if (!got) return no('That card\'s answer can\'t be recorded now');
    kept = keepEarned(project, got, { now, liftStop });
    const what = recordedAs(got.made, card.question);
    const sent = await sendKept(api, left, kept);
    return { made: true, says: sent ? `Recorded: ${what}` : `Recorded: ${what} (kept until the helper takes it)` };
  } catch {
    return kept ? { made: true, says: 'Recorded, and kept until the helper takes it' } : no('That card\'s answer can\'t be recorded now');
  }
}
