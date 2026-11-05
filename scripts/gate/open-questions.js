// scripts/gate/open-questions.js
// A merge waits for the director's questions on its work. A question of theirs still open on the work, or answered after the
// head was reviewed (an answer the feature session has not yet acted on, since a push would have made a new head and a
// new review), means the head is not what the director's answers asked for. Pure; never throws.

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The questions of `work` in the build loop's views, each { id, answered, at } where `at` is when it was answered.
export function questionsOf(views, work) {
  if (typeof work !== 'string' || !isRecord(views?.questions)) return [];
  return Object.entries(views.questions)
    .filter(([, e]) => isRecord(e) && isRecord(e.question) && isRecord(e.question.data) && e.question.data.work === work)
    .map(([id, e]) => ({ id, answered: isRecord(e.answer), at: isRecord(e.answer) && typeof e.answer.at === 'string' ? e.answer.at : null }));
}

// One plain reason a merge of `work` must wait, or null. `review` is the head's review as the gate holds it (a record, or
// { carried, record }); its time is when the head was last judged.
export function questionHold({ views, work, review }) {
  const found = questionsOf(views, work);
  const open = found.filter((q) => !q.answered);
  if (open.length > 0) return `the director has ${open.length === 1 ? 'a question' : `${open.length} questions`} open on ${work}, so it is not merged until ${open.length === 1 ? 'it is' : 'they are'} answered and acted on`;
  const record = review?.carried === true ? review.record : review;
  const reviewed = typeof record?.at === 'string' ? Date.parse(record.at) : NaN;
  if (!Number.isFinite(reviewed)) return null;
  const late = found.filter((q) => q.at !== null && Date.parse(q.at) > reviewed);
  return late.length === 0 ? null
    : `the director answered ${late.length === 1 ? 'a question' : `${late.length} questions`} on ${work} after this version was reviewed, and no newer version carries the answer yet`;
}
