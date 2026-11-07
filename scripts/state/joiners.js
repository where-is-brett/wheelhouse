// scripts/state/joiners.js
// Alike questions are one card, across pieces or within one (delegated decisions plan, choice 12). A joiner is a `question` record of
// its own, with `joins: <lead id>` and its own engine options, so nothing already signed changes. It takes its lead's
// answer only if the card clicked listed it: a click covers what its card showed, and a joiner newer than that card
// stays open, with what the director said. `joins` is read here against the lead's own words, so a question naming a
// lead it isn't alike takes nothing from it: it is an ordinary question, and no answer reaches level 4 this way.
import { alike, normaliseWords } from '../lib/words.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const dataOf = (entry) => entry?.question?.data;

// joinQuestions(questions, { shown, ended, kept }) fills in the view, in place. `shown(leadId)` gives the question ids the
// card clicked listed; `ended(data)` whether a question's run has ended; `kept(id, data)` whether the record stands as
// it was first written, since one recorded again is no longer what its piece asked. A joiner keeps `joins` while it stands behind a card,
// and `gone` once its piece has left the bundle; one with an answer of its lead's says `joined`, and one left open
// gives `saidBefore`, with `joins` gone, since it is a question of its own again.
export function joinQuestions(questions, { shown = () => [], ended = () => false, kept = () => true } = {}) {
  for (const [id, entry] of Object.entries(questions)) {
    const data = dataOf(entry);
    const leadId = data?.joins;
    const lead = questions[leadId];
    if (!isPlain(lead) || leadId === id || dataOf(lead).joins !== undefined || !kept(id, data)) continue;
    if (!alike(data, dataOf(lead))) continue;
    entry.joins = leadId;
    if (ended(data)) entry.gone = true;
    if (isPlain(entry.answer) || !isPlain(lead.answer)) continue;
    const said = normaliseWords(lead.answer.label);
    const label = data.options.find((o) => normaliseWords(o.label) === said)?.label;
    if (label === undefined) continue;
    if (shown(leadId).includes(id)) entry.answer = { ...lead.answer, label, joined: leadId };
    else if (entry.gone !== true) {
      entry.saidBefore = { label, at: lead.answer.at };
      delete entry.joins;
    }
  }
}

// The joiners still standing behind a lead's card: { id, work }, in the order they came.
export function joinersOf(questions, lead) {
  return Object.entries(isPlain(questions) ? questions : {})
    .filter(([, entry]) => entry?.joins === lead && entry.gone !== true && !isPlain(entry.answer))
    .map(([id, entry]) => ({ id, work: dataOf(entry).work }));
}
