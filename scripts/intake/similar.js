// scripts/intake/similar.js
// The intake's duplicate check (build-loop design, section 3): which open work, ideas and
// rejections share words with a request, so the front desk reads a few lines, not the lists.
// It reads the views' work, reports (to leave out work that has ended), ideas and rejections.

// Words that say nothing about what is asked for: articles, pronouns, linking words and the
// usual ways of asking.
export const COMMON_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'not', 'no', 'so', 'if', 'then', 'than',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'into', 'as', 'about', 'up', 'out',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'it', 'its', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'there', 'here', 'what', 'which', 'who', 'how', 'when', 'where', 'why',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'done', 'have', 'has', 'had',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'please', 'want', 'like', 'just', 'also', 'too', 'very', 'some', 'any', 'all', 'each', 'every',
  'add', 'make', 'get', 'let', 'use', 'need', 'put', 'thing', 'things',
]);

// An item's text fields beyond its title, as the plain events carry them.
const TEXT_FIELDS = ['title', 'text', 'what', 'note', 'reason'];
const KIND_ORDER = { work: 0, idea: 1, rejection: 2 };

// The meaningful words of a text: lower-cased, split on anything that is not a letter or a
// digit, common words and single characters left out, and a plural's final "s" taken off.
function wordsOf(text) {
  const out = new Set();
  if (typeof text !== 'string') return out;
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || COMMON_WORDS.has(raw)) continue;
    out.add(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
  }
  return out;
}

const textOf = (x) => (typeof x === 'string' ? x : '');

// How a work's report says it ended, when it no longer counts as open work.
const ENDED = ['merged', 'closed'];

// Each item as { kind, id, title, words }: its title, its text fields and the words of its slug.
// Work counts only while it is open: its latest report, if any, does not say it ended.
function itemsOf(views) {
  const items = [];
  for (const [id, entry] of Object.entries(views?.work ?? {})) {
    if (ENDED.includes(views?.reports?.[id]?.data?.outcome)) continue;
    const data = entry?.work?.data ?? {};
    items.push({ kind: 'work', id, title: textOf(data.title) || id, texts: [data.title, data.id] });
  }
  for (const [kind, list] of [['idea', views?.ideas], ['rejection', views?.rejections]]) {
    for (const [id, entry] of Object.entries(list ?? {})) {
      const data = entry?.data ?? {};
      const title = textOf(data.title) || textOf(data.text) || textOf(data.what) || id;
      items.push({ kind, id, title, texts: [...TEXT_FIELDS.map((k) => data[k]), data.key] });
    }
  }
  return items.map(({ texts, ...item }) => {
    const words = new Set();
    for (const t of texts) for (const w of wordsOf(t)) words.add(w);
    return { ...item, words };
  });
}

// The items that share words with `text`, highest score first, at most `limit` of them.
// The score is the share of words in common (twice the shared words over both counts),
// from 0 to 1; an item with none in common is left out.
export function similar(text, views, { limit = 5 } = {}) {
  const asked = wordsOf(text);
  if (asked.size === 0) return [];
  const found = [];
  for (const item of itemsOf(views)) {
    if (item.words.size === 0) continue;
    let shared = 0;
    for (const w of asked) if (item.words.has(w)) shared += 1;
    if (shared === 0) continue;
    found.push({ kind: item.kind, id: item.id, title: item.title, score: (2 * shared) / (asked.size + item.words.size) });
  }
  found.sort((a, b) => b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return found.slice(0, Math.max(0, limit));
}
