// scripts/proof/data.js
// The data before and after a piece of data work (design section 7 of the director's way of working). The project names one
// read-only command that prints its tables as JSON:
//   { "tables": [ { "name": "orders", "rows": 120, "sample": [ { "key": "o-1", "values": { "status": "paid" } } ] } ] }
// It is run at the base commit and at the head, and the two prints are compared. Nothing here writes to any data: the command
// is the project's own read-only one, printed as one line of JSON, last. Where it runs (test data, or the real route once the director approved it) is the
// helper's to say (scripts/host/data-route.js).
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x !== '';

// The one table or sample the command printed, or throws saying what is wrong.
function checkedTable(t) {
  if (!isPlain(t) || !isText(t.name) || !Number.isSafeInteger(t.rows) || t.rows < 0) throw new Error('A table needs its name and its row count');
  const sample = t.sample ?? [];
  if (!Array.isArray(sample)) throw new Error(`The sample of ${t.name} must be a list`);
  for (const s of sample) {
    if (!isPlain(s) || !(isText(s.key) || Number.isSafeInteger(s.key)) || !isPlain(s.values)) throw new Error(`A sample row of ${t.name} needs its key and its values`);
  }
  return { name: t.name, rows: t.rows, sample: sample.map((s) => ({ key: String(s.key), values: { ...s.values } })) };
}

// The snapshot in `text`: the whole text if it is JSON, else its last line that is. Throws when there is none.
export function parseSnapshot(text) {
  const whole = String(text ?? '').trim();
  const candidates = [whole, ...whole.split(/\r?\n/).reverse().map((l) => l.trim()).filter((l) => l.startsWith('{'))];
  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isPlain(parsed) || !Array.isArray(parsed.tables)) continue;
    const names = new Set();
    const tables = parsed.tables.map((t) => {
      const kept = checkedTable(t);
      if (names.has(kept.name)) throw new Error(`The table ${kept.name} is printed twice`);
      names.add(kept.name);
      return kept;
    });
    return { tables };
  }
  throw new Error('The data command did not print the tables as JSON');
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What moved between two snapshots. `expect` lists the tables the change is meant to move; with none listed no table is.
// - counts: each table's rows before and after (null where the table isn't there), in the order they were printed;
// - changed: a column's value that differs on a sampled row both snapshots hold;
// - unexpected: in words, each table that moved though it is not in `expect`. A table moves when its count, its sampled values
//   or its being there differs.
export function compareSnapshots(before, after, { expect = [] } = {}) {
  const was = new Map((before?.tables ?? []).map((t) => [t.name, t]));
  const now = new Map((after?.tables ?? []).map((t) => [t.name, t]));
  const names = [...new Set([...was.keys(), ...now.keys()])];
  const counts = [];
  const changed = [];
  const moved = new Set();
  for (const name of names) {
    const b = was.get(name);
    const a = now.get(name);
    counts.push({ table: name, before: b?.rows ?? null, after: a?.rows ?? null });
    if (b === undefined || a === undefined || b.rows !== a.rows) moved.add(name);
    if (b === undefined || a === undefined) continue;
    const later = new Map(a.sample.map((s) => [s.key, s]));
    for (const row of b.sample) {
      const kept = later.get(row.key);
      if (kept === undefined) continue;
      for (const column of [...new Set([...Object.keys(row.values), ...Object.keys(kept.values)])]) {
        if (!same(row.values[column], kept.values[column])) {
          changed.push({ table: name, key: row.key, column, before: row.values[column] ?? null, after: kept.values[column] ?? null });
          moved.add(name);
        }
      }
    }
  }
  const meant = new Set(expect);
  const unexpected = [...moved].filter((name) => !meant.has(name)).map((name) => (
    meant.size === 0 ? `${name} moved, and no change to the data was expected` : `${name} moved, and the change was not expected to touch it`
  ));
  return { counts, changed, unexpected };
}
