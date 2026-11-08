// probes/haiku-trial/held-back/held-back.js
// The held-back money checks: one statement, imported into a fresh product, read back to the cent.
import { makeStatement, HELD_BACK, CATEGORIES, UNKNOWN_MERCHANT, canonical, formatCents } from '../statement.js';
import { startProduct, request } from '../product.js';
import { findAll, textOf, totalsOf, centsOfDecimal } from '../lib/html.js';

const MONTHS = Object.keys(makeStatement(HELD_BACK).expected);

export const HELD_BACK_CHECKS = [
  'import-ok', 'added-count', 'skipped-duplicate', 'again-adds-none', 'again-skips-all', 'bad-file-plain', 'bad-file-adds-none',
  ...MONTHS.map((m) => `totals-${m}`),
  ...MONTHS.map((m) => `grand-${m}`),
  'bom-first-row', 'bracket-refund', 'minus-refund', 'quoted-comma-whole', 'month-end-own-month', 'unknown-is-other', 'income-negative',
  'edit-moves-one', 'export-matches',
  'empty-month-ok', 'bad-month-ok',
];

const COUNTS = /added (\d+), skipped (\d+)/i;

function monthOfRow(row) {
  const [, month, year] = row.date.split('/');
  return `${year}-${month}`;
}

// Whether some table row on the page shows this transaction's whole description and its amount.
function rowOf(page, row) {
  const amount = formatCents(Math.abs(row.cents));
  return findAll(page, 'tr').find((tr) => {
    const text = textOf(tr.inner);
    return text.includes(row.description) && text.includes(amount);
  });
}

function csvRecords(text) {
  const out = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value); value = '';
      if (row.some((v) => v !== '')) out.push(row);
      row = [];
    } else value += c;
  }
  row.push(value);
  if (row.some((v) => v !== '')) out.push(row);
  return out;
}

const bad = (res, what) => (res.status >= 200 && res.status < 300 ? null : `${what}: ${res.status === 0 ? res.text : `status ${res.status}`}`);

function totalsProblem(page, expected) {
  const got = totalsOf(page);
  const misses = [];
  for (const [key, want] of Object.entries(expected.byCategory)) {
    if (got[canonical(key)] !== want) misses.push(`${key} ${got[canonical(key)] ?? 'missing'} not ${want}`);
  }
  if (got.all !== expected.total) misses.push(`all ${got.all ?? 'missing'} not ${expected.total}`);
  return misses.length ? misses.join('; ') : null;
}

export async function runHeldBack({ dir, statement = makeStatement(HELD_BACK), timeoutMs = 10000 }) {
  const { expected, rows, csv } = statement;
  const months = Object.keys(expected);
  const added = months.reduce((n, m) => n + expected[m].count, 0);
  const results = [];
  const check = async (id, fn) => {
    try {
      const problem = await fn();
      results.push({ id, pass: problem === null || problem === true, detail: problem === null || problem === true ? 'ok' : problem });
    } catch (error) {
      results.push({ id, pass: false, detail: `check failed to run: ${error.message}` });
    }
  };

  let product;
  try {
    product = await startProduct({ dir });
  } catch (error) {
    const detail = error.message;
    const ids = HELD_BACK_CHECKS;
    return { checks: ids.map((id) => ({ id, pass: false, detail })), passed: 0, total: ids.length, share: 0 };
  }
  try {
    const get = (path) => request(`${product.url}${path}`, { timeoutMs });
    const upload = (content, name) => request(`${product.url}/import`, { file: { field: 'statement', name, content }, follow: true, timeoutMs });
    const first = await upload(csv, 'statement.csv');
    const firstCounts = COUNTS.exec(textOf(first.text));
    const again = await upload(csv, 'statement.csv');
    const againCounts = COUNTS.exec(textOf(again.text));
    const pages = {};
    for (const m of months) pages[m] = await get(`/month?m=${m}`);
    const snapshot = JSON.stringify(Object.fromEntries(months.map((m) => [m, totalsOf(pages[m].text)])));
    const junk = await upload('this is not a statement\nat all\n', 'notes.txt');
    const afterJunk = {};
    for (const m of months) afterJunk[m] = totalsOf((await get(`/month?m=${m}`)).text);

    await check('import-ok', () => bad(first, 'import'));
    await check('added-count', () => (firstCounts && Number(firstCounts[1]) === added ? null : `message ${firstCounts?.[0] ?? 'missing'}, expected added ${added}`));
    await check('skipped-duplicate', () => (firstCounts && Number(firstCounts[2]) === rows.length - added ? null : `message ${firstCounts?.[0] ?? 'missing'}, expected skipped ${rows.length - added}`));
    await check('again-adds-none', () => (againCounts && Number(againCounts[1]) === 0 ? null : `second import said ${againCounts?.[0] ?? 'nothing like added n, skipped n'}`));
    await check('again-skips-all', () => (againCounts && Number(againCounts[2]) === rows.length ? null : `second import said ${againCounts?.[0] ?? 'nothing like added n, skipped n'}, expected skipped ${rows.length}`));
    await check('bad-file-plain', () => {
      if (junk.status === 0) return `bad file: ${junk.text}`;
      if (junk.status < 400 || junk.status > 499) return `status ${junk.status}, expected 400 to 499`;
      return /\n\s+at /.test(junk.text) ? 'the error shows a stack trace' : null;
    });
    await check('bad-file-adds-none', () => (JSON.stringify(afterJunk) === snapshot ? null : 'totals changed after the bad file'));

    for (const m of months) await check(`totals-${m}`, () => bad(pages[m], `/month?m=${m}`) ?? totalsProblem(pages[m].text, expected[m]) ?? null);
    for (const m of months) {
      await check(`grand-${m}`, () => {
        const got = totalsOf(pages[m].text).all;
        return got === expected[m].total ? null : `grand total ${got ?? 'missing'}, expected ${expected[m].total}`;
      });
    }

    const pageOf = (row) => pages[monthOfRow(row)]?.text ?? '';
    const refunds = rows.filter((r) => / REFUND$/.test(r.description) && r.cents < 0);
    const isBracket = (r) => new RegExp(`${r.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\(`).test(csv);
    const refundCheck = (pick) => () => {
      const row = refunds.find(pick);
      if (!row) return 'the statement has no such refund';
      const tr = rowOf(pageOf(row), row);
      if (!tr) return `${row.description} is not listed with ${formatCents(Math.abs(row.cents))} in ${monthOfRow(row)}`;
      const amount = formatCents(Math.abs(row.cents)).replace('.', '\\.');
      const text = textOf(tr.inner);
      return new RegExp(`(-\\s*[^\\d\\s]?\\s*${amount})|(\\(\\s*[^\\d\\s]?\\s*${amount}\\s*\\))`).test(text) ? null : `${row.description} does not show as money back: ${text}`;
    };
    await check('bom-first-row', () => {
      const row = rows[0];
      return rowOf(pageOf(row), row) ? null : `the first row, ${row.description}, is not listed in ${monthOfRow(row)}`;
    });
    await check('bracket-refund', refundCheck(isBracket));
    await check('minus-refund', refundCheck((r) => !isBracket(r)));
    await check('quoted-comma-whole', () => {
      const commas = rows.filter((r) => r.description.includes(','));
      if (!commas.length) return 'the statement has no description with a comma';
      const missing = commas.find((r) => !rowOf(pageOf(r), r));
      return missing ? `${missing.description} is not listed whole in ${monthOfRow(missing)}` : null;
    });
    await check('month-end-own-month', () => {
      const ends = rows.filter((r) => r.description.endsWith(' MONTH END'));
      const missing = ends.find((r) => !rowOf(pageOf(r), r));
      return missing ? `${missing.description} on ${missing.date} is not listed in ${monthOfRow(missing)}` : null;
    });
    await check('unknown-is-other', () => {
      const row = rows.find((r) => r.description === UNKNOWN_MERCHANT);
      const m = monthOfRow(row);
      const got = totalsOf(pageOf(row)).other;
      return got === expected[m].byCategory.other ? null : `${m} other is ${got ?? 'missing'}, expected ${expected[m].byCategory.other}`;
    });
    await check('income-negative', () => {
      for (const m of months) {
        const got = totalsOf(pages[m].text).income;
        if (got !== expected[m].byCategory.income) return `${m} income is ${got ?? 'missing'}, expected ${expected[m].byCategory.income}`;
        if (!(got < 0)) return `${m} income is not negative`;
      }
      return null;
    });

    const exportMonth = months[Math.min(1, months.length - 1)];
    await check('export-matches', async () => {
      const res = await get(`/export?m=${exportMonth}`);
      const failure = bad(res, `/export?m=${exportMonth}`);
      if (failure) return failure;
      if (!(res.headers['content-disposition'] ?? '').includes(exportMonth)) return `file name does not contain ${exportMonth}`;
      const [header, ...lines] = csvRecords(res.text);
      const col = (name) => (header ?? []).findIndex((h) => h.trim().toLowerCase() === name);
      const [amountAt, categoryAt] = [col('amount'), col('category')];
      if (amountAt < 0 || categoryAt < 0) return 'the export has no Amount and Category columns';
      if (lines.length !== expected[exportMonth].count) return `${lines.length} rows, expected ${expected[exportMonth].count}`;
      const sums = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
      for (const line of lines) {
        const cents = centsOfDecimal(line[amountAt]);
        if (cents === null) return `"${line[amountAt]}" is not an amount`;
        const key = canonical((line[categoryAt] ?? '').trim());
        sums[key] = (sums[key] ?? 0) + cents;
      }
      for (const [key, want] of Object.entries(expected[exportMonth].byCategory)) {
        if (sums[key] !== want) return `export ${key} sums to ${sums[key]}, expected ${want}`;
      }
      return null;
    });

    await check('edit-moves-one', async () => {
      const m = months[0];
      const row = rows.find((r) => r.category === 'groceries' && monthOfRow(r) === m && !r.description.includes(','));
      const before = await get(`/month?m=${m}`);
      const tr = rowOf(before.text, row);
      const id = tr && /\/edit\?id=([^"'&\s>]+)/.exec(tr.outer)?.[1];
      if (!id) return `no /edit?id= link on the row for ${row.description}`;
      const saved = await request(`${product.url}/edit`, { form: { id: decodeURIComponent(id), category: 'health' }, follow: true, timeoutMs });
      if (saved.status === 0) return `edit: ${saved.text}`;
      const after = await get(`/month?m=${m}`);
      const [was, now] = [totalsOf(before.text), totalsOf(after.text)];
      for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
        const delta = key === 'groceries' ? -row.cents : key === 'health' ? row.cents : 0;
        if (now[key] !== (was[key] ?? 0) + delta) return `${key} went from ${was[key]} to ${now[key]}, expected a change of ${delta}`;
      }
      return null;
    });

    await check('empty-month-ok', async () => {
      const res = await get('/month?m=2026-01');
      return res.status > 0 && res.status < 500 ? null : `/month?m=2026-01: ${res.status === 0 ? res.text : `status ${res.status}`}`;
    });
    await check('bad-month-ok', async () => {
      const res = await get('/month?m=nonsense');
      return res.status > 0 && res.status < 500 ? null : `/month?m=nonsense: ${res.status === 0 ? res.text : `status ${res.status}`}`;
    });
  } finally {
    await product.stop();
  }

  const checks = HELD_BACK_CHECKS.map((id) => results.find((r) => r.id === id) ?? { id, pass: false, detail: 'not run' });
  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length, share: passed / checks.length };
}
