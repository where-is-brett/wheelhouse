// scripts/gate/guardrails.js
// What a pull request's changed files say about the merge gate (design section
// 12.4): whether they touch the guardrails (so the director must approve), and
// which of the project's critical areas they are in.
//
// The project's configuration is .claude/wheelhouse.json on the default branch:
//   Config = { v: 1, criticalAreas: [{ name, paths: [glob], checks: [glob] }],
//              ciFiles: [glob], mcpServers: [string], webDomains: [string],
//              runbook?: { contain?: { describe: string, command: [string] } } }
// Other keys are kept and ignored.
import { matchGlob } from './glob.js';

// The Claude Code settings, the Wheelhouse configuration inside .claude/,
// CLAUDE.md, and .mcp.json (it names the connectors agents get).
export const GUARDRAILS = ['.claude/**', '**/CLAUDE.md', '.mcp.json'];
export const CI_FILES = ['.github/workflows/**', '.github/actions/**', '.gitlab-ci.yml', '.gitlab/**'];

const UNREADABLE = 'The project\'s Wheelhouse configuration can\'t be read';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const strings = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');
// A glob with an empty segment (a leading, trailing or doubled `/`) would never match.
const globs = (x) => strings(x) && x.every((s) => s !== '' && s.split('/').every((seg) => seg !== ''));

function emptyConfig() {
  return { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
}

function shapeOk(c) {
  if (!isObject(c) || c.v !== 1) return false;
  if (!Array.isArray(c.criticalAreas) || !c.criticalAreas.every((a) => (
    isObject(a) && typeof a.name === 'string' && globs(a.paths) && globs(a.checks)
  ))) return false;
  if (!globs(c.ciFiles) || !strings(c.mcpServers) || !strings(c.webDomains)) return false;
  if (c.runbook !== undefined) {
    if (!isObject(c.runbook)) return false;
    const contain = c.runbook.contain;
    if (contain !== undefined && !(isObject(contain) && typeof contain.describe === 'string' && contain.describe !== '' && strings(contain.command)
      && contain.command.length > 0 && contain.command[0] !== '')) return false;
  }
  return true;
}

// `null` (no file) is the empty configuration. Anything else must parse and fit
// the shape, or this throws.
export function readConfig(text) {
  if (text === null) return emptyConfig();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(UNREADABLE);
  }
  if (!shapeOk(parsed)) throw new Error(UNREADABLE);
  return parsed;
}

// Case is ignored: on macOS and Windows a file named .Claude/settings.json is
// the real one, and a false match only fails closed.
const matchesAny = (patterns, file) => patterns.some((p) => matchGlob(p, file, { ignoreCase: true }));

export function classifyChange({ paths, config }) {
  const patterns = [
    ...GUARDRAILS, ...CI_FILES, ...config.ciFiles, ...config.criticalAreas.flatMap((a) => a.checks),
  ];
  const guardrailPaths = paths.filter((file) => matchesAny(patterns, file));
  const criticalAreas = config.criticalAreas
    .filter((area) => paths.some((file) => matchesAny(area.paths, file)))
    .map((area) => area.name);
  return { touchesGuardrails: guardrailPaths.length > 0, guardrailPaths, criticalAreas };
}
