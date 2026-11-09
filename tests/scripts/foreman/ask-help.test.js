// tests/scripts/foreman/ask-help.test.js
// The question put to the director when an approved document has changed since its approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driftAskCommand, driftQuestion } from '../../../scripts/foreman/ask-help.js';
import { questionProblem } from '../../../scripts/cards/compose.js';

for (const restorable of [true, false]) {
  test(`the drift question is a card the composer accepts (restorable ${restorable})`, () => {
    const q = driftQuestion('export-csv', { restorable });
    assert.equal(questionProblem({ id: 'q-export-csv-1000001', work: 'export-csv', ...q }), null);
    assert.equal(q.level, 3);
    assert.equal(q.options.map((o) => o.label).includes('Restore the approved text'), restorable);
    assert.equal(q.recommendation, restorable ? 'Restore the approved text' : 'Re-approve the change');
    assert.equal(q.options[0].label, q.recommendation);
    for (const o of q.options) assert.ok(o.says.length < 300);
    const command = driftAskCommand('export-csv', { restorable });
    assert.ok(command.startsWith('act ask export-csv --what '));
    assert.ok(command.endsWith(' --about start'));
    assert.ok(command.includes(`--recommend '${q.recommendation}'`));
  });
}
