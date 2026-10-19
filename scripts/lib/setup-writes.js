// scripts/lib/setup-writes.js
// What the director's answer on a card a setup step asked records in the project's state (rulings
// R35, R59), worked out by the prompt record, which signs. It lives apart from scripts/setup/ so the
// prompt record, which the mod's bridge imports, reaches nothing there.
//
// Two kinds of card earn records:
//   - setup's card of the rules found (its set line `Confirm all <n> rules as listed, <hash12>`):
//     Confirm all records each rule the asked record keeps (`rules`, the list the line's hash
//     names) as a ruling, each with its own confirmation, then the signed action `confirm-all
//     { hash, ids }`; Let me correct some records nothing here.
//   - a question whose asked record names what its answers write (`writes`):
//     { labels: { '<label>': [write] }, typed: [write] }, each write { kind, data, typedInto? }, the
//     typed text going into the `typedInto` field of a typed answer's writes. A glossary entry is
//     recorded as it is; a ruling or a setting is recorded with its confirmation, since the card
//     said the click records it. Only the writes setup asks for are made: a glossary entry, a
//     ruling, and the product's phase.
//
// Each record is { route, body } for the prompt record to keep in pending/ and send: a glossary
// entry through /state/write with an id of its own, so sending it again records it once; a
// confirmation through /state/record, carrying the event it confirms (`target`), which the hook
// made here, since a confirmation names its event's every field.
import crypto from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { makeEvent, confirmationFor } from '../state/events.js';
import { scanContent } from '../state/secret-scan.js';
import { checkSetting } from '../settings/catalogue.js';
import { settingWords } from '../settings/effective.js';
import { setLineOf, confirmAllLine, CONFIRM_ALL_LABEL } from '../state/card-lines.js';

// The SHA-256 of a list in canonical JSON: what a setup card's line names (scripts/setup/steps.js's
// planHash is this).
export function listHash(list) {
  return crypto.createHash('sha256').update(canonicalJson(list)).digest('hex');
}

// The settings an answer may write: the product's phase (ruling R38).
export const SETUP_SETTINGS = Object.freeze(['phase']);
// The fields a typed answer may fill.
const TYPED_INTO = { glossary: 'plain', ruling: 'words' };
const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const oneLine = (x) => typeof x === 'string' && x.trim() !== '' && !BREAK.test(x);
const exactly = (data, keys) => isPlain(data) && Object.keys(data).length === keys.length && keys.every((k) => Object.hasOwn(data, k));

// Whether `rule` is a rule as setup lists it: { words, source: { file, line }, original }.
export function isRule(rule) {
  return exactly(rule, ['words', 'source', 'original']) && oneLine(rule.words) && typeof rule.original === 'boolean'
    && exactly(rule.source, ['file', 'line']) && oneLine(rule.source.file) && Number.isInteger(rule.source.line) && rule.source.line >= 1;
}

// One write's event data, checked; throws when it is not one setup makes.
function dataOf(write, text) {
  if (!isPlain(write) || !isPlain(write.data)) throw new Error('A setup write needs its kind and data');
  const into = write.typedInto;
  if (into !== undefined && (text === null || into !== TYPED_INTO[write.kind])) throw new Error('A setup write fills only a typed answer\'s own field');
  const data = into === undefined ? { ...write.data } : { ...write.data, [into]: text.trim() };
  if (write.kind === 'glossary') {
    if (!exactly(data, ['term', 'plain']) || !oneLine(data.term) || !oneLine(data.plain)) throw new Error('A glossary entry needs its term and plain words');
    return data;
  }
  if (write.kind === 'ruling') {
    if (!isRule(data)) throw new Error('A ruling needs its words, where it was found and whether the words are the director\'s');
    return data;
  }
  if (write.kind === 'setting') {
    if (!SETUP_SETTINGS.includes(data.key) || !exactly(data, ['key', 'value'])) throw new Error('Setup writes no such setting');
    checkSetting(data.key, data.value);
    return { key: data.key, value: data.value, words: settingWords(data.key, data.value) };
  }
  throw new Error('Setup writes no such record');
}

// A ruling or a setting, made here, and its confirmation, which carries it.
function confirmed(kind, data, now) {
  const target = makeEvent({ kind, data, now });
  return { target, record: { route: 'record', body: { event: makeEvent({ ...confirmationFor(target), now }), target } } };
}

// The records an answer earns: [{ route, body }], `body` without its project. `answer` is
// { question, label, text }, as the setup-answer carries it. Throws when the asked record asks for
// something setup never writes, or the card's line does not name the asked list, so nothing is
// kept and the question stays unanswered. Every text is scanned for secrets first.
export function setupRecordsOf(asked, { question, label, text }, { now = () => new Date() } = {}) {
  const line = setLineOf(question);
  if (line !== null && line.startsWith('Confirm all ')) {
    if (label !== CONFIRM_ALL_LABEL) return [];
    const rules = asked?.rules;
    if (!Array.isArray(rules) || rules.length === 0 || !rules.every(isRule)) throw new Error('The asked card keeps no list of rules');
    const hash = listHash(rules);
    if (line !== confirmAllLine(hash, rules.length)) throw new Error('The card\'s line does not name the list of rules asked');
    if (rules.some((r) => scanContent(JSON.stringify(r)).length > 0)) throw new Error('A rule holds what looks like a secret');
    const made = rules.map((r) => confirmed('ruling', { words: r.words, source: r.source, original: r.original }, now));
    const ids = made.map((m) => m.target.id);
    const action = makeEvent({ kind: 'action', data: { action: 'confirm-all', hash, ids, question, label }, now });
    return [...made.map((m) => m.record), { route: 'record', body: { event: action } }];
  }
  const writes = asked?.writes;
  if (writes === undefined || writes === null) return [];
  const labels = isPlain(writes.labels) ? writes.labels : {};
  const list = typeof label === 'string' ? (Object.hasOwn(labels, label) ? labels[label] : undefined) : writes.typed;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('A setup question\'s writes must be a list');
  return list.map((write) => {
    const data = dataOf(write, typeof label === 'string' ? null : text);
    if (scanContent(JSON.stringify(data)).length > 0) throw new Error('A setup write holds what looks like a secret');
    if (write.kind === 'glossary') return { route: 'write', body: { kind: 'glossary', data, id: crypto.randomUUID() } };
    return confirmed(write.kind, data, now).record;
  });
}
