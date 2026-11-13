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

// What a run resumed from a snapshot cannot claim (section 3.6 of the method design), filled from what the resume recorded.
function resumedLines(r) {
  const out = [`Resumed from ${plain(r.snapshot)} (attempt ${r.attempt}). Not a run for the record: a passing claim needs one whole run.`, ''];
  out.push(`- Two builds of Wheelhouse. Steps before the snapshot ran on the plugin staged then (${plain(r.pluginBefore ?? 'not recorded')}); steps after it on ${plain(r.pluginNow ?? 'not recorded')}.`);
  const running = [].concat(r.running ?? []);
  out.push(`- A restart in the middle. ${r.quiet === true ? 'The snapshot was quiet, so no work came back through recovery.' : `The snapshot was not quiet${running.length > 0 ? ` (${running.map(plain).join(', ')} mid-build)` : ''}, so those works came back through Wheelhouse's recovery. Rows 33 and 34 and the reliability log may show restarts a whole run would not have had.`}`);
  out.push('- A new front desk. Its conversation starts again at the resume; rows read from the desk pane cover only what it said after.');
  out.push(`- GitHub history from the capture. Merged pull requests before the snapshot exist only in the capture and the renamed repository; a placeholder issue stands at each of their numbers (up to #${r.maxNumber ?? '?'}). Any finding about an old pull request is checked again in a whole run.`);
  out.push('- CI history starts again. The pushes start the repository\'s workflows afresh; earlier runs are in the capture only.');
  out.push('- Cost and time. Usage and the clock are for the resumed part, never summed with the snapshot\'s figures.');
  out.push('- The score. It is measured as usual on main, and reported as "would pass" or "would not pass", never "passed".', '');
  return out;
}

export function writeSummary({ file, date, rows, score, audit, usage, labels = {}, verdict, model = 'haiku', findings = [], claimLost, resumedFrom }) {
  const modelName = model[0].toUpperCase() + model.slice(1);
  const out = [`<!-- docs/trials/${date}-haiku-trial-results.md -->`, `# The Haiku trial, ${said(date)}`, ''];
  if (claimLost) out.push(`This run cannot pass: ${plain(claimLost)}.`, '');
  if (resumedFrom) out.push(...resumedLines(resumedFrom));

  const failed = rows.filter((r) => r.pass === false);
  const sorted = failed.filter((r) => LABELS.includes(labels[r.id]));
  out.push('## Result', '');
  out.push(`- Paths: ${rows.filter((r) => r.pass === true).length} passed, ${failed.length} failed, ${rows.filter((r) => r.pass === null).length} not covered.`);
  const [yes, nope] = resumedFrom ? ['would pass', 'would not pass'] : ['passed', 'not passed'];
  out.push(`- Pass bar: ${score?.pass === true ? yes : score?.pass === false ? nope : 'not measured'}.`);
  out.push(`- The director's verdict: ${plain(verdict) || 'not given yet'}.`, '');

  if (findings.length > 0) {
    out.push('## Findings', '', 'Faults the run went past; the rows that needed them say "not covered" with the step.', '');
    for (const f of findings) out.push(`- ${plain(f.step)}: ${plain(f.what)}`);
    out.push('');
  }

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
  out.push(`- Model: ${modelName}${model === 'haiku' ? '' : ' (a run to tell kit faults from model faults, not the Haiku claim)'}.`);
  out.push(`- Models: ${models.clean ? `clean, every assistant turn ran on ${modelName}` : 'not clean'}.`);
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
