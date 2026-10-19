// tests/scripts/lib/command-path.test.js
// A path as an allow rule's command names it: the form the foreman's rules have always had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandPath } from '../../../scripts/lib/command-path.js';
import { foremanCommands } from '../../../scripts/foreman/tools.js';

test('commandPath gives the foreman\'s rules the same form as before', () => {
  assert.equal(commandPath('/plugins/wheelhouse', { platform: 'darwin' }), "'/plugins/wheelhouse'");
  assert.equal(commandPath('/plugins/wheelhouse/', { platform: 'darwin' }), "'/plugins/wheelhouse'", 'a trailing slash is dropped');
  assert.equal(commandPath('C:\\Users\\a b\\plugins\\wheelhouse', { platform: 'win32' }), "'C:/Users/a b/plugins/wheelhouse'");
  assert.equal(commandPath('D:/plugins/wheelhouse', { platform: 'win32' }), "'D:/plugins/wheelhouse'");
  assert.equal(commandPath('C:\\Users\\JOSE~1\\x', { platform: 'win32' }), "'C:/Users/JOSE~1/x'");
  assert.equal(commandPath('/home/田中/x', { platform: 'linux' }), "'/home/田中/x'");

  // The foreman's commands are built on it, exactly as they were.
  assert.deepEqual(foremanCommands('/plugins/wheelhouse/', { platform: 'darwin' }), {
    wake: "node '/plugins/wheelhouse/scripts/foreman/wake.js'",
    act: "node '/plugins/wheelhouse/scripts/foreman/act.js'",
  });
  assert.deepEqual(foremanCommands('C:\\Users\\a b\\plugins\\wheelhouse', { platform: 'win32' }), {
    wake: "node 'C:/Users/a b/plugins/wheelhouse/scripts/foreman/wake.js'",
    act: "node 'C:/Users/a b/plugins/wheelhouse/scripts/foreman/act.js'",
  });
});

test('commandPath refuses a path that could change what the rule means', () => {
  for (const bad of ['relative/x', '/a/*', '/a/"b', "/a/'b", '/a/$HOME', '/a\nb', '/a\\b', '/a/%P%', '/a(b)', '/a,b', '/a  b', '/a/ b', '/a:b', '', null, 7]) {
    assert.throws(() => commandPath(bad, { platform: 'darwin' }), /allow rule/, String(bad));
  }
  for (const bad of ['\\\\server\\share\\x', 'x', 'C:\\a:b', "C:\\a'b", 'C:\\a%b%', 'C:relative']) {
    assert.throws(() => commandPath(bad, { platform: 'win32' }), /allow rule/, bad);
  }
});
