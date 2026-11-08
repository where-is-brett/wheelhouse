// probes/haiku-trial/lib/html.js
// Small readers for the product's pages. No dependencies; good enough for pages a small app writes.
import { canonical } from '../statement.js';

const VOID = new Set(['input', 'br', 'img', 'meta', 'link', 'hr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function parseAttrs(text) {
  const attrs = {};
  const pattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of text.matchAll(pattern)) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

const OPEN = /<([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

// Every element named tagName: {attrs, inner, outer, index}.
export function findAll(html, tagName) {
  const name = tagName.toLowerCase();
  const found = [];
  for (const open of html.matchAll(OPEN)) {
    if (open[1].toLowerCase() !== name) continue;
    const start = open.index;
    const bodyStart = start + open[0].length;
    let end = bodyStart;
    let inner = '';
    if (!VOID.has(name) && !open[0].endsWith('/>')) {
      let depth = 1;
      const tags = new RegExp(`<(/?)${name}(?=[\\s>/])(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
      tags.lastIndex = bodyStart;
      let t;
      end = html.length;
      inner = html.slice(bodyStart);
      while ((t = tags.exec(html))) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) {
          inner = html.slice(bodyStart, t.index);
          end = t.index + t[0].length;
          break;
        }
      }
    }
    found.push({ attrs: parseAttrs(open[2]), inner, outer: html.slice(start, end), index: start });
  }
  return found;
}

// The visible text of a fragment, tags removed and entities decoded.
export function textOf(fragment) {
  return decode(
    fragment
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// Exact cents from a plain decimal such as 12.30 or -0.10; null for anything else or more than two decimals.
export function centsOfDecimal(text) {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || 0);
  return m[1] ? -cents : cents;
}

// {key: cents | null} from every element carrying data-category and data-total.
export function totalsOf(html) {
  const totals = {};
  for (const open of html.matchAll(OPEN)) {
    const attrs = parseAttrs(open[2]);
    if (attrs['data-category'] === undefined || attrs['data-total'] === undefined) continue;
    const key = canonical(attrs['data-category'].trim());
    if (!(key in totals)) totals[key] = centsOfDecimal(attrs['data-total']);
  }
  return totals;
}

// Fields that are not hidden or submit, and which of them have no label.
export function labelled(html) {
  const labels = findAll(html, 'label');
  const forIds = new Set(labels.map((l) => l.attrs.for).filter(Boolean));
  const fields = [];
  for (const tag of ['input', 'select', 'textarea']) {
    for (const el of findAll(html, tag)) {
      const type = (el.attrs.type ?? '').toLowerCase();
      if (tag === 'input' && ['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
      const wrapped = labels.some((l) => el.index > l.index && el.index < l.index + l.outer.length);
      const named = Boolean(el.attrs['aria-label']?.trim() || el.attrs['aria-labelledby']);
      const ok = wrapped || named || Boolean(el.attrs.id && forIds.has(el.attrs.id));
      fields.push({ tag, name: el.attrs.name ?? '', id: el.attrs.id ?? '', type, ok, index: el.index });
    }
  }
  fields.sort((a, b) => a.index - b.index);
  const strip = ({ ok, index, ...rest }) => rest;
  return { fields: fields.map(strip), unlabelled: fields.filter((f) => !f.ok).map(strip) };
}
