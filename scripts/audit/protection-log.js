// scripts/audit/protection-log.js
// What the audit report keeps between its runs: the project's protection as the last report read it,
// and the changes found since, so that a host with no audit events (GitLab Free) can still be asked
// "did the protection change?" by comparing. It is kept in the Wheelhouse folder, in the project's own
// folder there (<wheelhouse home>/projects/<project>/audit/protection.json), never in the project's
// checkout, where an agent could change it. The changes are kept as well as the reading, so running
// the report again shows a change again and never loses it.
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome, stateDir } from '../lib/paths.js';

const MOST_CHANGES = 500;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Where the report says it is kept, written from the Wheelhouse folder so it names no one's account.
export const protectionLogPlace = (project) => `projects/${project}/audit/protection.json`;

export function protectionLogFile(project) {
  stateDir(project); // refuses a name that is not a folder name
  return path.join(wheelhouseHome(), ...protectionLogPlace(project).split('/'));
}

function validSnapshot(snapshot) {
  return isPlain(snapshot) && typeof snapshot.at === 'string' && isPlain(snapshot.branches)
    && Object.values(snapshot.branches).every((b) => isPlain(b) && Array.isArray(b.push) && Array.isArray(b.merge) && typeof b.force === 'boolean')
    && typeof snapshot.pipelinesMustSucceed === 'boolean' && typeof snapshot.skippedPipelineCounts === 'boolean';
}
const validChange = (c) => isPlain(c) && typeof c.what === 'string' && typeof c.observedAt === 'string';

// The kept log: { snapshot, changes, damaged }. No file is no earlier report; a file that cannot be
// read is `damaged: true` and starts afresh.
export function readProtectionLog(project) {
  let text;
  try {
    text = fs.readFileSync(protectionLogFile(project), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { snapshot: null, changes: [], damaged: false };
    return { snapshot: null, changes: [], damaged: true };
  }
  try {
    const kept = JSON.parse(text);
    if (!validSnapshot(kept?.snapshot) || !Array.isArray(kept.changes) || !kept.changes.every(validChange)) throw new Error('shape');
    return { snapshot: kept.snapshot, changes: kept.changes, damaged: false };
  } catch {
    return { snapshot: null, changes: [], damaged: true };
  }
}

export function writeProtectionLog(project, { snapshot, changes }) {
  const file = protectionLogFile(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ v: 1, snapshot, changes: changes.slice(-MOST_CHANGES) }, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// The report's `protectionEvents` for a project: asks the adapter with the earlier reading, and on a
// host that compares (no audit events) keeps the new reading and the changes it found. Changes
// first seen before `since` are not shown. Where the host has audit events, nothing is kept.
export function keepingProtection({ project, adapter, now = () => new Date() }) {
  return async ({ since }) => {
    const log = readProtectionLog(project);
    const at = now();
    const result = await adapter.protectionEvents({ since, last: log.snapshot, now: at });
    if (result.source !== 'compared') return result;
    const seen = at.toISOString();
    const changes = [...log.changes, ...result.events.map((e) => ({ what: e.what, between: e.between ?? null, observedAt: seen }))];
    let kept = true;
    try {
      writeProtectionLog(project, { snapshot: result.snapshot, changes });
    } catch {
      kept = false;
    }
    return {
      source: 'compared',
      first: log.snapshot === null,
      damaged: log.damaged,
      kept,
      events: changes.slice(-MOST_CHANGES).filter((c) => c.observedAt >= since).map((c) => ({ at: null, by: null, what: c.what, between: c.between })),
    };
  };
}
