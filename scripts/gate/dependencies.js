// scripts/gate/dependencies.js
// The runtime dependencies a manifest names, and which of them changed between two versions of it (the decision line,
// design section 5: a new major dependency or framework, or swapping one, is the director's). A manifest is read by its
// file name, in any folder: package.json, pyproject.toml, requirements.txt, go.mod, Cargo.toml and Gemfile. Only what a
// running product needs counts: development, test and build dependencies are tooling, which agents decide.
//
// A change is a dependency added, one removed (a swap is both) or one whose major version moved. A version that has no
// number to compare, such as "*" or a git address, is judged changed when its text changed: unsure is the director's.

const base = (file) => file.split('/').at(-1);

// Name to version text. Each reader may throw on text it can't read; the caller treats that as a change.
const lines = (text) => text.split(/\r?\n/);

function fromPackageJson(text) {
  const parsed = JSON.parse(text);
  const found = new Map();
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const list = parsed?.[section];
    if (list === null || typeof list !== 'object' || Array.isArray(list)) continue;
    for (const [name, version] of Object.entries(list)) found.set(name, String(version));
  }
  return found;
}

const REQUIREMENT = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:(?:===|==|~=|>=|<=|!=|>|<)\s*([^\s;,#]+))?/;

function requirement(text, found) {
  const m = REQUIREMENT.exec(text.trim());
  if (m !== null) found.set(m[1].toLowerCase().replaceAll('_', '-'), m[2] ?? '');
}

function fromRequirements(text) {
  const found = new Map();
  for (const raw of lines(text)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('-')) continue;
    requirement(line, found);
  }
  return found;
}

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');

// The sections of a TOML file as `{ name, body: [line] }`; a line outside a section is in the section named "".
function sections(text) {
  const out = [{ name: '', body: [] }];
  for (const raw of lines(text)) {
    const line = raw.replace(/^\s*#.*$/, '');
    const head = /^\s*\[([^\][]+)\]\s*$/.exec(line);
    if (head !== null) out.push({ name: head[1].trim(), body: [] });
    else out.at(-1).body.push(line);
  }
  return out;
}

// `key = "1.2"` and `key = { version = "1.2", ... }` lines of a section's body.
function tableDependencies(body, found, skip = []) {
  for (const line of body) {
    const m = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m === null || skip.includes(m[1])) continue;
    const inline = /version\s*=\s*["']([^"']*)["']/.exec(m[2]);
    found.set(m[1], inline !== null ? inline[1] : /^["']/.test(m[2]) ? unquote(m[2]) : '');
  }
}

function fromPyproject(text) {
  const found = new Map();
  for (const { name, body } of sections(text)) {
    if (name === 'tool.poetry.dependencies') tableDependencies(body, found, ['python']);
    if (name !== 'project') continue;
    const joined = body.join('\n');
    const start = /^\s*dependencies\s*=\s*\[/m.exec(joined);
    if (start === null) continue;
    const rest = joined.slice(start.index + start[0].length);
    const end = rest.indexOf(']');
    for (const m of (end < 0 ? rest : rest.slice(0, end)).matchAll(/["']([^"']+)["']/g)) requirement(m[1], found);
  }
  return found;
}

function fromCargo(text) {
  const found = new Map();
  for (const { name, body } of sections(text)) {
    if (name === 'dependencies') tableDependencies(body, found);
    const sub = /^dependencies\.(.+)$/.exec(name);
    if (sub !== null) {
      const version = body.map((l) => /^\s*version\s*=\s*["']([^"']*)["']/.exec(l)?.[1]).find((v) => v !== undefined);
      found.set(sub[1].trim(), version ?? '');
    }
  }
  return found;
}

function fromGoMod(text) {
  const found = new Map();
  let block = false;
  for (const raw of lines(text)) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) { block = true; continue; }
    if (block && line === ')') { block = false; continue; }
    const body = block ? line : /^require\s+(\S.*)$/.exec(line)?.[1];
    if (body === undefined || body === '' || /\/\/\s*indirect/.test(body)) continue;
    const m = /^(\S+)\s+(v\S+)/.exec(body);
    // A module's major versions from 2 on end its path in /vN: the same module.
    if (m !== null) found.set(m[1].replace(/\/v\d+$/, ''), m[2]);
  }
  return found;
}

function fromGemfile(text) {
  const found = new Map();
  let skipping = 0;
  for (const raw of lines(text)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (/^group\s.*\b(development|test)\b.*\bdo$/.test(line)) { skipping = 1; continue; }
    if (skipping > 0) {
      if (/\bdo$/.test(line)) skipping += 1;
      else if (line === 'end') skipping -= 1;
      continue;
    }
    const m = /^gem\s+["']([^"']+)["'](?:\s*,\s*["']([~><=!]*\s*\d[^"']*)["'])?/.exec(line);
    if (m !== null) found.set(m[1], m[2] ?? '');
  }
  return found;
}

const READERS = Object.freeze({
  'package.json': fromPackageJson,
  'pyproject.toml': fromPyproject,
  'requirements.txt': fromRequirements,
  'go.mod': fromGoMod,
  'Cargo.toml': fromCargo,
  Gemfile: fromGemfile,
});

export const isManifest = (file) => Object.hasOwn(READERS, base(file));

const majorOf = (version) => {
  const m = /\d+/.exec(version);
  return m === null ? null : Number(m[0]);
};

// Whether a dependency's version moved a major version (or can't be told).
function movedMajor(was, now) {
  if (was === now) return false;
  const a = majorOf(was);
  const b = majorOf(now);
  return a === null || b === null || a !== b;
}

// Whether the manifest `file` changed a runtime dependency. `read(file, 'base' | 'head')` gives its text on each side, or
// null where it isn't there. A manifest that can't be read, or read at all, counts as changed.
export function changesDependencies(file, read) {
  const reader = READERS[base(file)];
  if (reader === undefined) return false;
  try {
    const before = read(file, 'base');
    const after = read(file, 'head');
    const was = before === null || before === undefined ? new Map() : reader(before);
    const now = after === null || after === undefined ? new Map() : reader(after);
    for (const [name, version] of now) if (!was.has(name) || movedMajor(was.get(name), version)) return true;
    for (const name of was.keys()) if (!now.has(name)) return true;
    return false;
  } catch {
    return true;
  }
}
