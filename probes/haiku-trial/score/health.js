// probes/haiku-trial/score/health.js
// Repository health: five plain checks of how the product is kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startProduct, request } from '../product.js';
import { filesUnder } from './own-tests.js';
import { defaultRun } from './run.js';

const FOLDERS = ['src', 'tests', 'scripts'];
const TEXT = /\.(?:[cm]?js|json|md|html|css|sh|ya?ml)$/;

export async function health({ dir, run = defaultRun, start = startProduct, get = request }) {
  const notes = [];
  const parts = { size: 0, markers: 0, dependencies: 0, audit: 0, fresh: 0 };
  const files = FOLDERS.flatMap((f) => filesUnder(dir, f)).filter((f) => TEXT.test(f));
  const text = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

  const long = files.filter((f) => text(f).split('\n').length - (text(f).endsWith('\n') ? 1 : 0) > 300);
  if (long.length === 0) parts.size = 1;
  else notes.push(`size: over 300 lines: ${long.join(', ')}`);

  const marked = files.filter((f) => /\b(TODO|FIXME)\b/.test(text(f)));
  if (marked.length === 0) parts.markers = 1;
  else notes.push(`markers: TODO or FIXME in ${marked.join(', ')}`);

  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    notes.push('package.json could not be read');
  }
  const dependencies = Object.keys(pkg.dependencies ?? {});
  const sources = filesUnder(dir, 'src').filter((f) => /\.[cm]?js$/.test(f)).map(text).join('\n');
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unused = dependencies.filter((name) => !new RegExp(`(?:from\\s*|require\\(\\s*|import\\(\\s*|import\\s+)['"]${escape(name)}(?:/[^'"]*)?['"]`).test(sources));
  if (unused.length === 0) parts.dependencies = 1;
  else notes.push(`dependencies: not imported in src/: ${unused.join(', ')}`);

  if (dependencies.length === 0) {
    parts.audit = 1;
  } else {
    const audit = run('npm', ['audit', '--omit=dev', '--json'], { cwd: dir });
    let counts;
    try {
      counts = JSON.parse(audit.stdout).metadata.vulnerabilities;
    } catch {
      notes.push('audit: npm audit gave no readable answer');
    }
    if (counts && !counts.high && !counts.critical) parts.audit = 1;
    else if (counts) notes.push(`audit: ${counts.high ?? 0} high, ${counts.critical ?? 0} critical`);
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-fresh-'));
  try {
    const clone = path.join(scratch, 'repo');
    const steps = [['git', ['clone', '--quiet', dir, clone], undefined]];
    const needsInstall = dependencies.length > 0 || Object.keys(pkg.devDependencies ?? {}).length > 0;
    if (needsInstall) steps.push(['npm', ['ci'], clone]);
    steps.push(['npm', ['test'], clone]);
    let broke = null;
    for (const [cmd, args, cwd] of steps) {
      if (run(cmd, args, { cwd }).status !== 0) {
        broke = `${cmd} ${args[0]} failed in a fresh clone`;
        break;
      }
    }
    if (!broke) {
      try {
        const product = await start({ dir: clone });
        try {
          const res = await get(`${product.url}/`, { timeoutMs: 10000 });
          if (res.status !== 200) broke = `npm start answered / with ${res.status}`;
        } finally {
          await product.stop();
        }
      } catch (error) {
        broke = error.message;
      }
    }
    if (broke) notes.push(`fresh: ${broke}`);
    else parts.fresh = 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  return { points: Object.values(parts).reduce((a, b) => a + b, 0), of: 5, parts, notes };
}
