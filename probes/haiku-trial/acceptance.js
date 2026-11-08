// probes/haiku-trial/acceptance.js
// The 15 acceptance items, written from the product spec before the trial and checked against the running app.
import { makeStatement, SAMPLE, CATEGORIES, canonical } from './statement.js';
import { startProduct, request } from './product.js';
import { findAll, textOf, totalsOf, labelled } from './lib/html.js';

export const ACCEPTANCE_ITEMS = [
  'home-empty-state', 'import-form', 'import-field-labelled', 'import-message', 'home-lists-months',
  'titles-name-pages', 'month-rows', 'month-change', 'prev-next', 'transaction-links',
  'edit-form', 'edit-returns', 'export-link', 'export-file-name', 'all-fields-labelled',
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NOTHING = /nothing (has been |is |was )?imported|nothing here yet|no (transactions|statements?|data|months)[^.]{0,40}(imported|yet)|not (imported|uploaded) anything|haven'?t imported/i;
const COUNTS = /added (\d+), skipped (\d+)/i;

const titleOf = (html) => textOf(findAll(html, 'title')[0]?.inner ?? '');
const hrefs = (html) => findAll(html, 'a').map((a) => ({ href: a.attrs.href ?? '', text: textOf(a.inner), outer: a.outer }));
const monthLinks = (html) => hrefs(html).map((a) => /\/month\?m=(\d{4}-\d{2})/.exec(a.href)?.[1]).filter(Boolean);
const amountText = (cents) => `${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const monthOfRow = (row) => `${row.date.slice(6)}-${row.date.slice(3, 5)}`;

export async function runAcceptance({ dir }) {
  const statement = makeStatement(SAMPLE);
  const months = Object.keys(statement.expected);
  const added = months.reduce((n, m) => n + statement.expected[m].count, 0);
  const results = [];
  const check = async (id, fn) => {
    try {
      const problem = await fn();
      results.push({ id, pass: problem === null || problem === true, detail: problem === null || problem === true ? 'ok' : problem });
    } catch (error) {
      results.push({ id, pass: false, detail: `check failed to run: ${error.message}` });
    }
  };
  const finish = () => {
    const items = ACCEPTANCE_ITEMS.map((id) => results.find((r) => r.id === id) ?? { id, pass: false, detail: 'not run' });
    return { items, passed: items.filter((i) => i.pass).length, total: 15 };
  };

  let product;
  try {
    product = await startProduct({ dir });
  } catch (error) {
    results.push(...ACCEPTANCE_ITEMS.map((id) => ({ id, pass: false, detail: error.message })));
    return finish();
  }
  try {
    const get = (path) => request(`${product.url}${path}`, { timeoutMs: 10000 });
    const upload = () => request(`${product.url}/import`, { file: { field: 'statement', name: 'statement.csv', content: statement.csv }, follow: true, timeoutMs: 10000 });

    const empty = await get('/');
    const importPage = await get('/import');
    const first = await upload();
    const second = await upload();
    const home = await get('/');
    const pages = {};
    for (const m of months) pages[m] = (await get(`/month?m=${m}`)).text;
    const idLink = /\/edit\?id=([^"'&\s>]+)/.exec(pages[months[0]])?.[1];
    const editPage = idLink ? await get(`/edit?id=${idLink}`) : { status: 0, text: '' };
    const exportRes = await get(`/export?m=${months[0]}`);

    await check('home-empty-state', () => (NOTHING.test(textOf(empty.text)) ? null : 'the home page does not say that nothing is imported'));
    await check('import-form', () => {
      const form = findAll(importPage.text, 'form').find((f) => (f.attrs.method ?? '').toLowerCase() === 'post' && (f.attrs.enctype ?? '').toLowerCase() === 'multipart/form-data');
      if (!form) return '/import has no form with method=post and enctype=multipart/form-data';
      return findAll(form.inner, 'input').some((i) => (i.attrs.type ?? '').toLowerCase() === 'file' && i.attrs.name === 'statement') ? null : 'the form has no file input named statement';
    });
    await check('import-field-labelled', () => {
      const form = findAll(importPage.text, 'form')[0];
      const { unlabelled } = labelled(form?.outer ?? importPage.text);
      return unlabelled.length === 0 ? null : `unlabelled: ${unlabelled.map((f) => f.name || f.tag).join(', ')}`;
    });
    await check('import-message', () => {
      const a = COUNTS.exec(textOf(first.text));
      const b = COUNTS.exec(textOf(second.text));
      if (!a || !b) return `no "added n, skipped n" message (${a ? 'second' : 'first'} import)`;
      if (Number(a[1]) !== added || Number(a[2]) !== 0) return `first import said ${a[0]}, expected added ${added}, skipped 0`;
      return Number(b[1]) === 0 && Number(b[2]) === added ? null : `second import said ${b[0]}, expected added 0, skipped ${added}`;
    });
    await check('home-lists-months', () => {
      const linked = new Set(monthLinks(home.text));
      const missing = months.filter((m) => !linked.has(m));
      return missing.length ? `not listed with a link: ${missing.join(', ')}` : null;
    });
    await check('titles-name-pages', () => {
      const titles = [titleOf(empty.text), titleOf(importPage.text), titleOf(pages[months[0]]), titleOf(editPage.text)];
      if (new Set(titles).size !== 4 || titles.some((t) => !t)) return `titles are not four different names: ${titles.join(' | ')}`;
      const name = MONTH_NAMES[Number(months[0].slice(5)) - 1];
      return new RegExp(`(${name}|${name.slice(0, 3)})\\s+${months[0].slice(0, 4)}`, 'i').test(titles[2]) ? null : `the month page title "${titles[2]}" does not name the month`;
    });
    await check('month-rows', () => {
      const got = totalsOf(pages[months[0]]);
      const want = [...CATEGORIES.map((c) => c.key).filter((k) => statement.expected[months[0]].byCategory[k] !== 0), 'all'];
      const missing = want.filter((k) => !(k in got));
      return missing.length ? `no data-category cell for ${missing.join(', ')}` : null;
    });
    await check('month-change', () => {
      const rows = findAll(pages[months[1]], 'tr').filter((tr) => /data-category="(?!all")/.test(tr.inner));
      if (!rows.length) return 'no category rows on the second month';
      const bare = rows.find((tr) => (textOf(tr.inner).match(/-?\d[\d,]*(\.\d+)?/g) ?? []).length < 2);
      return bare ? `no change shown on the row: ${textOf(bare.inner)}` : null;
    });
    await check('prev-next', () => {
      const [a, b, c] = months;
      const linked = new Set(monthLinks(pages[b]));
      if (!linked.has(a) || !linked.has(c)) return `${b} should link to ${a} and ${c}`;
      const earlier = monthLinks(pages[a]).filter((m) => m < a);
      return earlier.length ? `${a} links to earlier month ${earlier[0]}` : null;
    });
    await check('transaction-links', () => {
      const m = months[0];
      const page = pages[m];
      const trs = findAll(page, 'tr');
      for (const row of statement.rows.filter((r) => monthOfRow(r) === m)) {
        const tr = trs.find((t) => textOf(t.inner).includes(row.description) && textOf(t.inner).includes(amountText(row.cents)));
        if (!tr || !/\/edit\?id=/.test(tr.outer)) return `${row.description} has no /edit?id= link`;
      }
      return null;
    });
    await check('edit-form', () => {
      const { fields, unlabelled } = labelled(editPage.text);
      const select = findAll(editPage.text, 'select').find((s) => s.attrs.name === 'category');
      if (!select) return 'no select named category on the edit page';
      if (unlabelled.some((f) => f.name === 'category') || !fields.some((f) => f.name === 'category')) return 'the category select has no label';
      const offered = new Set(findAll(select.inner, 'option').map((o) => canonical(o.attrs.value ?? '')));
      const missing = CATEGORIES.map((c) => c.key).filter((k) => !offered.has(k));
      return missing.length ? `the select does not offer ${missing.join(', ')}` : null;
    });
    await check('export-link', () => {
      const link = hrefs(pages[months[0]]).find((a) => /download this month/i.test(a.text));
      return link && /\/export\?m=/.test(link.href) ? null : 'no "Download this month" link to /export?m=';
    });
    await check('export-file-name', () => {
      const disposition = exportRes.headers['content-disposition'] ?? '';
      return new RegExp(`filename="?spending-${months[0]}\\.csv"?(;|$)`).test(disposition) ? null : `Content-Disposition is "${disposition}"`;
    });
    await check('all-fields-labelled', () => {
      const all = { home: home.text, import: importPage.text, month: pages[months[0]], edit: editPage.text };
      for (const [name, html] of Object.entries(all)) {
        const { unlabelled } = labelled(html);
        if (unlabelled.length) return `${name} page: unlabelled ${unlabelled.map((f) => f.name || f.tag).join(', ')}`;
      }
      return null;
    });
    // Last, because it changes a transaction.
    await check('edit-returns', async () => {
      if (!idLink) return 'there is no transaction to edit';
      const res = await request(`${product.url}/edit`, { form: { id: decodeURIComponent(idLink), category: 'other' }, timeoutMs: 10000 });
      if (res.status === 0) return `edit: ${res.text}`;
      if (res.status >= 300 && res.status < 400) return /\/month\?m=/.test(res.headers.location ?? '') ? null : `redirects to ${res.headers.location}`;
      return monthLinks(res.text).length ? null : 'the response neither redirects nor links to /month?m=';
    });
  } finally {
    await product.stop();
  }
  return finish();
}
