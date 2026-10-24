// scripts/board/render.js
// The board in words, and the one-line glance, from the board's model (model.js).
//
// The board is Markdown: it opens with the verdict (the same sentence as the pane's) and when the
// board was updated, then the director's view and the build view in design section 23.5's order.
// The headings are the renderer's own; each entry is one "- " line (a waiting card's small line
// sits under its entry), and the work being built is a table with its "You'll see it" column. A
// part with nothing in it has no heading: the empty parts of a view are folded into one italic
// line at its end. Every text from the model goes through oneLine again, so a model made
// anywhere else can't bring Markdown of its own; then any address in it (https://…, www.…,
// someone@somewhere) is put in backticks, so it shows as text and never as a link. The whole keeps
// within CONTEXT_CHARS: while it is too long, the section with the most text loses its last entry,
// and says "and N more". Nothing here throws.
import { CONTEXT_CHARS } from '../lib/core-numbers.js';
import { sayTime } from '../settings/effective.js';
import { NOT_AVAILABLE, NO_STATE, creditWords, dollarWords, oneLine, tokenWords } from './model.js';
import { STOP_LINE, brokenCount } from './health.js';
import {
  verdict, askedSince, behindTheScenes, buildHeadline, foldedParts, RULINGS_NOTE, YOULL_SEE_IT,
} from '../lib/calm-words.js';

const GLANCE_CHARS = 80;
const LANES = [['quick', 'Quick lane'], ['small', 'Small lane'], ['feature', 'Feature lane'], ['bug', 'Bug lane']];
const WHEN = [['now', 'Now'], ['next', 'Next'], ['later', 'Later']];
const PARTS = [['front-desk', 'Front desk'], ['foreman', 'Foreman'], ['feature', 'Feature builders']];
const PHASES = { 'before-launch': 'before launch', launched: 'launched' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// A word that a Markdown viewer would make a link of.
const ADDRESS = /(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|www\.|mailto:)|[^\s@]+@[^\s@]+\.[^\s@]/i;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const records = (value) => list(value).filter(isRecord);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const words = (value) => oneLine(value);

// " (18 October 2026)", or nothing when the time isn't one.
function dayOf(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
const onDay = (value) => (dayOf(value) ? ` (${dayOf(value)})` : '');

// "1.2M tokens, about $84", leaving out what isn't known; '' when neither is. A figure with credits (sessions that
// report their own use) says them too, and "credits not available" when no run gave them, never 0.
function spend(tokens, usd, figure = {}) {
  const credits = Object.hasOwn(figure, 'credits') ? (isNumber(figure.credits) ? creditWords(figure.credits) : `credits ${NOT_AVAILABLE}`) : null;
  return [credits, isNumber(tokens) ? tokenWords(tokens) : null, isNumber(usd) ? `about ${dollarWords(usd)}` : null].filter(Boolean).join(', ');
}

// Puts each word a viewer would link in backticks, with any closing punctuation left outside.
// oneLine leaves no backtick in a text, so the code span can't be closed early.
export const unlinked = (line) => line.split(' ').map((word) => {
  if (!ADDRESS.test(word)) return word;
  const [, core, tail] = /^(.*?)([.,;:!?]*)$/.exec(word);
  return ADDRESS.test(core) ? `\`${core}\`${tail}` : `\`${word}\``;
}).join(' ');

// A table cell: one line, with no bar to end it early.
const cell = (value) => words(value).replace(/\|/g, '\\|');

// A section is { key, heading, items, ...}: `key` names it in the folded line of empty parts,
// `note` is a line under the heading, `head` the lines before a table's rows, and `tail` a line
// after the items that is never cut. A section with nothing in it is folded away by `fold`.
function section(key, heading, items, extra = {}) {
  return { key, heading, items, ...extra };
}

// "Small feature · level 3 · asked 2 hours ago. If not now, it waits; nothing else is held up."
function smallLine(w, nowMs) {
  const level = Number.isInteger(w.level) && w.level >= 1 ? `level ${w.level}` : null;
  const lead = [words(w.small), level, askedSince(w.since, nowMs)].filter(Boolean).join(' · ').replace(/\.+$/, '');
  const meanwhile = words(w.meanwhile);
  return [lead === '' ? '' : `${lead}.`, meanwhile === '' || /[.!?]$/.test(meanwhile) ? meanwhile : `${meanwhile}.`].filter(Boolean).join(' ');
}

function directorSections(d, nowMs) {
  const launch = isRecord(d.launch) ? d.launch : {};
  const inProgress = isRecord(d.inProgress) ? d.inProgress : {};
  const ideas = isRecord(d.ideas) ? d.ideas : {};
  const budget = isRecord(d.budget) ? d.budget : {};
  const week = isRecord(budget.week) ? budget.week : {};
  const weekWords = [
    Object.hasOwn(week, 'credits') ? (isNumber(week.credits) ? `${creditWords(week.credits)} over the sessions Wheelhouse started` : `credits ${NOT_AVAILABLE}`) : null,
    isNumber(week.tokens) ? tokenWords(week.tokens) : null,
    isNumber(week.usd) ? `about ${dollarWords(week.usd)} at API prices` : null,
    isNumber(budget.share) ? `${Math.round(budget.share)}% of your weekly allowance` : null,
  ].filter(Boolean).join(', ');
  const mine = new Set(list(ideas.now).map(words));
  const resolved = Number.isInteger(launch.resolved) ? launch.resolved : 0;
  const gained = Number.isInteger(launch.gained) && launch.gained > 0 ? launch.gained : 0;
  const changed = records(d.changed);
  const behind = changed.filter((c) => c.behind === true).length;
  return [
    section('waiting', 'Waiting on you', records(d.waiting).map((w, i) => {
      // The number's full stop is escaped, so the entry isn't read as a list of its own.
      const small = smallLine(w, nowMs);
      return `${Number.isInteger(w.n) ? w.n : i + 1}\\. ${words(w.what) || 'A question'}${small ? `  \n${small}` : ''}`;
    })),
    section('launch', 'On the way to launch', [
      ...(PHASES[launch.phase] ? [`Phase: ${PHASES[launch.phase]}`] : []),
      ...(Number.isInteger(launch.total) && launch.total > 0 ? [`${resolved} of ${launch.total} blockers cleared${gained > 0 ? `, ${gained} since you were last here` : ''}`] : []),
      ...list(launch.blockers).map(words).filter(Boolean).map((what) => `Still open: ${what}`),
      ...list(launch.next).map(words).filter(Boolean).map((what) => `Next: ${what}${mine.has(what) ? ' (yours)' : ''}`),
    ]),
    section('building', 'Being built', LANES.flatMap(([lane, name]) => records(inProgress[lane]).map((w) => {
      const step = words(w.step);
      return `| ${cell(w.title) || 'Untitled work'} | ${name}${step ? `, ${cell(step)}` : ''} | ${cell(w.see) || '—'} |`;
    })), { head: [`| Work | Where it is | ${YOULL_SEE_IT} |`, '|---|---|---|'], table: true }),
    section('changed', 'Changed for your users', changed.filter((c) => c.behind !== true).map((c) => `${words(c.what) || 'A change'}${onDay(c.at)}`),
      { tail: behind > 0 ? behindTheScenes(behind) : null }),
    section('ideas', 'Ideas, in order', WHEN.flatMap(([when, name]) => list(ideas[when]).map(words).filter(Boolean).map((idea) => `${name}: ${idea}`))),
    section('health', 'Health and this week', [
      ...records(d.health).map((line) => words(line.text)).filter(Boolean),
      ...(weekWords ? [`This week: ${weekWords}`] : []),
      ...list(budget.unusual).map(words).filter(Boolean),
      ...(budget.setting === 'report' ? ['Budget: spending is reported, with no limit set'] : []),
    ]),
    section('rulings', 'Rulings', records(d.rulings).filter((r) => words(r.what)).map((r) => `${words(r.what)}${onDay(r.at)}`), { note: RULINGS_NOTE }),
  ];
}

function reviewWords(pr) {
  if (pr.review === 'clean') return 'its review found nothing to fix';
  if (pr.review === 'findings') {
    if (Number.isInteger(pr.findings) && pr.findings > 0) return `its review found ${pr.findings} ${pr.findings === 1 ? 'problem' : 'problems'}`;
    return 'its review found problems';
  }
  return 'not reviewed yet';
}

function buildSections(b) {
  const quality = isRecord(b.quality) ? b.quality : {};
  const usage = isRecord(b.usage) ? b.usage : {};
  const count = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
  const reviews = count(quality.reviews);
  return [
    section('features', 'Features and their parts', records(b.features).map((f) => {
      const lane = LANES.find(([key]) => key === f.lane);
      const slice = isRecord(f.slice) && Number.isInteger(f.slice.n) && Number.isInteger(f.slice.m) ? `slice ${f.slice.n} of ${f.slice.m}` : null;
      const pr = Number.isInteger(f.pr) && f.pr > 0 ? `pull request #${f.pr}` : null;
      const state = [words(f.step), slice, pr].filter(Boolean).join(', ');
      return `${words(f.title) || words(f.work) || 'Untitled work'}${lane ? ` (${lane[1].toLowerCase()})` : ''}${state ? `: ${state}` : ''}`;
    })),
    section('joining', 'Changes waiting to join', records(b.pullRequests).filter((p) => Number.isInteger(p.pr) && p.pr > 0).map((p) => {
      const work = words(p.work);
      const blocked = typeof p.blocked === 'string' ? `blocked${words(p.blocked) ? `: ${words(p.blocked)}` : ''}; ` : '';
      return `Pull request #${p.pr}${work ? ` for ${work}` : ''}: ${blocked}${reviewWords(p)}`;
    })),
    section('quality', 'Quality this week', reviews > 0
      ? [`${reviews} ${reviews === 1 ? 'review' : 'reviews'}, ${count(quality.withFindings)} with findings, ${count(quality.findings)} ${count(quality.findings) === 1 ? 'finding' : 'findings'} in all`]
      : []),
    section('decisions', 'Decisions along the way', records(b.decisions).filter((d) => words(d.what)).map((d) => {
      const why = words(d.why);
      return `${words(d.what)}${why ? `: ${why}` : ''}${onDay(d.at)}`;
    })),
    section('risks', 'Shortcuts and risks', records(b.risks).filter((r) => words(r.what)).map((r) => {
      const later = words(r.costLater);
      return `${words(r.what)}${later ? `; it would cost later: ${later}` : ''}`;
    })),
    section('usage', 'Usage by part', [
      ...PARTS.map(([key, name]) => {
        const figure = isRecord(usage[key]) ? usage[key] : {};
        const said = spend(figure.tokens, figure.usd, figure);
        return said ? `${name}: ${said}` : null;
      }).filter(Boolean),
      ...(isNumber(usage.subagents) && usage.subagents > 0 ? [`Subagents: ${tokenWords(usage.subagents)}`] : []),
    ], words(usage.note) ? { note: words(usage.note) } : {}),
  ];
}

// A section as it is cut so far: its heading, note and table head, `shown` of its entries, then
// "and N more" for the rest, then its tail.
function sectionLines(s) {
  if (s.items === null) return [s.heading, ...(s.note ? [s.note] : [])];
  const lines = [s.heading, ...(s.note ? [s.note] : []), ...(s.head ?? []), ...s.items.slice(0, s.shown)];
  if (s.shown < s.items.length) lines.push(more(s));
  if (s.tail) lines.push('', s.tail);
  return lines;
}
const more = (s) => `- and ${s.items.length - s.shown} more`;

// A section's length as sectionLines would join it, from the characters of its shown entries
// (each with the new line before it), without joining them.
function lengthOf(s, shownChars) {
  const headChars = [s.heading, ...(s.note ? [s.note] : []), ...(s.head ?? [])].join('\n').length;
  if (s.items === null) return headChars;
  const cut = s.shown < s.items.length ? 1 + more(s).length : 0;
  return headChars + shownChars + cut + (s.tail ? 2 + s.tail.length : 0);
}

// Cuts the longest sections, entry by entry from their ends, until the whole fits. Each cut
// costs a look along the sections, never a join of their entries. If the headings alone are
// too long, the text ends at the last whole line within the limit.
function fit(sections, limit) {
  const shownChars = sections.map((s) => (s.items ?? []).reduce((sum, item) => sum + item.length + 1, 0));
  const lengths = sections.map((s, i) => lengthOf(s, shownChars[i]));
  let total = lengths.reduce((sum, n) => sum + n, 0) + 2 * (sections.length - 1);
  while (total > limit) {
    let longest = -1;
    for (let i = 0; i < sections.length; i += 1) {
      if (sections[i].items && sections[i].shown > 0 && (longest === -1 || shownChars[i] > shownChars[longest])) longest = i;
    }
    if (longest === -1) break;
    const s = sections[longest];
    s.shown -= 1;
    shownChars[longest] -= s.items[s.shown].length + 1;
    const length = lengthOf(s, shownChars[longest]);
    total += length - lengths[longest];
    lengths[longest] = length;
  }
  const text = sections.map((s) => sectionLines(s).join('\n')).join('\n\n');
  if (text.length <= limit) return text;
  const within = text.slice(0, limit + 1);
  const end = within.lastIndexOf('\n');
  return end > 0 ? within.slice(0, end).trimEnd() : `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '')}…`;
}

// The sections of a view with something in them, ready to cut and join, then one italic line
// folding the ones that have nothing. A section's lines go through `unlinked` one by one; a table's
// rows are left as rows, the other entries are list items.
function shown(built) {
  const kept = built.filter((s) => s.items.length > 0 || s.tail);
  const empty = built.filter((s) => s.items.length === 0 && !s.tail).map((s) => s.key);
  const lines = (text) => text.split('\n').map(unlinked).join('\n');
  const sections = kept.map((s) => ({
    heading: `### ${s.heading}`,
    ...(s.note ? { note: s.note } : {}),
    ...(s.head ? { head: s.head } : {}),
    ...(s.tail ? { tail: s.tail } : {}),
    items: s.items.map((item) => (s.table ? lines(item) : `- ${lines(item).replace(/\n/g, '\n  ')}`)),
    shown: s.items.length,
  }));
  const folded = foldedParts(empty);
  return folded === '' ? sections : [...sections, { heading: folded, items: null, shown: 0 }];
}

// renderBoard(model, { tab, limit }): the verdict and when the board was updated, then the chosen
// tab first ('director' unless 'build' is asked for), then the other. Changes waiting for the
// director's confirmation come before both, and what couldn't be read after both, each only when
// there is some. `limit` is CONTEXT_CHARS unless a caller that adds words of its own asks for less.
export function renderBoard(model, { tab = 'director', limit = CONTEXT_CHARS } = {}) {
  try {
    const m = isRecord(model) ? model : {};
    const d = isRecord(m.director) ? m.director : {};
    const nowMs = typeof m.builtAt === 'string' ? Date.parse(m.builtAt) : NaN;
    const director = directorSections(d, nowMs);
    const b = isRecord(m.build) ? m.build : {};
    const build = buildSections(b);
    const project = words(m.project);
    const when = Number.isNaN(nowMs) ? 'The time of this reading couldn\'t be read.' : `Updated ${sayTime(m.builtAt)}.`;
    const intro = `Wheelhouse's board${project ? ` for ${project}` : ''}. ${when}`;
    const said = isRecord(model) ? verdict({ waiting: records(d.waiting).length, broken: brokenCount(d.health) }) : null;
    const missing = isRecord(model) ? list(m.missing).map(words).filter(Boolean) : ['The board couldn\'t be read'];
    const first = list(m.director?.first).map(words).filter(Boolean);
    const joining = records(b.pullRequests).filter((p) => Number.isInteger(p.pr) && p.pr > 0).length;
    const headline = buildHeadline({ building: records(b.features).length, joining });

    const heading = (text, note) => ({ heading: text, items: null, shown: 0, ...(note ? { note } : {}) });
    const listed = (text, items) => ({ heading: text, items: items.map((item) => `- ${unlinked(item)}`), shown: items.length });
    const tabs = {
      director: [heading('## Director'), ...shown(director)],
      build: [heading('## Build', headline), ...shown(build)],
    };
    const order = tab === 'build' ? ['build', 'director'] : ['director', 'build'];
    const sections = [
      ...(said === null ? [] : [heading(said)]),
      heading(unlinked(intro)),
      ...(first.length > 0 ? [listed('## Changed without your confirmation', first)] : []),
      ...tabs[order[0]],
      ...tabs[order[1]],
      ...(missing.length > 0 ? [listed('## What couldn\'t be read', missing)] : []),
    ];
    return fit(sections, Number.isInteger(limit) && limit > 0 && limit <= CONTEXT_CHARS ? limit : CONTEXT_CHARS);
  } catch {
    return 'Wheelhouse\'s board couldn\'t be put into words this time.';
  }
}

// glanceLine(model): "Wheelhouse · 2 waiting · 3 building · launch 3 of 5 · week 34% · STOP on", each
// part only when it has something to say; "launch r of t" while the project has blockers open. At
// most GLANCE_CHARS: where it would pass, the week's share drops first, then the launch part,
// before any cut with "…". STOP on is never dropped.
export function glanceLine(model) {
  try {
    if (!isRecord(model)) return 'Wheelhouse';
    const head = ['Wheelhouse'];
    if (list(model.missing).includes(NO_STATE)) head.push('no state yet');
    const waiting = records(model.director?.waiting).length;
    if (waiting > 0) head.push(`${waiting} waiting`);
    const building = records(model.build?.features).filter((f) => f.step === 'building').length;
    if (building > 0) head.push(`${building} building`);
    const progress = model.director?.launch;
    const launch = isRecord(progress) && Number.isInteger(progress.total) && progress.total > 0 && Number.isInteger(progress.resolved)
      && progress.resolved >= 0 && progress.resolved < progress.total ? `launch ${progress.resolved} of ${progress.total}` : null;
    const share = model.director?.budget?.share;
    const week = isNumber(share) ? `week ${Math.round(share)}%` : null;
    const stop = records(model.director?.health).some((line) => line.level === 'stop' && (line.text === STOP_LINE || String(line.text).startsWith(`${STOP_LINE}, `))) ? 'STOP on' : null;
    const join = (parts) => parts.join(' · ');
    const tail = stop ? [stop] : [];
    for (const optional of [[launch, week], [launch], []]) {
      const line = join([...head, ...optional.filter(Boolean), ...tail]);
      if (line.length <= GLANCE_CHARS) return line;
    }
    // Still too long: the front is cut with "…" and STOP on stays.
    if (!stop) {
      const line = join(head);
      return `${line.slice(0, GLANCE_CHARS - 1)}…`;
    }
    const room = GLANCE_CHARS - ` · ${stop}`.length - 1;
    return `${join(head).slice(0, room)}… · ${stop}`;
  } catch {
    return 'Wheelhouse';
  }
}
