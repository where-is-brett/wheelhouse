// tests/helpers/director-steps.js
// The steps the director-path tests share (tests/e2e/director-paths*.test.js), over the world in director-world.js: a front
// desk recording work and asking its card, a change merging, and the check that nothing told to the director in a terminal
// speaks of a panel.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inDirectorWorld } from './director-world.js';
import { approving } from '../eval/build-loop/engine-recordings.js';

// Every line the director was given in any test of the file, kept for the file's last test.
export const TOLD = [];
export const world = (options, fn) => inDirectorWorld(options, async (w) => {
  try {
    return await fn(w);
  } finally {
    TOLD.push(...w.told);
  }
});

// The front desk's approve-work card for `work`, recorded with `record` first.
export const approvalOf = (w, work) => w.desk(['card'], {
  kind: 'approve-work', level: 3, what: `Add the ${work} change.`, why: 'Users will see it, so it is shown to you first.',
  options: [{ label: 'Approve', says: 'It is built and shown to you before it merges.' }], recommend: 'Approve', because: 'it is small', meanwhile: 'Nothing starts.',
  target: { work, lane: 'small', hash: w.hashes[work] },
});
// The front desk recording a piece of work, with its brief in the folder's own section.
export const record = async (w, work, { lane, visible, title = `The ${work} change`, from }) => {
  const doc = w.writeDoc(work);
  const got = await w.desk(['record', 'work'], { id: work, title, lane, visible, dependsOn: [], doc, ...(from ? { from } : {}) });
  assert.equal(got.code, 0, got.err);
  w.hashes[work] = got.json.hash;
  return got;
};
export const waitingCards = async (w) => (await w.desk(['views', 'waiting'])).out;
export const approveCards = (w) => w.records('card').filter((c) => /^Approve .* as written/.test(c.data.line ?? ''));
export const merged = (w, pr) => w.tickUntil(() => (w.changeOf(pr)?.state === 'merged' ? w.changeOf(pr) : null), `change ${pr} to merge`);

// The events the foreman's wakes among `lines` (a watch's) carry, as { type, work }.
export function foremanWakes(lines) {
  return lines.filter((l) => /^WAKE foreman /.test(l)).flatMap((l) => {
    const wake = JSON.parse(fs.readFileSync(l.replace(/^WAKE foreman /, ''), 'utf8'));
    return [...(wake.events ?? []), ...(wake.digest ?? [])].map((e) => ({ type: e.type, work: e.work }));
  });
}

// Visible work is shown first: the run asks for the director's approval of its change, a merge card comes, the director's
// press is signed, the run goes on and the change is marked ready. Resolves the merged change. `recordings` is the object the
// world's engine reads, to which the run's ask is added knowing the head (so the change is made before the run starts).
export async function startsAndMergesShownFirst(w, work, change, { pr }) {
  const made = await w.branchFor(work, change);
  w.recordings[work] = approving(work, { pr, head: made.head });
  await w.tick();
  assert.equal(w.starts().filter((s) => s.order.work === work).length, 1, 'the work started by itself');
  const build = await w.build(work, { ...change, ready: false });
  assert.deepEqual(build.checks, { done: 0, protected: 0, control: 0 }, 'the guard checks pass');
  assert.equal(build.pr, pr);
  await w.tick();
  const asked = await w.desk(['cards']);
  const why = async () => `${JSON.stringify(asked)} | waiting: ${await waitingCards(w)} | cards: ${JSON.stringify(w.records('card').map((c) => [c.data.line, c.data.question?.slice(0, 60)]))} | asks: ${JSON.stringify(w.records('ask').map((c) => c.data))}`;
  assert.equal(asked.json.questions.length, 1, `a clean review leads to one merge card: ${await why()}`);
  await w.press(asked.json.questions[0], 'Approve');
  w.engine.setOutput(build.runId, 'approval', JSON.stringify({ decision: 'approve', text: '' }));
  const marked = await build.ticketed.engine.ready({ runId: build.runId });
  assert.equal(marked.ok, true, marked.refused);
  return merged(w, pr);
}

// Nothing told to the director in a terminal speaks of a panel: there is none beside the chat.
export function assertNoPanelWords(told = TOLD) {
  const lines = told.filter((line) => typeof line === 'string' && line.trim() !== '');
  assert.ok(lines.length > 5, 'the tests told the director something');
  assert.deepEqual(lines.filter((line) => /\bpanels?\b/i.test(line)), [], 'a line for a terminal speaks of a panel');
}
