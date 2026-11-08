// probes/haiku-trial/results.js
// Where a run's results go: raw files outside every repository, and a public summary that names nothing private.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LABELS = ['kit fault', 'Wheelhouse fault', 'Haiku floor'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const runFolder = (date, home = os.homedir()) => path.join(home, '.wheelhouse-trials', `haiku-${date}`);

const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'pane';

export function writeRaw({ folder, transcripts = [], events = [], panes = {}, runLog = [], usage = {} }) {
  fs.mkdirSync(folder, { recursive: true });
  const kept = path.join(folder, 'transcripts');
  fs.mkdirSync(kept, { recursive: true });
  transcripts.forEach(({ file, role, session }, i) => {
    const name = `${String(i + 1).padStart(3, '0')}-${safeName(role ?? 'session')}-${safeName(session ?? path.basename(file))}${path.extname(file)}`;
    fs.copyFileSync(file, path.join(kept, name));
  });
  const lines = (list) => list.map((x) => JSON.stringify(x)).join('\n') + (list.length > 0 ? '\n' : '');
  fs.writeFileSync(path.join(folder, 'events.jsonl'), lines(events));
  fs.mkdirSync(path.join(folder, 'panes'), { recursive: true });
  for (const [name, texts] of Object.entries(panes)) {
    fs.writeFileSync(path.join(folder, 'panes', `${safeName(name)}.txt`), `${[].concat(texts).join('\n')}\n`);
  }
  fs.writeFileSync(path.join(folder, 'signals.jsonl'), lines(runLog));
  fs.writeFileSync(path.join(folder, 'usage.json'), `${JSON.stringify(usage, null, 2)}\n`);
  return folder;
}

// A date as the repository writes it: 8 November 2026.
function said(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(date);
}

// Text that goes into the public summary: an absolute path on any system is replaced, and the text is held to one line.
const ABSOLUTE = /(?:[A-Za-z]:\\[^\s"'`)]*|\/(?:Users|home|private|var|tmp|Volumes|root|opt|Library|etc|srv|mnt|nix)\/[^\s"'`)]*|~\/[^\s"'`)]*)/g;
const plain = (x) => String(x ?? '').replace(ABSOLUTE, '[a path]').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();

const RESULT = { true: 'pass', false: 'fail', null: 'not covered' };
const NEXT = {
  'kit fault': 'Mend the kit and run that wave again. Not a finding.',
  'Wheelhouse fault': 'Raise it as a bug through intake, with the trial\'s evidence attached.',
  'Haiku floor': 'Record it as a known floor, with the role it affects, and suggest a larger model for that role.',
};

export function writeSummary({ file, date, rows, score, audit, usage, labels = {}, verdict }) {
  const out = [`<!-- docs/trials/${date}-haiku-trial-results.md -->`, `# The Haiku trial, ${said(date)}`, ''];

  const failed = rows.filter((r) => r.pass === false);
  const sorted = failed.filter((r) => LABELS.includes(labels[r.id]));
  out.push('## Result', '');
  out.push(`- Paths: ${rows.filter((r) => r.pass === true).length} passed, ${failed.length} failed, ${rows.filter((r) => r.pass === null).length} not covered.`);
  out.push(`- Pass bar: ${score?.pass === true ? 'passed' : score?.pass === false ? 'not passed' : 'not measured'}.`);
  out.push(`- The director's verdict: ${plain(verdict) || 'not given yet'}.`, '');

  out.push('## Score', '');
  if (score) {
    out.push('| Part | Points |', '|---|---|');
    for (const [part, points] of Object.entries(score.parts ?? {})) out.push(`| ${plain(part)} | ${points ?? 'not run'} |`);
    out.push(`| Total | ${score.total} |`, '');
    for (const why of score.why ?? []) out.push(`- ${plain(why)}`);
    if ((score.why ?? []).length > 0) out.push('');
  } else {
    out.push('Not scored.', '');
  }

  out.push('## Paths', '', '| Row | Path | Result | Label |', '|---|---|---|---|');
  for (const r of rows) {
    const label = r.pass === false ? (LABELS.includes(labels[r.id]) ? labels[r.id] : 'to sort') : '';
    out.push(`| ${r.id} | ${plain(r.path)} | ${RESULT[String(r.pass)]} | ${label} |`);
  }
  out.push('');

  out.push('## Model audit', '');
  const models = audit?.models ?? { clean: true, offenders: [] };
  const peek = audit?.peek ?? { clean: true, hits: [] };
  out.push(`- Models: ${models.clean ? 'clean, every assistant turn ran on Haiku' : 'not clean'}.`);
  for (const o of models.offenders ?? []) out.push(`  - ${plain(o.role)}, session ${plain(o.session)}: ${plain(o.model)}, ${o.count} turn${o.count === 1 ? '' : 's'}.`);
  out.push(`- Peek: ${peek.clean ? 'clean, no session named the held-back files' : 'not clean'}.`);
  for (const h of peek.hits ?? []) out.push(`  - ${plain(h.role)} used ${plain(h.tool)} on the held-back files.`);
  out.push('');

  out.push('## Usage', '');
  const byRole = usage?.byRole ?? {};
  if (Object.keys(byRole).length === 0) out.push('No usage was read.', '');
  else {
    out.push('| Role | Input | Output | Cache read | Cache write |', '|---|---|---|---|---|');
    for (const [role, u] of Object.entries(byRole)) out.push(`| ${plain(role)} | ${u.input} | ${u.output} | ${u.cacheRead} | ${u.cacheWrite} |`);
    const t = usage.total;
    if (t) out.push(`| Total | ${t.input} | ${t.output} | ${t.cacheRead} | ${t.cacheWrite} |`);
    out.push('');
  }

  out.push("## What's next", '');
  const next = [];
  for (const label of LABELS) {
    const ids = sorted.filter((r) => labels[r.id] === label).map((r) => r.id);
    if (ids.length > 0) next.push(`- ${label}, rows ${ids.join(', ')}: ${NEXT[label]}`);
  }
  const unsorted = failed.filter((r) => !LABELS.includes(labels[r.id])).map((r) => r.id);
  if (unsorted.length > 0) next.push(`- Rows ${unsorted.join(', ')} still need a label.`);
  if (!models.clean) next.push('- The model audit failed: find the session that ran on another model before anything else.');
  if (!peek.clean) next.push('- A session read the held-back files: the score for that run cannot be trusted.');
  if (next.length === 0) next.push('- Nothing failed.');
  out.push(...next, '');

  const md = out.join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, md);
  return md;
}
