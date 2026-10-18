// tests/scripts/mod/validate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMod, membersIn, HOOKS, CALLS } from '../../../scripts/mod/validate.js';
import { SIGNED_LABELS } from '../../../scripts/hooks/prompt-record.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FOUR = 'session.start, session.measure, prompt.submit, command.run{command=go}';
const SOURCE = 'export const register = (on) => { on("session.start", async ($, e, next) => { await $.process.run(["node", `${$.plugin.root}/x.js`]); return next(e) }) }';

// The report `claude plugin validate --json` gives, with the hooks file's notes.
function reportWith(notes, { success = true, errors = [] } = {}) {
  return {
    success,
    manifest: { type: 'marketplace', errors: [], notes: [] },
    contents: [
      { type: 'plugin', errors: [], notes: [] },
      { type: 'hooks', errors, notes },
    ],
  };
}

test('the mod passes with exactly the four hooks and the calls the bridge needs', () => {
  const result = checkMod({
    report: reportWith([`./register.ts hooks: ${FOUR}`, `./register.ts calls: ${CALLS.join(', ')}`]),
    source: SOURCE,
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.hooks, HOOKS);
  assert.deepEqual(result.calls, CALLS);
});

test('a call made inside one of the module\'s own functions is read without its "via"', () => {
  const result = checkMod({
    report: reportWith([`./register.ts hooks: ${FOUR}`, './register.ts calls: $.process.run (via ask), $.session.id (via a, b), $.ui.toast']),
    source: SOURCE,
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.calls, ['$.process.run', '$.session.id', '$.ui.toast']);
});

test('a hook beyond the four, or one missing, fails', () => {
  const extra = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}, tool.call`]), source: SOURCE });
  assert.match(extra.problems.join('\n'), /tool\.call/);
  const missing = checkMod({ report: reportWith(['./register.ts hooks: session.start, prompt.submit']), source: SOURCE });
  assert.match(missing.problems.join('\n'), /session\.measure/);
  assert.match(missing.problems.join('\n'), /command\.run\{command=go\}/);
  const none = checkMod({ report: reportWith([]), source: SOURCE });
  assert.notDeepEqual(none.problems, []);
});

test('a call the brief does not name fails, in the report or in the source', () => {
  const reported = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}`, './register.ts calls: $.process.run, $.fs.write']), source: SOURCE });
  assert.match(reported.problems.join('\n'), /\$\.fs\.write/);
  const scanned = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}`]), source: `${SOURCE} const p = $.process; $.http.fetch("x")` });
  assert.match(scanned.problems.join('\n'), /\$\.http\.fetch/);
  assert.match(scanned.problems.join('\n'), /\$\.process\b/);
});

test('a report that failed, or holds errors, fails', () => {
  const notes = [`./register.ts hooks: ${FOUR}`];
  assert.notDeepEqual(checkMod({ report: reportWith(notes, { success: false }), source: SOURCE }).problems, []);
  assert.notDeepEqual(checkMod({ report: reportWith(notes, { errors: [{ path: 'modules', message: 'bad' }] }), source: SOURCE }).problems, []);
  assert.notDeepEqual(checkMod({ report: null, source: SOURCE }).problems, []);
});

test('the source scan reads member calls on $ and leaves comments out', () => {
  const text = '// $.fs.write is never used\n/* nor $.http.fetch */\nconst a = await $.session.id(); $.ui.toast(`${$.plugin.root}`)';
  assert.deepEqual(membersIn(text), ['$.plugin.root', '$.session.id', '$.ui.toast']);
});

test('the mod in hooks/register.ts calls only what the brief names', () => {
  const source = fs.readFileSync(path.join(ROOT, 'hooks', 'register.ts'), 'utf8');
  const allowed = new Set([...CALLS, '$.plugin.root']);
  for (const member of membersIn(source)) assert.ok(allowed.has(member), member);
});

test('the options the mod sends as a reply are the signed labels', () => {
  const source = fs.readFileSync(path.join(ROOT, 'hooks', 'register.ts'), 'utf8');
  const list = /^const LABELS = (\[[^\]]*\])$/m.exec(source);
  assert.ok(list, 'hooks/register.ts names its LABELS on one line');
  assert.deepEqual(JSON.parse(list[1].replaceAll("'", '"')), SIGNED_LABELS);
});

test('hooks.json names the mod beside the command hooks', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(file.modules, ['./register.ts']);
});

test('npm test leaves the mod\'s tests to npm run mod-check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['mod-check'], 'node scripts/mod/validate.js && claude plugin test .');
  assert.match(pkg.scripts.test, /"tests\/\*\*\/\*\.test\.js"$/);
});
