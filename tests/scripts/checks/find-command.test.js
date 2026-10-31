// tests/scripts/checks/find-command.test.js
// The finder (spec 4.5): what a project holds gives its test command, first match wins, and nothing is run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCommand } from '../../../scripts/checks/find-command.js';

// A project as a list of files, with what each holds.
const found = (files, more = {}) => findCommand({ list: () => Object.keys(files), read: (file) => files[file] ?? null, ...more });

const SWITCHES = '-IDEPackageSupportDisableManifestSandbox=YES -IDEPackageSupportDisablePackageSandbox=YES CODE_SIGNING_ALLOWED=NO';

test('a set testCommand wins, with its own prepare', () => {
  const got = found({ 'Package.swift': '', 'Makefile': 'test:\n' }, { config: { testCommand: 'make check', checks: { prepare: 'make deps' } } });
  assert.equal(got.testCommand, 'make check');
  assert.equal(got.prepare, 'make deps');
});

test('an Xcode project gets the command the sandbox can run, with its shared scheme', () => {
  const got = found({ 'App.xcodeproj/project.pbxproj': '', 'App.xcodeproj/xcshareddata/xcschemes/App.xcscheme': '' });
  assert.match(got.testCommand, /^xcodebuild build-for-testing -project 'App\.xcodeproj' -scheme 'App' -destination 'platform=macOS' -derivedDataPath \.build\/checks /);
  assert.ok(got.testCommand.includes(SWITCHES));
  assert.match(got.testCommand, / TEST_HOST= BUNDLE_LOADER= && for bundle in \.build\/checks\/Build\/Products\/\*\/\*\.xctest; do xcrun xctest "\$bundle" \|\| exit 1; done$/);
  assert.equal(got.prepare, `xcodebuild -resolvePackageDependencies -project 'App.xcodeproj' -scheme 'App' -IDEPackageSupportDisableManifestSandbox=YES -IDEPackageSupportDisablePackageSandbox=YES`);
  assert.ok(!/\sxcodebuild test|\stest\s/.test(got.testCommand), 'never `xcodebuild test`, which the sandbox always refuses');
});

test('a workspace comes before the project in it, and borrows the project\'s scheme', () => {
  const got = found({
    'App.xcworkspace/contents.xcworkspacedata': '', 'App.xcodeproj/project.pbxproj': '', 'App.xcodeproj/xcshareddata/xcschemes/App.xcscheme': '',
  });
  assert.match(got.testCommand, /-workspace 'App\.xcworkspace' -scheme 'App'/);
});

test('several schemes pick the one named after the project, else the first by name', () => {
  const schemes = (...names) => Object.fromEntries(names.map((n) => [`App.xcodeproj/xcshareddata/xcschemes/${n}.xcscheme`, '']));
  assert.match(found({ 'App.xcodeproj/project.pbxproj': '', ...schemes('Zed', 'App', 'Alpha') }).testCommand, /-scheme 'App'/);
  assert.match(found({ 'App.xcodeproj/project.pbxproj': '', ...schemes('Zed', 'Alpha') }).testCommand, /-scheme 'Alpha'/);
});

test('a scheme\'s name can\'t break out of the command', () => {
  const got = found({ 'App.xcodeproj/project.pbxproj': '', "App.xcodeproj/xcshareddata/xcschemes/A'; touch x; '.xcscheme": '' });
  assert.ok(got.testCommand.includes(`-scheme 'A'\\''; touch x; '\\'''`));
});

test('a project with both Package.swift and an xcodeproj uses the xcodeproj', () => {
  const got = found({ 'Package.swift': '', 'App.xcodeproj/project.pbxproj': '', 'App.xcodeproj/xcshareddata/xcschemes/App.xcscheme': '' });
  assert.match(got.testCommand, /^xcodebuild /);
});

test('no shared scheme is not a match for that row', () => {
  const got = found({ 'App.xcodeproj/project.pbxproj': '', 'Package.swift': '' });
  assert.match(got.testCommand, /^swift test/);
  assert.equal(found({ 'App.xcodeproj/project.pbxproj': '' }), null);
});

test('a package\'s own workspace inside .swiftpm is no Xcode project', () => {
  const got = found({ 'Package.swift': '', '.swiftpm/xcode/package.xcworkspace/contents.xcworkspacedata': '', '.swiftpm/xcode/xcshareddata/xcschemes/P.xcscheme': '' });
  assert.match(got.testCommand, /^swift test/);
});

test('a Swift package runs its tests one at a time, since a refused service can stall a parallel run', () => {
  const got = found({ 'Package.swift': '' });
  assert.equal(got.testCommand, 'swift test --disable-sandbox --no-parallel');
  assert.equal(got.prepare, 'swift package resolve --disable-sandbox');
});

test('package.json with a test script is npm test, with npm ci only with a lockfile', () => {
  const pkg = JSON.stringify({ scripts: { test: 'vitest run' } });
  assert.deepEqual([found({ 'package.json': pkg }).testCommand, found({ 'package.json': pkg }).prepare], ['npm test', null]);
  assert.equal(found({ 'package.json': pkg, 'package-lock.json': '{}' }).prepare, 'npm ci');
});

test('npm\'s placeholder, or a package.json that can\'t be read, is no test script', () => {
  assert.equal(found({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }), null);
  assert.equal(found({ 'package.json': '{ not json' }), null);
  assert.equal(found({ 'package.json': '{}' }), null);
});

test('the other rows, one a case', () => {
  const row = (files) => { const got = found(files); return [got.testCommand, got.prepare]; };
  assert.deepEqual(row({ 'Cargo.toml': '' }), ['cargo test', 'cargo fetch']);
  assert.deepEqual(row({ 'go.mod': '' }), ['go test ./...', 'go mod download']);
  assert.deepEqual(row({ 'pyproject.toml': '' }), ['python3 -m pytest', null]);
  assert.deepEqual(row({ 'pytest.ini': '' }), ['python3 -m pytest', null]);
  assert.deepEqual(row({ Makefile: '.PHONY: test\ntest: build\n\tgo vet\n' }), ['make test', null]);
});

test('a Makefile with no test target is nothing', () => {
  assert.equal(found({ Makefile: 'latest:\n\techo\nbuild:\n\techo\n' }), null);
});

test('first match wins, by the table\'s order', () => {
  assert.match(found({ 'package.json': JSON.stringify({ scripts: { test: 'x' } }), 'Cargo.toml': '', 'Makefile': 'test:\n' }).testCommand, /^npm test/);
});

test('every answer says why', () => {
  assert.equal(typeof found({ 'go.mod': '' }).why, 'string');
});

test('an empty folder is null, and a real folder is read without running anything', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-find-'));
  try {
    assert.equal(findCommand({ folder }), null);
    fs.writeFileSync(path.join(folder, 'go.mod'), 'module x\n');
    assert.equal(findCommand({ folder }).testCommand, 'go test ./...');
    fs.mkdirSync(path.join(folder, 'App.xcodeproj', 'xcshareddata', 'xcschemes'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'App.xcodeproj', 'xcshareddata', 'xcschemes', 'App.xcscheme'), '');
    assert.match(findCommand({ folder }).testCommand, /^xcodebuild /);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
