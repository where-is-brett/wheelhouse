// probes/mac-sitting/add-card.mjs
// The fifth card of check 41, added while the director's screen is locked, so the courier's next
// tick wakes the front desk and Claude's notification goes to the phone. Run by the agent at that
// moment, not during preparation.
//
//   node add-card.mjs              composes the card with the front desk's composer and records it
//   node add-card.mjs --dry-run    says what it would do, and whether the courier's gap is open
//
// The courier wakes for a new card only when its last wake was COURIER_GAP_MS (10 minutes) ago or
// more; STOP wakes inside the gap, so a STOP press earlier in the sitting may have set lastWakeAt a
// few minutes before. When it has, this moves lastWakeAt back past the gap first, as the end-to-end
// test does, and says so: the wake it then makes sets a new lastWakeAt, which is what the check
// reads. It prints the time the card was recorded; the pass is a lastWakeAt after it and inside
// the three minutes.
import fs from 'node:fs';
import path from 'node:path';
import { LOGS, PROJECT, fromPlugin, useHome } from './layout.mjs';

const made = useHome();
const dry = process.argv.includes('--dry-run');
const { courierFile } = await fromPlugin('scripts/mod/courier.js');
const { COURIER_GAP_MS } = await fromPlugin('scripts/lib/mod-numbers.js');
const MINUTE = 60 * 1000;
const say = (line) => process.stdout.write(`${line}\n`);

const file = courierFile(PROJECT);
const courier = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const last = courier?.lastWakeAt ? Date.parse(courier.lastWakeAt) : Number.NaN;
const inGap = Number.isFinite(last) && Date.now() - last < COURIER_GAP_MS;
say(`courier.json: ${courier === null ? 'none yet (no session has ticked: the sitting has not started)' : `lastWakeAt ${courier.lastWakeAt ?? 'none'}, ${courier.sessions?.length ?? 0} sessions`}`);
say(inGap ? `the gap is open: the last wake was ${Math.round((Date.now() - last) / 1000)} s ago` : 'the gap is closed: a new card wakes the front desk on the next idle tick');

// Each run adds a card with words of its own. Answers are kept by the question's words, so a second
// card with the first one's words reads as answered, never reaches the board and wakes nothing (the
// second sitting's second lock, 23 October 2026). The run counts the cards added before it in
// sitting.jsonl and takes the next question; past the list, the count goes into the words.
const QUESTIONS = [
  { what: 'Which photo goes on the home page?', options: ['The team', 'The product'], says: ['A photo of the team at work.', 'A photo of the product in use.'] },
  { what: 'Which heading goes above the price list?', options: ['Prices', 'What it costs'], says: ['One word, plain.', 'A short phrase, friendlier.'] },
  { what: 'Which colour goes on the footer?', options: ['Grey', 'Navy'], says: ['Quiet, as now.', 'Darker, matching the header.'] },
];
const sittingLog = path.join(LOGS, 'sitting.jsonl');
const before = fs.existsSync(sittingLog)
  ? fs.readFileSync(sittingLog, 'utf8').split('\n').filter((line) => line.includes('"added"')).length : 0;
const pick = QUESTIONS[before % QUESTIONS.length];
const round = Math.floor(before / QUESTIONS.length);
const input = {
  kind: 'question', level: 2, what: round === 0 ? pick.what : `${pick.what} (${round + 1})`, why: 'It is the first thing visitors see.',
  options: pick.options.map((label, i) => ({ label, says: pick.says[i] })),
  recommend: pick.options[1], because: 'it reads more plainly', meanwhile: 'The page keeps what it has now.',
};
if (dry) {
  say(`would compose and record: ${input.what}`);
  if (inGap) say(`would move lastWakeAt back to ${new Date(last - COURIER_GAP_MS - MINUTE).toISOString()}`);
  process.exit(0);
}
if (courier === null) {
  say('No session has ticked yet: start the sitting first.');
  process.exit(2);
}
if (inGap) {
  const moved = new Date(last - COURIER_GAP_MS - MINUTE).toISOString();
  fs.writeFileSync(file, `${JSON.stringify({ ...courier, lastWakeAt: moved })}\n`);
  say(`moved lastWakeAt back from ${courier.lastWakeAt} to ${moved}`);
}
// Composed by the front desk's composer and recorded through the helper without being handed out,
// as a card written while no visit runs (tests/e2e/mod.test.js, waitingCard). `cli.js card` would
// record it as asked too, and the courier never wakes for a card the front desk has asked.
const { composeCard } = await fromPlugin('scripts/cards/compose.js');
const { helperClient } = await fromPlugin('scripts/host/helper-client.js');
const { card } = composeCard(input);
const recordedAt = new Date().toISOString();
const written = await helperClient({ address: made.helper.address }).state.write({ project: PROJECT, kind: 'card', data: card });
if (written?.ok !== true) {
  say(`The card wasn't recorded: ${JSON.stringify(written)}`);
  process.exit(1);
}
const { id } = written;
fs.appendFileSync(sittingLog, `${JSON.stringify({ at: recordedAt, added: input.what, id, movedGap: inGap })}\n`);
say(`recorded card ${id} at ${recordedAt}. Pass: courier.json's lastWakeAt after this time and inside the three minutes.`);
process.exit(0);
