// tests/probes/lib/windows.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foremanCommands } from '../../../scripts/foreman/tools.js';
import {
  commandPath, encodePowerShell, integrityOf, judgeAccess, labelResult, labelScript, mxcBuildReached,
  parseBuild, parseTry, parseUbr, psQuote, reportLine, runnerRule, runnerPrefix,
} from '../../../probes/lib/windows.js';

const GROUPS = (sid, name) => `
GROUP INFORMATION
-----------------

Group Name                             Type             SID          Attributes
====================================== ================ ============ ==================================================
Everyone                               Well-known group S-1-1-0      Mandatory group, Enabled by default, Enabled group
${name.padEnd(38)} Label            ${sid}  Mandatory group, Enabled by default, Enabled group
`;

test('integrityOf reads the level from whoami /groups', () => {
  assert.equal(integrityOf(GROUPS('S-1-16-4096', 'Mandatory Label\\Low Mandatory Level')), 'low');
  assert.equal(integrityOf(GROUPS('S-1-16-8192', 'Mandatory Label\\Medium Mandatory Level')), 'medium');
  assert.equal(integrityOf(GROUPS('S-1-16-12288', 'Mandatory Label\\High Mandatory Level')), 'high');
  assert.equal(integrityOf('Everyone  Well-known group  S-1-1-0\r\n'), null);
  assert.equal(integrityOf(undefined), null);
  assert.equal(integrityOf('Mandatory Label\\X  S-1-16-40960'), null);
});

test('commandPath gives the form the foreman\'s rules use', () => {
  const root = 'C:\\Users\\Jo Smith\\.wheelhouse\\plugin';
  const script = `${root}\\scripts\\foreman\\wake.js`;
  assert.equal(commandPath(script, { platform: 'win32' }), "'C:/Users/Jo Smith/.wheelhouse/plugin/scripts/foreman/wake.js'");
  assert.equal(foremanCommands(root, { platform: 'win32' }).wake, `node ${commandPath(script, { platform: 'win32' })}`);
  assert.equal(commandPath('/opt/wheelhouse/x.js', { platform: 'linux' }), "'/opt/wheelhouse/x.js'");
});

test('commandPath refuses a path that could change what a rule means', () => {
  for (const bad of ["C:\\Users\\a'b\\x", 'C:\\Users\\a"b', 'C:\\Users\\a%b', 'C:\\Users\\a(b)', 'C:\\Users\\a*b', 'relative\\x', 'C:\\Users\\a  b']) {
    assert.throws(() => commandPath(bad, { platform: 'win32' }), /can't be written into an allow rule/, bad);
  }
});

test('the runner rule is the low node, the runner and :*', () => {
  const rule = runnerRule('C:\\Temp\\bin\\node-low.exe', 'C:\\Temp\\runner\\guarded.js', { platform: 'win32' });
  assert.equal(rule, "Bash('C:/Temp/bin/node-low.exe' 'C:/Temp/runner/guarded.js':*)");
  assert.equal(runnerPrefix('C:\\Temp\\bin\\node-low.exe', 'C:\\Temp\\runner\\guarded.js', { platform: 'win32' }), "'C:/Temp/bin/node-low.exe' 'C:/Temp/runner/guarded.js'");
});

test('PowerShell helpers quote and encode', () => {
  assert.equal(psQuote("C:\\Users\\O'Brien"), "'C:\\Users\\O''Brien'");
  assert.equal(Buffer.from(encodePowerShell('Write-Output 1'), 'base64').toString('utf16le'), 'Write-Output 1');
  const script = labelScript("C:\\Temp\\lock'dir");
  assert.match(script, /SetNamedSecurityInfoW/);
  assert.match(script, /S:\(ML;OICI;NWNR;;;ME\)/);
  assert.match(script, /'C:\\Temp\\lock''dir'/);
  assert.equal(labelResult('noise\nLABEL_RESULT=0\n'), 0);
  assert.equal(labelResult('LABEL_RESULT=5'), 5);
  assert.equal(labelResult('Add-Type : cannot'), null);
});

test('reportLine makes one line', () => {
  assert.equal(reportLine('PASS', 'low-node-starts-at-low', 'shows low'), 'PASS low-node-starts-at-low: shows low');
  assert.equal(reportLine('SEEN', 'node-version'), 'SEEN node-version');
  assert.equal(reportLine('FAIL', 'x', 'two\r\nlines'), 'FAIL x: two lines');
  assert.throws(() => reportLine('MAYBE', 'x'), /Not a status/);
});

test('parseTry takes the last JSON object line, and judgeAccess reads it', () => {
  assert.deepEqual(parseTry('noise\n{"ok":false}\n{"ok":true,"text":"a"}\n'), { ok: true, text: 'a' });
  assert.equal(parseTry('nothing here'), null);
  assert.equal(judgeAccess({ ok: true }), 'allowed');
  assert.equal(judgeAccess({ ok: false, code: 'EPERM', message: 'operation not permitted' }), 'refused');
  assert.equal(judgeAccess({ ok: false, code: 'EXIT', stderr: 'ERROR: Access is denied.' }), 'refused');
  assert.equal(judgeAccess({ ok: false, code: 'ENOENT', message: 'no such file' }), 'other');
  assert.equal(judgeAccess(null), 'other');
});

test('the Windows build and the Execution Containers threshold', () => {
  assert.deepEqual(parseBuild('Microsoft Windows [Version 10.0.26100.9278]'), { major: 26100, revision: 9278 });
  assert.deepEqual(parseBuild('10.0.26200', 9300), { major: 26200, revision: 9300 });
  assert.equal(parseBuild('nothing'), null);
  assert.equal(parseUbr('    UBR    REG_DWORD    0x244e'), 9294);
  assert.equal(mxcBuildReached({ major: 26100, revision: 9278 }), true);
  assert.equal(mxcBuildReached({ major: 26200, revision: 9277 }), false);
  assert.equal(mxcBuildReached({ major: 22631, revision: 4000 }), false);
  assert.equal(mxcBuildReached({ major: 26100, revision: null }), null);
  assert.equal(mxcBuildReached({ major: 27000, revision: 1 }), true);
});
