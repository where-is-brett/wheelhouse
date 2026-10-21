// probes/71-gitlab-self-managed/scrub.js
// What check 71 may keep of GitLab's answers: nothing that could be a key, an identifier or a
// time. Used on every fixture, every line the probe prints and (by a test) the note.

const PREFIXED = /\bgl(?:pat|rt|oas|soat|cbt|ptt|ft|imt|agent|wt|dt|ffct)-[A-Za-z0-9_-]{8,}/g;
const RUN = /[A-Za-z0-9_-]{20,}/g;
const HEX_RUN = /(?<![0-9a-f])[0-9a-f]{20,}(?![0-9a-f])/g;

const isRandomLooking = (run) => {
  const digit = /\d/.test(run);
  // Random base64url text holds a digit and both cases of letter; plain words and paths do not.
  if (digit && /[a-z]/.test(run) && /[A-Z]/.test(run)) return true;
  return digit && /^[0-9a-f]+$/.test(run) && /[a-f]/.test(run);
};

// Every token-shaped piece of `text`: a GitLab token prefix, a run of 20 or more characters that
// reads as random (digits with both cases of letter), or a run of 20 or more hex characters.
export function tokenShaped(text) {
  const s = String(text ?? '');
  const found = new Set(s.match(PREFIXED) ?? []);
  for (const run of s.match(RUN) ?? []) if (isRandomLooking(run)) found.add(run);
  for (const run of s.match(HEX_RUN) ?? []) if (/\d/.test(run) && /[a-f]/.test(run)) found.add(run);
  return [...found];
}

// A full commit ID on its own (not the body of a prefixed token).
const FULL_SHA = /(?<![\w-])(?:[0-9a-f]{40}|[0-9a-f]{64})(?![\w-])/g;
const BOT_NAME = /project_\d+_bot_[0-9a-f]+/g;

// Hides held secrets (exact text), token shapes, and this computer's folders.
export function scrubText(text, { secrets = [], home, probe } = {}) {
  let out = String(text ?? '');
  for (const secret of [...secrets].filter((s) => typeof s === 'string' && s.length >= 6).sort((a, b) => b.length - a.length)) out = out.split(secret).join('[hidden]');
  out = out.replace(BOT_NAME, 'project_<ID>_bot_<SUFFIX>').replace(FULL_SHA, '<SHA>');
  if (probe) out = out.split(probe).join('<PROBE>');
  if (home) out = out.split(home).join('<HOME>');
  for (const shape of tokenShaped(out).sort((a, b) => b.length - a.length)) out = out.split(shape).join('<TOKEN>');
  return out;
}

const ID_KEY = /^(?:id|iid|.*_id|.*_iid)$/;
const IDS_KEY = /^.*_ids$/;
const SHA_KEY = /^(?:sha|short_id|before_sha|after_sha|.*_sha)$/;
const TIMESTAMP = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)?$/;
const DATE = /^\d{4}-\d\d-\d\d$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IN_TEXT_TIMESTAMP = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?/g;
// "id":61 inside text that is itself JSON (a command's output).
const IN_TEXT_ID = /("(?:id|iid|[a-z_]+_id|[a-z_]+_iid)"\s*:\s*)\d+/g;
const PATH_ID = /\b(merge_requests|pipelines|jobs|issues|projects|runners|groups|users)\/\d+/g;

function scrubString(text, key) {
  if (TIMESTAMP.test(text)) return '<TIMESTAMP>';
  if (DATE.test(text)) return '<DATE>';
  if (key === 'avatar_url' || /gravatar\.com/.test(text)) return '<URL>';
  let out = text.replace(BOT_NAME, 'project_<ID>_bot_<SUFFIX>').replace(EMAIL, '<EMAIL>').replace(FULL_SHA, '<SHA>').replace(IN_TEXT_TIMESTAMP, '<TIMESTAMP>');
  out = out.replace(IN_TEXT_ID, '$1<ID>').replace(PATH_ID, '$1/<ID>');
  // A number in a link's path is an identifier.
  out = out.replace(/(https?:\/\/[^\s"']+)/g, (url) => url.replace(/\/\d+(?=[/?#]|$)/g, '/<ID>'));
  for (const shape of tokenShaped(out).sort((a, b) => b.length - a.length)) out = out.split(shape).join('<TOKEN>');
  return out;
}

// A copy of `value` safe to keep in a fixture. Placeholders: <TOKEN>, <ID>, <SHA>, <EMAIL>,
// <TIMESTAMP>, <DATE>, <URL>, <VALUE> (a variable's value).
export function scrubFixture(value, key = '') {
  if (Array.isArray(value)) return value.map((one) => scrubFixture(one, key));
  if (value && typeof value === 'object') {
    const isVariable = typeof value.key === 'string' && 'value' in value;
    return Object.fromEntries(Object.entries(value).map(([name, inner]) => {
      if (isVariable && name === 'value') return [name, '<VALUE>'];
      return [name, scrubFixture(inner, name)];
    }));
  }
  if (typeof value === 'string') {
    if (/token|secret|password/i.test(key) && value !== '') return '<TOKEN>';
    if (/^(?:application_id|uid|client_id)$/.test(key) && value !== '') return '<ID>';
    if (SHA_KEY.test(key) && /^[0-9a-f]{7,64}$/.test(value)) return '<SHA>';
    return scrubString(value, key);
  }
  if (typeof value === 'number') {
    if (ID_KEY.test(key) || IDS_KEY.test(key)) return '<ID>';
    if (/token/i.test(key)) return '<TOKEN>';
  }
  return value;
}
