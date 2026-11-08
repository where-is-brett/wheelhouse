// tests/probes/haiku-trial/reference-app/src/server.js
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readStatement, field } from './lib/csv.js';
import { monthOf } from './lib/dates.js';
import { formatCents } from './lib/money.js';
import { CATEGORIES, categorise } from './lib/categories.js';

const db = new DatabaseSync(process.env.LEDGER_DB ?? 'ledger.db');
db.exec(`CREATE TABLE IF NOT EXISTS tx (
  id INTEGER PRIMARY KEY, date TEXT, description TEXT, cents INTEGER, category TEXT, month TEXT)`);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const label = (key) => CATEGORIES.find(([k]) => k === key)?.[1] ?? key;
const shownDate = (iso) => iso.split('-').reverse().join('/');

function page(title, body) {
  const heading = `${title} - Spending tracker`; // variant: titles
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title></head>
<body><main><nav><a href="/">Home</a> <a href="/import">Import</a></nav>
${body}
</main></body></html>`;
}

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, ...headers });
  res.end(body);
}
const html = (res, status, title, body) => send(res, status, 'text/html', page(title, body));
const plain = (res, status, text) => send(res, status, 'text/plain', text);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Finds the uploaded file in a multipart body.
function filePart(buffer, contentType, name) {
  const boundary = /boundary=("?)([^";]+)\1/.exec(contentType ?? '')?.[2];
  if (!boundary) return null;
  for (const part of buffer.toString('latin1').split(`--${boundary}`)) {
    const split = part.indexOf('\r\n\r\n');
    if (split < 0 || !part.slice(0, split).includes(`name="${name}"`)) continue;
    return Buffer.from(part.slice(split + 4).replace(/\r\n$/, ''), 'latin1').toString('utf8');
  }
  return null;
}

function importPage() {
  const importField = '<label for="statement">Statement file (CSV)</label> <input type="file" id="statement" name="statement" accept=".csv" required>'; // variant: labels
  return `<h1>Import a statement</h1>
<form method="post" action="/import" enctype="multipart/form-data">
${importField}
<button type="submit">Import</button>
</form>`;
}

async function doImport(req, res) {
  const text = filePart(await readBody(req), req.headers['content-type'], 'statement');
  if (text === null) return plain(res, 400, 'No statement file was uploaded.');
  let rows;
  try {
    rows = readStatement(text);
  } catch (error) {
    return plain(res, 400, `This file is not a statement. ${error.message}.`);
  }
  let added = 0;
  let skipped = 0;
  const find = db.prepare('SELECT 1 FROM tx WHERE date = ? AND description = ? AND cents = ?');
  const insert = db.prepare('INSERT INTO tx (date, description, cents, category, month) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const row of rows) {
    const dup = find.get(row.date, row.description, row.cents); // variant: duplicates
    if (dup) { skipped += 1; continue; }
    insert.run(row.date, row.description, row.cents, categorise(row.description), monthOf(shownDate(row.date)));
    added += 1;
  }
  db.exec('COMMIT');
  return html(res, 200, 'Import done', `<h1>Import done</h1><p>Added ${added}, skipped ${skipped}.</p><p><a href="/">Back to the months</a></p>`);
}

function home(res) {
  const months = db.prepare('SELECT month, COUNT(*) AS n FROM tx GROUP BY month ORDER BY month DESC').all();
  if (!months.length) return html(res, 200, 'Home', '<h1>Spending tracker</h1><p>Nothing imported yet.</p><p><a href="/import">Import a statement</a></p>');
  const items = months.map((m) => `<li><a href="/month?m=${m.month}">${monthName(m.month)}</a> (${m.n} transactions)</li>`);
  return html(res, 200, 'Home', `<h1>Months</h1><ul>${items.join('')}</ul>`);
}

function totals(month) {
  const sums = Object.fromEntries(CATEGORIES.map(([k]) => [k, 0]));
  for (const r of db.prepare('SELECT category, SUM(cents) AS s FROM tx WHERE month = ? GROUP BY category').all(month)) sums[r.category] = r.s;
  return sums;
}

function monthPage(res, m) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '')) return plain(res, 400, 'The month must be written YYYY-MM.');
  const sums = totals(m);
  const [y, mo] = m.split('-').map(Number);
  const before = `${mo === 1 ? y - 1 : y}-${String(mo === 1 ? 12 : mo - 1).padStart(2, '0')}`;
  const hasEarlier = db.prepare('SELECT 1 FROM tx WHERE month < ?').get(m);
  const prevSums = totals(before);
  const prev = db.prepare('SELECT MAX(month) AS m FROM tx WHERE month < ?').get(m).m;
  const next = db.prepare('SELECT MIN(month) AS m FROM tx WHERE month > ?').get(m).m;
  const change = (d) => (hasEarlier ? `${d > 0 ? '+' : ''}${formatCents(d)}` : 'n/a');
  const grand = Object.values(sums).reduce((a, b) => a + b, 0);
  const grandBefore = Object.values(prevSums).reduce((a, b) => a + b, 0);
  const rows = CATEGORIES.map(([k, l]) => `<tr><th scope="row">${l}</th><td data-category="${k}" data-total="${formatCents(sums[k])}">${formatCents(sums[k])}</td><td>${change(sums[k] - prevSums[k])}</td></tr>`);
  rows.push(`<tr><th scope="row">All</th><td data-category="all" data-total="${formatCents(grand)}">${formatCents(grand)}</td><td>${change(grand - grandBefore)}</td></tr>`);
  const list = db.prepare('SELECT * FROM tx WHERE month = ? ORDER BY date, id').all(m).map((t) =>
    `<tr><td>${shownDate(t.date)}</td><td><a href="/edit?id=${t.id}">${esc(t.description)}</a></td><td>${formatCents(t.cents)}</td><td>${label(t.category)}</td></tr>`);
  const links = [prev ? `<a href="/month?m=${prev}">Previous month</a>` : '', next ? `<a href="/month?m=${next}">Next month</a>` : ''];
  return html(res, 200, monthName(m), `<h1>${monthName(m)}</h1>
<p>${links.join(' ')}</p>
<table><caption>Spending by category</caption><thead><tr><th>Category</th><th>Total</th><th>Change from last month</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<h2>Transactions</h2>
<table><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead><tbody>${list.join('')}</tbody></table>
<p><a href="/export?m=${m}">Download this month</a></p>`);
}

function editPage(res, id) {
  const t = db.prepare('SELECT * FROM tx WHERE id = ?').get(Number(id));
  if (!t) return plain(res, 404, 'No such transaction.');
  const options = CATEGORIES.map(([k, l]) => `<option value="${k}"${k === t.category ? ' selected' : ''}>${l}</option>`);
  return html(res, 200, 'Edit transaction', `<h1>Edit transaction</h1><p>${esc(t.description)} (${formatCents(t.cents)})</p>
<form method="post" action="/edit"><input type="hidden" name="id" value="${t.id}">
<label for="category">Category</label> <select id="category" name="category">${options.join('')}</select>
<button type="submit">Save</button></form>`);
}

async function doEdit(req, res) {
  const form = new URLSearchParams((await readBody(req)).toString('utf8'));
  const t = db.prepare('SELECT * FROM tx WHERE id = ?').get(Number(form.get('id')));
  if (!t || !CATEGORIES.some(([k]) => k === form.get('category'))) return plain(res, 400, 'That transaction or category is not known.');
  db.prepare('UPDATE tx SET category = ? WHERE id = ?').run(form.get('category'), t.id);
  res.writeHead(303, { location: `/month?m=${t.month}` });
  return res.end();
}

function exportMonth(res, m) {
  const hang = false; // variant: export-hangs
  if (hang) return;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '')) return plain(res, 400, 'The month must be written YYYY-MM.');
  const lines = db.prepare('SELECT * FROM tx WHERE month = ? ORDER BY date, id').all(m)
    .map((t) => [shownDate(t.date), field(t.description), formatCents(t.cents), t.category].join(','));
  const filename = `spending-${m}.csv`; // variant: export-name
  return send(res, 200, 'text/csv', ['Date,Description,Amount,Category', ...lines].join('\r\n') + '\r\n',
    { 'content-disposition': `attachment; filename="${filename}"` });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = url.searchParams;
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /') return home(res);
    if (route === 'GET /import') return html(res, 200, 'Import', importPage());
    if (route === 'POST /import') return await doImport(req, res);
    if (route === 'GET /month') return monthPage(res, q.get('m'));
    if (route === 'GET /edit') return editPage(res, q.get('id'));
    if (route === 'POST /edit') return await doEdit(req, res);
    if (route === 'GET /export') return exportMonth(res, q.get('m'));
    return plain(res, 404, 'Not found.');
  } catch {
    return plain(res, 500, 'Something went wrong.');
  }
});

server.listen(Number(process.env.PORT ?? 3000));
