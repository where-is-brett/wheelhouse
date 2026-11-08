// probes/haiku-trial/review-card.js
// The director's hands-on review (spec section 11): the card that fits a phone, the page of steps behind it, and the
// statement the director imports.
import fs from 'node:fs';
import path from 'node:path';
import { makeStatement, TRY_ME } from './statement.js';

export const REVIEW_TITLE = 'Check the spending tracker Wheelhouse built on Haiku';
export const OPTION_LABELS = Object.freeze({
  A: 'Tag it as working on Haiku',
  B: 'Tag it without the claim and record the floors',
  C: 'Hold the tag',
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function said(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(date);
}

// A if the score passed and every path passed; B if the score passed but a path failed; C otherwise.
export function recommendation({ score, rows } = {}) {
  if (score?.pass !== true) return 'C';
  const failed = (rows ?? []).some((r) => r.pass === false);
  return failed ? 'B' : 'A';
}

const REASON = {
  A: 'the score passed and every path passed',
  B: 'the score passed but a path failed',
  C: 'the score or a path fell short',
};

export function reviewCard({ project, date, decisionN, stepsUrl, address, score, rows, floor } = {}) {
  const paths = rows ?? [];
  const inScope = paths.filter((r) => r.pass !== null).length;
  const passed = paths.filter((r) => r.pass === true).length;
  const result = score && Number.isFinite(score.total) ? `Score: ${score.total}/100 (pass bar 80), ${passed}/${inScope} paths passed.` : 'Score: not measured.';
  const key = recommendation({ score, rows });
  const options = [
    { key: 'A', label: OPTION_LABELS.A, says: 'Tag v0.3.0 as "works on Haiku".', cost: 'none', undo: 'the tag can be moved before release notes go out' },
    { key: 'B', label: OPTION_LABELS.B, says: 'Tag v0.3.0 without the Haiku claim.', cost: 'the claim waits for a later run', undo: 'a later run can add it' },
    { key: 'C', label: OPTION_LABELS.C, says: 'Say what is wrong and it goes to intake as bugs.', cost: 'the tag waits', undo: 'answer again after the changes' },
  ];
  const text = [
    `What this is. You try ${project ?? 'the tracker'} for about 15 minutes, the trial's last step (run of ${said(date)}). ${result} ${String(floor ?? 'No known floor.').slice(0, 200)}`,
    'Why it comes to you. Whether this is good enough to tag v0.3.0 as "works on Haiku" is your call.',
    `Try this${address ? ` at ${address}` : ''}: ${stepsUrl ? `Show the steps (${stepsUrl})` : 'Show the steps'}. Step 7 is your typed answer to decision ${decisionN} here in the chat.`,
    'Options',
    ...options.map((o) => `${o.key}. ${o.label}. Cost: ${o.cost}. Undo: ${o.undo}.`),
    `I recommend ${key}, because ${REASON[key]}.`,
    'Meanwhile: nothing builds; the tracker stays up for you.',
  ].join('\n');
  return { title: REVIEW_TITLE, text, options, recommend: key };
}

// The nine steps of section 11, as the page behind "Show the steps".
export function stepsPage({ decisionN, tryMe = 'try-me.csv' } = {}) {
  return [
    '# Show the steps',
    '',
    'About 15 minutes. Each step says what good looks like.',
    '',
    '1. Open the home page. *Good:* three months listed, no errors.',
    '2. Open last month. *Good:* totals by category, a grand total, and a change from the month before.',
    `3. Import \`${tryMe}\`, from the link on the card; it is generated and has no real data. *Good:* "added 41, skipped 0", and a new month appears.`,
    '4. Import it again. *Good:* "added 0, skipped 41".',
    '5. Find the $40 refund in that month. *Good:* it lowers Shopping, not raises it.',
    '6. Move one transaction to another category. *Good:* it moves, and the totals change to match.',
    `7. In the chat, type your answer to decision ${decisionN} (a small question the trial kept for you). *Good:* the reply says it is recorded.`,
    '8. Open the tracker on your phone. *Good:* readable without zooming sideways.',
    '9. Open one merged pull request\'s description. *Good:* you can tell what changed and why without reading code.',
    '',
  ].join('\n');
}

export const ANSWER = /^\s*([ABC])\s*$/i;
// The letter A, B or C in an answer, or null when it is anything else.
export const answerLetter = (text) => ANSWER.exec(String(text ?? ''))?.[1].toUpperCase() ?? null;

// The card in the shape the feature command's `ask` takes: the same fields shapeProblems reads.
export function reviewAsDecision(card, { stepsUrl } = {}) {
  const lead = card.options.find((o) => o.key === card.recommend);
  return {
    what: card.title,
    why: `Whether this is good enough to tag v0.3.0 as "works on Haiku" is your call.${stepsUrl ? ` The steps are at ${stepsUrl}.` : ''}`,
    options: card.options,
    recommend: lead.label,
    because: REASON[card.recommend],
    meanwhile: 'Nothing builds; the tracker stays up for you.',
  };
}

export function writeTryMe(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'try-me.csv');
  fs.writeFileSync(file, makeStatement(TRY_ME).csv, 'utf8');
  return file;
}
