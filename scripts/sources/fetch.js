// scripts/sources/fetch.js
// Fetches one source over https: redirects by hand, a size limit, a time limit, and a page's HTML
// turned into plain text. It never throws; a source that can't be read is `{ ok: false, why }`.
import { SOURCES } from '../lib/core-numbers.js';

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const API_KINDS = ['releases', 'advisories', 'merged'];

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', times: '×', middot: '·', bull: '•',
};

// Entities decoded in one pass, so `&amp;lt;` stays `&lt;`.
function decodeEntities(text) {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (whole, dec, hex, name) => {
    if (name) return Object.hasOwn(NAMED, name.toLowerCase()) ? NAMED[name.toLowerCase()] : whole;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    try { return String.fromCodePoint(code); } catch { return whole; }
  });
}

const BLOCKS = 'address|article|aside|blockquote|body|br|caption|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|html|li|main|nav|ol|p|pre|section|summary|table|tbody|tfoot|thead|tr|ul';

// A page's HTML as text, one line per block, with white space evened and nothing blank.
export function htmlToText(html) {
  let text = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    // A page that was cut can end inside one of these, or inside a tag.
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*$/i, '')
    .replace(/<[^>]*$/, '')
    .replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(new RegExp(`</?(?:${BLOCKS})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]*>/g, '');
  text = decodeEntities(text);
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim().replace(/(?:\s*\|)+$/, '').trim())
    .filter(Boolean)
    .join('\n');
}

const withoutHash = (url) => { const copy = new URL(url.href); copy.hash = ''; return copy.href; };

// The absolute https links to the same host in a page, without fragments, once each.
function sameSiteLinks(html, base, markdownToo) {
  const found = [];
  const add = (raw) => {
    try {
      const url = new URL(decodeEntities(raw.trim()), base);
      url.hash = '';
      if (url.protocol === 'https:' && url.host === base.host && url.href !== withoutHash(base) && !found.includes(url.href)) found.push(url.href);
    } catch { /* not an address */ }
  };
  for (const m of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) add(m[1] ?? m[2]);
  if (markdownToo) for (const m of html.matchAll(/https:\/\/[^\s)>\]"'<]+/g)) add(m[0]);
  return found;
}

async function readBody(response, maxBytes) {
  let bytes;
  let cut = false;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > maxBytes) { cut = true; await reader.cancel().catch(() => {}); break; }
    }
    bytes = Buffer.concat(chunks);
  } else {
    bytes = Buffer.from(await response.text());
    cut = bytes.length > maxBytes;
  }
  const text = new TextDecoder('utf-8').decode(bytes.subarray(0, maxBytes)).replace(/\uFFFD+$/, '');
  return { text, cut };
}

const discard = (response) => { try { response.body?.cancel?.().catch?.(() => {}); } catch { /* nothing to discard */ } };

async function get(source, { fetch, signal, maxBytes }) {
  let url;
  try { url = new URL(source?.url); } catch { return { ok: false, why: 'That is not a web address' }; }
  if (url.protocol !== 'https:') return { ok: false, why: 'Only https addresses are read' };
  const api = API_KINDS.includes(source.kind);
  const headers = api
    ? { 'User-Agent': 'wheelhouse', Accept: 'application/vnd.github+json' }
    : { 'User-Agent': 'wheelhouse', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' };
  for (let hops = 0; ; hops += 1) {
    const response = await fetch(url.href, { redirect: 'manual', headers, signal });
    if (REDIRECT_STATUSES.includes(response.status)) {
      discard(response);
      const location = response.headers?.get?.('location');
      if (!location) return { ok: false, why: 'The site redirected without saying where' };
      if (hops >= MAX_REDIRECTS) return { ok: false, why: `The site redirected more than ${MAX_REDIRECTS} times` };
      let next;
      try { next = new URL(location, url); } catch { return { ok: false, why: 'The site redirected to something that is not an address' }; }
      if (next.protocol !== 'https:') return { ok: false, why: 'The site redirected away from https' };
      if (next.host !== url.host) return { ok: false, why: 'The site redirected to another site' };
      url = next;
      continue;
    }
    if (response.status < 200 || response.status > 299) { discard(response); return { ok: false, why: `The site answered ${response.status}` }; }
    const { text: body, cut } = await readBody(response, maxBytes);
    if (api) return { ok: true, text: body, links: [], cut };
    const type = response.headers?.get?.('content-type') ?? '';
    const isHtml = /html/i.test(type) || /<(?:!doctype|html|body|div|p|h1)\b/i.test(body.slice(0, 2000));
    const text = isHtml ? htmlToText(body) : body.split('\n').map((l) => l.replace(/[ \t\r]+/g, ' ').trim()).filter(Boolean).join('\n');
    if (text === '') return { ok: false, why: 'The page had no text' };
    return { ok: true, text, links: sameSiteLinks(body, url, !isHtml), cut };
  }
}

// Reads one source, `{ url, kind }`. A page comes back as text and its same-site links; a GitHub list
// as the answer it gave. The time limit covers the whole read, redirects included.
export async function fetchSource(source, { fetch = globalThis.fetch, now, timeoutMs = SOURCES.timeoutMs, maxBytes = SOURCES.maxBytes } = {}) {
  void now;
  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve({ ok: false, why: `No answer within ${Math.round(timeoutMs / 1000) || 1} seconds (time limit)` }); }, timeoutMs);
  });
  const work = get(source, { fetch, signal: controller.signal, maxBytes })
    .catch((error) => ({ ok: false, why: `Could not read it: ${error?.message ?? error}` }));
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
