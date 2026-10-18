// scripts/hooks/report-check.js
// Checks the report an agent ends its work with. A builder's or reviewer's report
// that lacks a field is sent back twice, then let through with a note. A complete
// report from Wheelhouse's own reviewer, naming the open pull request's current
// head, is recorded as a signed review. Only this hook signs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runAndExit, projectOf, answer, readTailEntries } from './kit.js';
import { keep, taken, withinBudget, BUDGET_MS } from './pending.js';
import { helperClient } from '../host/helper-client.js';
import { stateDir } from '../lib/paths.js';
import { makeEvent } from '../state/events.js';

const ROLES = { 'wheelhouse:builder': 'builder', 'wheelhouse:reviewer': 'reviewer' };
const SEND_BACKS = 2;
const HEADER = 'WHEELHOUSE REPORT';
const KEY = /^([a-z]+):[ \t]*(.*?)[ \t]*$/;

// The fields of the last report block in `text`, and the names of those that are
// missing or invalid for `role` (the agent's role, when given).
export function parseReport(text, role) {
  const lines = String(text ?? '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) if (lines[i].trim() === HEADER) start = i;
  const fields = {};
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i += 1) {
      const m = KEY.exec(lines[i]);
      if (!m) break;
      if (!Object.hasOwn(fields, m[1])) fields[m[1]] = m[2];
    }
  }
  const bad = [];
  const need = (name, ok) => { if (!ok(fields[name])) bad.push(name); };
  need('role', (v) => (role === undefined ? v === 'builder' || v === 'reviewer' : v === role));
  need('pr', (v) => /^[1-9][0-9]*$/.test(v ?? '') && Number.isSafeInteger(Number(v)));
  need('commit', (v) => /^[0-9a-f]{40}$/.test(v ?? ''));
  const kind = fields.role ?? role;
  if (kind === 'builder') {
    need('status', (v) => ['done', 'blocked', 'partial'].includes(v));
    for (const name of ['tests', 'assumptions', 'concerns']) need(name, (v) => typeof v === 'string' && v !== '');
  } else {
    need('verdict', (v) => v === 'CLEAN' || v === 'FINDINGS');
    if (fields.verdict === 'FINDINGS') need('findings', (v) => /^[0-9]+$/.test(v ?? '') && Number.isSafeInteger(Number(v)));
  }
  if (fields.check !== undefined) need('check', (v) => /^[A-Za-z0-9._-]{1,64} [A-Za-z0-9:+/=._-]{1,128}$/.test(v));
  return { fields, missing: bad };
}

// The version and model of the agent's own transcript's last assistant entry that
// names a real model. Only the last 256 KB is read.
function fromTranscript(file) {
  let last = {};
  for (const entry of readTailEntries(file) ?? []) {
    if (entry?.type !== 'assistant' && entry?.message?.role !== 'assistant') continue;
    const model = entry.message?.model;
    if (typeof model !== 'string' || model === '' || model === '<synthetic>') continue;
    last = { claudeCode: entry.version, model };
  }
  return last;
}

const text = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

function countFile(project, id) {
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(stateDir(project), '..', 'report-check', `${safe}.json`);
}

function readCount(file) {
  try {
    const n = JSON.parse(fs.readFileSync(file, 'utf8')).count;
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Written whole to a temporary name, then renamed over the real one.
function writeCount(file, count) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID().slice(0, 12)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ count })}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

export async function decide(input, { client, now = () => new Date(), projectOf: find = projectOf, dir, budget = BUDGET_MS } = {}) {
  const role = ROLES[input.agent_type];
  if (role === undefined) return undefined;
  const found = find(input.cwd, { dir });
  if (!found) return undefined;
  const project = found.project;
  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);
  const { fields, missing } = parseReport(input.last_assistant_message, role);
  const id = text(input.agent_id) ?? text(input.session_id) ?? 'unknown';
  const file = countFile(project, id);

  if (missing.length > 0) {
    const sent = readCount(file);
    if (sent < SEND_BACKS) {
      writeCount(file, sent + 1);
      return answer.block(`Your report is missing or has an invalid: ${missing.join(', ')}. End your work again with the WHEELHOUSE REPORT block in full.`);
    }
    const body = { project, kind: 'note', data: { text: `An agent of type ${input.agent_type} ended without a complete report (missing or invalid: ${missing.join(', ')}).` } };
    try {
      const result = await left(api.state.write(body));
      if (!taken(result)) keep(project, 'write', body, now);
    } catch { /* a note is not worth failing for */ }
    fs.rmSync(file, { force: true });
    return undefined;
  }
  fs.rmSync(file, { force: true });
  if (input.agent_type !== 'wheelhouse:reviewer') return undefined;

  const pr = Number(fields.pr);
  const note = async (why) => {
    const body = { project, kind: 'note', data: { text: `A complete review report for pull request #${pr} was not recorded: ${why}.` } };
    try {
      const result = await left(api.state.write(body));
      if (!taken(result)) keep(project, 'write', body, now);
    } catch { /* a note is not worth failing for */ }
  };
  const state = await left(api.prState({ project, number: pr }));
  if (state?.ok !== true) {
    await note('the helper did not say what the pull request holds');
    return undefined;
  }
  if (state.result?.state !== 'open') {
    await note('the pull request is not open');
    return undefined;
  }
  if (state.result?.headSha !== fields.commit) {
    await note('the head has moved since the review');
    return undefined;
  }
  const seen = fromTranscript(input.agent_transcript_path);
  const data = {
    pr,
    commit: fields.commit,
    verdict: fields.verdict,
    findings: fields.verdict === 'FINDINGS' ? Number(fields.findings) : 0,
    ...(fields.check ? { check: fields.check } : {}),
    claudeCode: text(input.claudeCode) ?? text(seen.claudeCode) ?? 'unknown',
    model: text(input.model) ?? text(seen.model) ?? 'unknown',
  };
  const body = { project, event: makeEvent({ kind: 'review', data, now }) };
  const kept = keep(project, 'record', body, now);
  const result = await left(api.state.record(body));
  if (taken(result)) {
    fs.rmSync(kept, { force: true });
  } else {
    await note('the helper did not take the signed record, which stays pending');
  }
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAndExit(decide, { failClosed: false, event: 'SubagentStop' });
}
