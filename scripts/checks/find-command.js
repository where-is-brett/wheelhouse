// scripts/checks/find-command.js
// Finds a project's test command with no question (spec 4.5). A script, not an agent: it reads what the project holds, first
// match wins, and runs nothing. `list()` gives the project's files as paths with forward slashes, and `read(file)` a file's
// text, or null. The helper hands in the default branch's own; by default they read `folder`.
import fs from 'node:fs';
import path from 'node:path';
import { hostlessTests } from './run.js';

const PACKAGE_SWITCHES = '-IDEPackageSupportDisableManifestSandbox=YES -IDEPackageSupportDisablePackageSandbox=YES';
const OUTPUT = '.build/checks';
// Folders no project's own Xcode project or settings live in. A package's `.swiftpm` holds a workspace Xcode wrote.
const NOT_THE_PROJECTS = /(^|\/)(\.git|\.swiftpm|\.build|node_modules|Pods|Carthage|DerivedData)(\/|$)/;
const MOST_DEPTH = 4;

// One word of a shell command.
const shellWord = (text) => `'${text.replaceAll("'", "'\\''")}'`;

// Whether package.json's text has a test script of its own: npm's placeholder only fails.
export function hasTestScript(text) {
  try {
    const test = JSON.parse(text)?.scripts?.test;
    return typeof test === 'string' && test.trim() !== '' && !/no test specified/.test(test);
  } catch {
    return false;
  }
}

function walked(folder) {
  const files = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(folder, dir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (NOT_THE_PROJECTS.test(rel)) continue;
      if (entry.isFile()) files.push(rel);
      else if (entry.isDirectory() && depth < MOST_DEPTH) walk(rel, depth + 1);
    }
  };
  walk('', 0);
  return files;
}

const baseName = (file) => file.slice(file.lastIndexOf('/') + 1);
const withoutExtension = (name) => name.slice(0, name.lastIndexOf('.'));

// The Xcode project or workspace and its shared scheme, or null. A workspace comes first, and takes the schemes of the
// projects beside it, since a workspace often has none of its own.
function xcodeRow(files) {
  const own = files.filter((file) => !NOT_THE_PROJECTS.test(file));
  const containers = (extension) => [...new Set(own.flatMap((file) => {
    const at = file.indexOf(`${extension}/`);
    if (at < 0) return [];
    const container = file.slice(0, at + extension.length);
    return container.endsWith(`.xcodeproj/project${extension}`) ? [] : [container];
  }))].sort();
  const workspaces = containers('.xcworkspace');
  const projects = containers('.xcodeproj');
  const container = workspaces[0] ?? projects[0];
  if (container === undefined) return null;
  const schemes = own.filter((file) => /\.(xcworkspace|xcodeproj)\/xcshareddata\/xcschemes\/[^/]+\.xcscheme$/.test(file)).map((file) => withoutExtension(baseName(file))).sort();
  if (schemes.length === 0) return null;
  const named = withoutExtension(baseName(container));
  const scheme = schemes.includes(named) ? named : schemes[0];
  const flag = container.endsWith('.xcworkspace') ? '-workspace' : '-project';
  const target = `${flag} ${shellWord(container)} -scheme ${shellWord(scheme)}`;
  // `xcodebuild test` can't run in the check's sandbox (spec 4.5), so the finder writes what can, straight away.
  const build = `xcodebuild build-for-testing ${target} -destination 'platform=macOS' -derivedDataPath ${OUTPUT} ${PACKAGE_SWITCHES} CODE_SIGNING_ALLOWED=NO`;
  return { testCommand: hostlessTests(build, OUTPUT), prepare: `xcodebuild -resolvePackageDependencies ${target} ${PACKAGE_SWITCHES}`, why: 'an Xcode project' };
}

// findCommand({ folder, config, read, list }) -> { testCommand, prepare, why } | null.
export function findCommand({ folder, config = {}, read = null, list = null }) {
  if (typeof config?.testCommand === 'string') return { testCommand: config.testCommand, prepare: config.checks?.prepare ?? null, why: 'the project names it' };
  const files = list ? list() : walked(folder);
  const readFile = read ?? ((file) => {
    try { return fs.readFileSync(path.join(folder, file), 'utf8'); } catch { return null; }
  });
  const holds = (file) => files.includes(file);

  const xcode = xcodeRow(files);
  if (xcode !== null) return xcode;
  // One at a time: a refused service can stall a full pool of parallel Swift tests until the time limit (check 82).
  if (holds('Package.swift')) return { testCommand: 'swift test --disable-sandbox --no-parallel', prepare: 'swift package resolve --disable-sandbox', why: 'a Swift package' };
  if (holds('package.json') && hasTestScript(readFile('package.json'))) {
    const locked = holds('package-lock.json') || holds('npm-shrinkwrap.json');
    return { testCommand: 'npm test', prepare: locked ? 'npm ci' : null, why: 'a test script in package.json' };
  }
  if (holds('Cargo.toml')) return { testCommand: 'cargo test', prepare: 'cargo fetch', why: 'a Rust package' };
  if (holds('go.mod')) return { testCommand: 'go test ./...', prepare: 'go mod download', why: 'a Go module' };
  if (holds('pyproject.toml') || holds('pytest.ini')) return { testCommand: 'python3 -m pytest', prepare: null, why: 'a Python project' };
  if (holds('Makefile') && /^test\s*:/m.test(readFile('Makefile') ?? '')) return { testCommand: 'make test', prepare: null, why: 'a test target in the Makefile' };
  return null;
}
