// scripts/state/joiners.js
// Alike questions are one card, across pieces or within one (delegated decisions plan, choice 12). A joiner is a `question` record of
// its own, with `joins: <lead id>` and its own engine options, so nothing already signed changes. It takes its lead's
// answer only if the card clicked listed it: a click covers what its card showed, and a joiner newer than that card
// stays open, with what the director said. `joins` is read here against the lead's own words, so a question naming a
// lead it isn't alike takes nothing from it: it is an ordinary question, and no answer reaches level 4 this way. A close
// match (scripts/delegation/asked.js) is a signed `match` record instead, for words that aren't alike: it needs the same
// piece and options, and a click still covers only what its card showed. On an answered card it gives `saidBefore` alone.
import { alike, normaliseWords, sameChoice } from '../delegation/words.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const dataOf = (entry) => entry?.question?.data;

// joinQuestions(questions, { shown, ended, kept }) fills in the view, in place. `shown(leadId)` gives the question ids the
// card clicked listed; `ended(data)` whether a question's run has ended; `kept(id, data)` whether the record stands as
// it was first written, since one recorded again is no longer what its piece asked. A joiner keeps `joins` while it stands behind a card,
// and `gone` once its piece has left the bundle; one with an answer of its lead's says `joined`, and one left open
// gives `saidBefore`, with `joins` gone, since it is a question of its own again. `matched(id)` gives a question's `match` record, or null.
function answerBehind(questions, id, data) {
  const found = Object.entries(questions).find(([other, q]) => other !== id && dataOf(q)?.work === data.work && dataOf(q).key === data.key && typeof data.key === 'string'
    && q.answer?.label === data.saidBefore && q.answer.changed !== true);
  return found ? found[1].answer : null;
}

// The answer a `match` record's line stands on: on the piece, as it says, and unchanged.
function answerMatched(questions, data, match) {
  const from = questions[match?.from];
  return dataOf(from)?.work === data?.work && data?.level === 3 && from?.answer?.label === match?.saidBefore && from.answer.changed !== true ? from.answer : null;
}

export function joinQuestions(questions, { shown = () => [], ended = () => false, kept = () => true, matched = () => null } = {}) {
  for (const [id, entry] of Object.entries(questions)) {
    const data = dataOf(entry);
    // The piece asked this again. A record only claims what the director said, so an answer on the record has to stand behind it.
    const behind = typeof data?.saidBefore === 'string' ? answerBehind(questions, id, data) : null;
    if (behind !== null) entry.saidBefore = { label: data.saidBefore, at: behind.at };
    const match = matched(id);
    const stood = typeof match?.saidBefore === 'string' ? answerMatched(questions, data, match) : null;
    if (stood !== null) entry.saidBefore = { label: match.saidBefore, at: stood.at };
    const close = typeof match?.joins === 'string' && data?.joins === undefined;
    const leadId = close ? match.joins : data?.joins;
    const lead = questions[leadId];
    if (!isPlain(lead) || leadId === id || dataOf(lead).joins !== undefined || typeof matched(leadId)?.joins === 'string' || !kept(id, data)) continue;
    if (!(close ? dataOf(lead).work === data.work && sameChoice(data, dataOf(lead)) : alike(data, dataOf(lead)))) continue;
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
