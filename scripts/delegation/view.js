// scripts/delegation/view.js
// What the reader sees of a card (delegated decisions design, section 9, guardrail 4): the question, the options as bare
// labels in a shuffled order, and the change with what its builder said taken out. It never holds an option's `says`
// line, a recommendation, a kind or a commit message. Question and labels are step-written, so they are screened, and
// one that claims agreement, gives a reason or recommends is refused, as one too long to read whole is: nothing is cut.
// It also holds the piece's other cards, for telling a question already asked (section 7.4), and never an answer to one.
import crypto from 'node:crypto';
import { QUESTION_MOST, LABEL_MOST, VIEW_MOST_BYTES, CARDS_SEEN_MOST } from './limits.js';
import { cleanDiff } from './clean-diff.js';
import { normaliseWords } from './words.js';
import { briefLines } from './brief.js';

export { cleanDiff };

const AGREEMENT = /\b(?:director|owner|you|they|we|team)\b.{0,40}\b(?:agreed|approved|confirmed|decided|asked for|signed off|wanted|chose|said)\b|\b(?:as|already|was|were|been) (?:agreed|approved|confirmed|decided|discussed)\b|\bsigned off\b/;
const REASON = /\bbecause\b|\bso that\b|\bdue to\b|\bthe reason\b|\bin order to\b|\bgiven that\b/;
const RECOMMENDED = /\brecommend|\bi(?:'d| would) (?:go|pick|choose|prefer)\b|\bi (?:think|believe|suggest|prefer)\b|\bbest (?:option|choice|way)\b|\bsafest\b|\bpreferred\b|\bobviously\b|\bclearly\b/;

// What a step-written text does that it shouldn't, as reasons; none means it may be shown. Text in another script isn't
// read, so the words are the one layer here that can miss: the seal says only what a script could tell.
export function screenWords(text) {
  const words = normaliseWords(text);
  return [[AGREEMENT, 'it claims agreement'], [REASON, 'it gives a reason'], [RECOMMENDED, 'it recommends']].filter(([found]) => found.test(words)).map(([, why]) => why);
}

// The labels in an order fixed by `seed`, the question's id, so a view built twice reads the same.
export function seededOrder(labels, seed) {
  const place = (label) => crypto.createHash('sha256').update(`${seed}\0${label}`).digest('hex');
  return [...labels].sort((a, b) => (place(a) < place(b) ? -1 : 1));
}

const readable = (question, labels) => typeof question === 'string' && question.length <= QUESTION_MOST && labels.every((l) => typeof l === 'string' && l.length <= LABEL_MOST)
  && [question, ...labels].flatMap(screenWords).length === 0;

// The piece's latest other cards a close match could name: { id, question, labels, status }, status being `open` or
// `answered`, with what the answer was left out. A card that level 4 keeps apart, that stands behind another, or that
// a screen wouldn't pass is left out, and costs this card's view nothing.
export function pieceCards({ views, work, card }) {
  return Object.entries(views?.questions ?? {}).filter(([id, q]) => id !== card && q?.joins === undefined && q?.question?.data?.work === work && q.question.data.level === 3 && typeof q.question.data.key === 'string')
    .map(([id, q]) => ({ id, q, labels: (Array.isArray(q.question.data.options) ? q.question.data.options : []).map((o) => o?.label) }))
    .filter(({ q, labels }) => labels.length >= 2 && readable(q.question.data.what, labels))
    .slice(-CARDS_SEEN_MOST)
    .map(({ id, q, labels }) => ({ id, question: q.question.data.what, labels: seededOrder(labels, id), status: q.answer ? 'answered' : 'open' }));
}

// readerView({ question, options, rule, quote, brief, sheet, diff, cards, seed }) -> { refused } | the view. `diff` is
// `git diff` from the fixed base, or null when the change can't be read. `brief` is views.brief: the reader sees its lines,
// or none. `cards` as pieceCards gives them.
export function readerView({ question, options, rule = null, quote = null, brief = null, sheet = null, diff = null, cards = [], seed }) {
  const labels = (Array.isArray(options) ? options : []).map((o) => o?.label);
  if (typeof question !== 'string' || question.trim() === '') return { refused: 'there is no question to read' };
  if (labels.length < 2 || !labels.every((l) => typeof l === 'string' && l.trim() !== '')) return { refused: 'there is no choice to read' };
  if (question.length > QUESTION_MOST || labels.some((l) => l.length > LABEL_MOST)) return { refused: 'the question is too long to read whole' };
  const said = [...screenWords(question), ...labels.flatMap(screenWords)];
  if (said.length > 0) return { refused: said[0] };
  const cleaned = cleanDiff(diff);
  if (Buffer.byteLength(cleaned.diff) > VIEW_MOST_BYTES) return { refused: 'the change is too long to read whole' };
  return { question, labels: seededOrder(labels, seed), rule, quote, brief: briefLines(brief?.brief), sheet, cards, ...cleaned };
}
