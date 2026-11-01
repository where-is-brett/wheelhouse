// scripts/state/import.js
// The import from Wheelhouse v0.1.x (design section 24.5 step 2): the events a v0.1.x folder holds
// (a project's clone of the state branch, a Lean project's own record, or the profile's clone) copied
// into the private record that replaces it, keeping each event's id and file, verifying each signed
// one against this computer's trusted keys, and skipping any the record already holds. Only what is
// committed in the old folder is read (its HEAD), so a file planted beside its commits is not taken,
// and an event committed there but never pushed is. Nothing is pushed, and nothing in the old folder
// is changed or removed: that waits for the director's click.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.js';
import { scanContent } from './secret-scan.js';
import { listEvents, eventPath, PLAIN_KINDS, PROTECTED_KINDS } from './events.js';
import { verify } from './signing.js';

const EVENT_FILE = /^events\/\d{4}\/\d{2}\/[A-Za-z0-9._-]+\.json$/;
// The most of one event file that is read: a signed click is a few kilobytes.
const MOST_BYTES = 256 * 1024;

// The event a file holds, when it is whole, of a known kind, at its own path, clear of the secret
// scan, and, for a signed kind, signed by a key in `enrolled`: 'unsigned' when only the signature
// fails, null when anything else does.
function soundEvent(text, file, enrolled) {
  let event = null;
  try { event = JSON.parse(text); } catch { return null; }
  // A rule is the helper's own, and v0.1.x never had one, so one in an old clone was planted.
  if (event?.kind === 'rule') return null;
  const whole = event && typeof event === 'object' && !Array.isArray(event)
    && typeof event.id === 'string' && typeof event.at === 'string' && typeof event.kind === 'string' && typeof event.computer === 'string'
    && (PLAIN_KINDS.includes(event.kind) || PROTECTED_KINDS.includes(event.kind));
  if (!whole) return null;
  let at;
  try { at = eventPath(event).replaceAll('\\', '/'); } catch { return null; }
  if (at !== file || scanContent(text).length > 0) return null;
  if (PROTECTED_KINDS.includes(event.kind) && !verify(event, enrolled)) return 'unsigned';
  return event;
}

// The text of each blob `shas` names in the repository at `from`, read with one `git cat-file --batch`:
// a Map from sha to text, without the blobs git says are missing. Throws when git fails.
async function blobs(from, shas) {
  const read = await git(from, ['cat-file', '--batch'], {}, { input: `${shas.join('\n')}\n`, encoding: 'buffer' });
  if (read.code !== 0) throw new Error(`The events in ${from} could not be read, so nothing was imported`);
  const out = read.stdout;
  const texts = new Map();
  let at = 0;
  while (at < out.length) {
    const end = out.indexOf(0x0a, at);
    if (end < 0) break;
    const [sha, type, size] = out.subarray(at, end).toString('utf8').split(' ');
    at = end + 1;
    if (type === 'missing' || size === undefined) continue;
    const length = Number(size);
    if (type === 'blob') texts.set(sha, out.subarray(at, at + length).toString('utf8'));
    at += length + 1;
  }
  return texts;
}

// Copies the events committed at `from`'s HEAD into the record at `to` (a repository openRecord
// opened) and commits them there in one commit. `enrolled` is the list of trusted keys signed
// events are checked against. Gives { imported, held, unsigned, unreadable }: `held` the events whose
// id the record already holds, `unsigned` the signed ones whose signature didn't check, `unreadable`
// the files that aren't a whole event. Throws when the old folder or the record can't be read or
// written, leaving the record as it was.
export async function importEvents({ from, to, enrolled }) {
  const counts = { imported: 0, held: 0, unsigned: 0, unreadable: 0 };
  const head = await git(from, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  if (head.code !== 0) return counts; // nothing committed there yet
  // Each entry with its size, read in one listing; the files then in one `cat-file --batch`, so a
  // large first import starts two git processes, not two per event.
  const listed = await git(from, ['ls-tree', '-r', '-z', '-l', 'HEAD', '--', 'events/']);
  if (listed.code !== 0) throw new Error(`The events in ${from} could not be listed, so nothing was imported`);
  const ids = new Set(listEvents(to, { report: () => {} }).map((e) => e.id));
  const wanted = [];
  for (const entry of listed.stdout.split('\0').filter(Boolean)) {
    const match = /^\d+ blob ([0-9a-f]{40,64}) +(\d+)\t(.+)$/s.exec(entry);
    if (!match || !EVENT_FILE.test(match[3]) || Number(match[2]) > MOST_BYTES) { counts.unreadable += 1; continue; }
    wanted.push({ sha: match[1], file: match[3] });
  }
  const texts = wanted.length === 0 ? new Map() : await blobs(from, wanted.map((w) => w.sha));
  const added = [];
  for (const { sha, file } of wanted) {
    const text = texts.get(sha);
    const event = text === undefined ? null : soundEvent(text, file, enrolled);
    if (event === null) { counts.unreadable += 1; continue; }
    if (event === 'unsigned') { counts.unsigned += 1; continue; }
    if (ids.has(event.id)) { counts.held += 1; continue; }
    const target = path.join(to, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(target, text, { flag: 'wx' });
    } catch {
      counts.held += 1; // a file of that name is there already
      continue;
    }
    ids.add(event.id);
    added.push(file);
  }
  if (added.length === 0) return counts;
  const putBack = () => { for (const f of added) fs.rmSync(path.join(to, ...f.split('/')), { force: true }); };
  // Added in batches, so a long list never makes one command line too long for Windows.
  for (let at = 0; at < added.length; at += 100) {
    if ((await git(to, ['add', '--', ...added.slice(at, at + 100)])).code !== 0) {
      await git(to, ['reset', '-q']);
      putBack();
      throw new Error('The imported events could not be committed, so nothing was imported');
    }
  }
  if ((await git(to, ['commit', '-q', '-m', `Import ${added.length} events from Wheelhouse v0.1.x`])).code !== 0) {
    await git(to, ['reset', '-q']);
    putBack();
    throw new Error('The imported events could not be committed, so nothing was imported');
  }
  counts.imported = added.length;
  return counts;
}
