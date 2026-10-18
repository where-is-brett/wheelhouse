// scripts/lineage/register.js
// The register: what Wheelhouse lays on top of the upstream kits (lineage/register.json).
// Overrides are Wheelhouse's rules, each anchored on the upstream's own sentence it
// overrides. Carried text is what Wheelhouse copies word for word. Assumptions are what
// the design relies on in Claude Code, each with the check behind it. An upgrade reads
// the register to tell when an upstream change breaks one.
//   node scripts/lineage/register.js check <upstream>=<folder> [<upstream>=<folder> ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintFile } from './fingerprint.js';

export const REGISTER_PATH = 'lineage/register.json';
export const OVERRIDE_PATH = 'templates/brief/override.md';

const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- Reading ---

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value !== '';

// The register in `root`'s lineage folder; throws when it is missing or is not a register.
export function readRegister(root = repoRoot()) {
  let register;
  try {
    register = JSON.parse(fs.readFileSync(path.join(root, REGISTER_PATH), 'utf8'));
  } catch {
    throw new Error(`The register ${REGISTER_PATH} can't be read`);
  }
  const ok = isObject(register) && register.v === 1 && text(register.version)
    && Array.isArray(register.overrides) && register.overrides.every((o) => isObject(o)
      && ['id', 'upstream', 'skill', 'rule', 'why'].every((key) => text(o[key])) && Number.isInteger(o.scenario)
      && Array.isArray(o.anchors) && o.anchors.length > 0 && o.anchors.every((a) => isObject(a) && text(a.file) && text(a.text)))
    && Array.isArray(register.carried) && register.carried.every((c) => isObject(c)
      && ['id', 'upstream', 'file', 'hash', 'text'].every((key) => text(c[key])))
    && Array.isArray(register.assumptions) && register.assumptions.every((a) => isObject(a)
      && text(a.id) && text(a.says) && Number.isInteger(a.check) && ['script', 'person'].includes(a.retest) && text(a.feature));
  if (!ok) throw new Error(`The register ${REGISTER_PATH} isn't in the form Wheelhouse expects`);
  return register;
}

// --- Checking ---

// The path under `root`, or null when `relative` would leave it.
function under(root, relative) {
  const parts = relative.split('/');
  if (relative === '' || path.isAbsolute(relative) || parts.includes('..')) return null;
  return path.join(root, ...parts);
}

function readText(root, relative) {
  const file = under(root, relative);
  if (file === null) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Each anchor that is not found, word for word, in its file under the root of the
// override's upstream. `roots` maps an upstream's name to a folder (a checkout or an
// installed copy); an upstream with no root is skipped.
export function checkAnchors({ register, roots }) {
  const broken = [];
  for (const override of register.overrides) {
    const root = roots[override.upstream];
    if (!root) continue;
    for (const { file, text: anchor } of override.anchors) {
      const content = readText(root, file);
      if (content === null || !content.includes(anchor)) broken.push({ id: override.id, file, text: anchor });
    }
  }
  return broken;
}

// The id of each carried text whose source file no longer has the fingerprint recorded.
export function checkCarried({ register, roots }) {
  const changed = [];
  for (const carried of register.carried) {
    const root = roots[carried.upstream];
    if (!root) continue;
    const file = under(root, carried.file);
    let hash = null;
    try {
      hash = file === null ? null : fingerprintFile(file).hash;
    } catch {
      hash = null;
    }
    if (hash !== carried.hash) changed.push(carried.id);
  }
  return changed;
}

// The id of each override whose rule does not appear in the override page, so the two can't drift.
export function checkOverrideText({ register, overrideText }) {
  return register.overrides.filter((override) => !overrideText.includes(override.rule)).map((override) => override.id);
}

// --- Command line ---

function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const USAGE = 'usage: node scripts/lineage/register.js check <upstream>=<folder> [<upstream>=<folder> ...]\n';

if (Boolean(process.argv[1]) && startedAsScript()) {
  const [command, ...pairs] = process.argv.slice(2);
  const roots = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0 || at === pair.length - 1) roots.invalid = true;
    else roots[pair.slice(0, at)] = pair.slice(at + 1);
  }
  if (command !== 'check' || pairs.length === 0 || roots.invalid) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  try {
    const register = readRegister();
    const out = (line) => process.stdout.write(`${line}\n`);
    const anchors = checkAnchors({ register, roots });
    const carried = checkCarried({ register, roots });
    const drifted = checkOverrideText({ register, overrideText: fs.readFileSync(path.join(repoRoot(), OVERRIDE_PATH), 'utf8') });
    for (const a of anchors) out(`anchor gone: ${a.id}: ${a.file}: ${a.text}`);
    for (const id of carried) out(`carried text's source changed: ${id}`);
    for (const id of drifted) out(`rule not in ${OVERRIDE_PATH}: ${id}`);
    const skipped = [...new Set([...register.overrides, ...register.carried].map((item) => item.upstream))].filter((name) => !roots[name]);
    if (skipped.length > 0) out(`not checked, no folder given: ${skipped.join(', ')}`);
    const broken = anchors.length + carried.length + drifted.length;
    out(broken === 0 ? 'register ok' : `register broken: ${broken}`);
    process.exit(broken === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
