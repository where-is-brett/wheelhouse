// scripts/gate/open-questions.js
// A merge waits for the director's questions on its work. A question of theirs still open on the work, or answered after the
// head was reviewed (an answer the feature session has not yet acted on, since a push would have made a new head and a
// new review), means the head is not what the director's answers asked for. Pure; never throws.

import fs from 'node:fs';
import path from 'node:path';

// The ids a feature session's own `ask` gives: q-<work>-<n>.
const QUESTION_ID = /^q-([a-z0-9-]+)-[0-9]+$/;
const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The open-able questions of `work` in the build loop's views, each { id, answered, at, differs } where `at` is when it was
// answered and `differs` says the answer is not the recommendation the piece was built on. Only a plain question the work's own
// session raised counts (an id q-<work>-<n>): not an engine question, one that joins another or is gone, one asked again that
// the director had answered, or one tied to a change made by hand.
export function questionsOf(views, work) {
  if (typeof work !== 'string' || !isRecord(views?.questions)) return [];
  return Object.entries(views.questions)
    .filter(([id, e]) => QUESTION_ID.exec(id)?.[1] === work
      && isRecord(e) && isRecord(e.question) && isRecord(e.question.data) && e.question.data.work === work
      && e.question.data.engine === undefined && e.question.data.key === undefined
      && e.joins === undefined && e.gone !== true && e.byHand === undefined
      && !(e.answer === null && e.saidBefore !== undefined))
    .map(([id, e]) => {
      const recommended = e.question.data.recommendation;
      const label = isRecord(e.answer) ? e.answer.label : undefined;
      return {
        id,
        answered: isRecord(e.answer),
        at: isRecord(e.answer) && typeof e.answer.at === 'string' ? e.answer.at : null,
        differs: typeof recommended === 'string' && typeof label === 'string' && label !== recommended,
      };
    });
}

// The decisions on `work` that hold its merge, each { id, why }:
//   open       no answer yet;
//   unapplied  answered with something other than the recommendation the piece was built on, unless the session has said the
//              rework is in (`answer <id> --applied`) and the head has a review later than the answer: neither alone lifts it;
//   late       answered with the recommendation after the head was reviewed, and not said to need no change.
// `review` is the head's review as the gate holds it (a record, or { carried, record }); its time is when the head was last
// judged. `handled` is what readHandled gives: an answer the session said is dealt with covers that answer's time only, so a
// changed answer is a new time and holds again. Pure; never throws.
export function decisionsWaiting({ views, work, review, handled = {} }) {
  const record = review?.carried === true ? review.record : review;
  const reviewed = typeof record?.at === 'string' ? Date.parse(record.at) : NaN;
  const waiting = [];
  for (const q of questionsOf(views, work)) {
    const dealt = q.at !== null && handled?.[q.id] === q.at;
    if (!q.answered) waiting.push({ id: q.id, why: 'open' });
    // A different answer is applied only when it is marked so AND the head has been reviewed since it: the rework is a new head,
    // and a mark alone (the session's word) never lifts the hold. A review whose time can't be read counts as none.
    else if (q.differs && !(dealt && Number.isFinite(reviewed) && q.at !== null && Date.parse(q.at) < reviewed)) waiting.push({ id: q.id, why: 'unapplied' });
    else if (!dealt && Number.isFinite(reviewed) && q.at !== null && Date.parse(q.at) > reviewed) waiting.push({ id: q.id, why: 'late' });
  }
  return waiting;
}

const some = (n, one) => (n === 1 ? `a ${one}` : `${n} ${one}s`);

// The plain sentence for `waiting` (what decisionsWaiting gave) on `work`, or null when nothing waits.
export function holdSentence(waiting, work) {
  if (!Array.isArray(waiting) || waiting.length === 0) return null;
  const count = (why) => waiting.filter((w) => w?.why === why).length;
  const open = count('open');
  if (open > 0) return `the director has ${some(open, 'question')} open on ${work}, so it is not merged until ${open === 1 ? 'it is' : 'they are'} answered and acted on`;
  const unapplied = count('unapplied');
  if (unapplied > 0) return `the director chose something other than what ${work} was built on in ${some(unapplied, 'decision')}, and the change that answer asks for is not marked applied yet`;
  return `the director answered ${some(count('late'), 'question')} on ${work} after this version was reviewed, and no newer version carries the answer yet`;
}

// One plain reason a merge of `work` must wait, or null.
export function questionHold({ views, work, review, handled = {} }) {
  return holdSentence(decisionsWaiting({ views, work, review, handled }), work);
}

// The answers a feature session has said need no change, kept as one small file per question in `dir` (named by the question's
// id, holding the answer's time it covers). Written only when the session says so (`answer <id> --no-change`), so merely
// reading an answer never clears the hold.
export function readHandled(dir, ids) {
  const out = {};
  for (const id of ids) {
    if (!QUESTION_ID.test(id)) continue;
    try {
      const file = path.join(dir, id);
      if (path.dirname(file) === dir && fs.lstatSync(file).isFile()) out[id] = fs.readFileSync(file, 'utf8').trim();
    } catch { /* none kept */ }
  }
  return out;
}

export function markHandled(dir, id, at) {
  if (!QUESTION_ID.test(id) || typeof at !== 'string' || at === '') return false;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id);
  if (path.dirname(file) !== dir) return false;
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${at}\n`);
  fs.renameSync(temp, file);
  return true;
}
