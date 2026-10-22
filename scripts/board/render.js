// scripts/board/render.js
// The board in words, and the one-line glance, from the board's model (model.js).
//
// The board is Markdown: the headings are the renderer's own, in the words of design
// section 5.2, and each entry is one "- " line. Every text from the model goes through
// oneLine again, so a model made anywhere else can't bring Markdown of its own; then any
// address in it (https://…, www.…, someone@somewhere) is put in backticks, so it shows
// as text and never as a link. The whole keeps within CONTEXT_CHARS: while it is too
// long, the section with the most text loses its last entry, and says "and N more".
// Nothing here throws.
import { CONTEXT_CHARS } from '../lib/core-numbers.js';
import { sayTime } from '../settings/effective.js';
import { NO_STATE, dollarWords, oneLine, tokenWords } from './model.js';
import { STOP_LINE } from './health.js';

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

// "1.2M tokens, about $84", leaving out what isn't known; '' when neither is.
function spend(tokens, usd) {
  return [isNumber(tokens) ? tokenWords(tokens) : null, isNumber(usd) ? `about ${dollarWords(usd)}` : null].filter(Boolean).join(', ');
}

// Puts each word a viewer would link in backticks, with any closing punctuation left outside.
// oneLine leaves no backtick in a text, so the code span can't be closed early.
export const unlinked = (line) => line.split(' ').map((word) => {
  if (!ADDRESS.test(word)) return word;
  const [, core, tail] = /^(.*?)([.,;:!?]*)$/.exec(word);
  return ADDRESS.test(core) ? `\`${core}\`${tail}` : `\`${word}\``;
}).join(' ');

function directorSections(d) {
  const launch = isRecord(d.launch) ? d.launch : {};
  const inProgress = isRecord(d.inProgress) ? d.inProgress : {};
  const ideas = isRecord(d.ideas) ? d.ideas : {};
  const budget = isRecord(d.budget) ? d.budget : {};
  const week = isRecord(budget.week) ? budget.week : {};
  const weekWords = [
    isNumber(week.tokens) ? tokenWords(week.tokens) : null,
    isNumber(week.usd) ? `about ${dollarWords(week.usd)} at API prices` : null,
    isNumber(budget.share) ? `${Math.round(budget.share)}% of your weekly allowance` : null,
  ].filter(Boolean).join(', ');
  return [
    ['Waiting on you', records(d.waiting).map((w, i) => {
      const since = dayOf(w.since);
      // The number's full stop is escaped, so the entry isn't read as a list of its own.
      return `${Number.isInteger(w.n) ? w.n : i + 1}\\. ${words(w.what) || 'A question'}${since ? `, waiting since ${since}` : ''}`;
    })],
    ['Progress to launch', [
      ...(PHASES[launch.phase] ? [`Phase: ${PHASES[launch.phase]}`] : []),
      ...(Number.isInteger(launch.total) && launch.total > 0 ? [`Launch blockers: ${Number.isInteger(launch.resolved) ? launch.resolved : 0} of ${launch.total} resolved`] : []),
      ...list(launch.blockers).map(words).filter(Boolean).map((what) => `Blocker: ${what}`),
      ...list(launch.next).map(words).filter(Boolean).map((what) => `Next: ${what}`),
    ]],
    ['Work in progress', LANES.flatMap(([lane, name]) => records(inProgress[lane]).map((w) => {
      const step = words(w.step);
      return `${name}: ${words(w.title) || 'Untitled work'}${step ? `, ${step}` : ''}`;
    }))],
    ['What changed for users', records(d.changed).map((c) => `${words(c.what) || 'A change'}${onDay(c.at)}`)],
    ['The ideas list', WHEN.flatMap(([when, name]) => list(ideas[when]).map(words).filter(Boolean).map((idea) => `${name}: ${idea}`))],
    ['Health', records(d.health).map((line) => words(line.text)).filter(Boolean)],
    ['Budget', [
      ...(weekWords ? [`This week: ${weekWords}`] : []),
      ...list(budget.unusual).map(words).filter(Boolean),
      ...(budget.setting === 'report' ? ['Budget: spending is reported, with no limit set'] : []),
    ]],
    ['Rulings made within the rules', records(d.rulings).filter((r) => words(r.what)).map((r) => `${words(r.what)}${onDay(r.at)}`)],
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
    ['Features and their slices', records(b.features).map((f) => {
      const lane = LANES.find(([key]) => key === f.lane);
      const slice = isRecord(f.slice) && Number.isInteger(f.slice.n) && Number.isInteger(f.slice.m) ? `slice ${f.slice.n} of ${f.slice.m}` : null;
      const pr = Number.isInteger(f.pr) && f.pr > 0 ? `pull request #${f.pr}` : null;
      const state = [words(f.step), slice, pr].filter(Boolean).join(', ');
      return `${words(f.title) || words(f.work) || 'Untitled work'}${lane ? ` (${lane[1].toLowerCase()})` : ''}${state ? `: ${state}` : ''}`;
    })],
    ['Open pull requests', records(b.pullRequests).filter((p) => Number.isInteger(p.pr) && p.pr > 0).map((p) => {
      const work = words(p.work);
      const blocked = typeof p.blocked === 'string' ? `blocked${words(p.blocked) ? `: ${words(p.blocked)}` : ''}; ` : '';
      return `Pull request #${p.pr}${work ? ` for ${work}` : ''}: ${blocked}${reviewWords(p)}`;
    })],
    ['Quality this week', reviews > 0
      ? [`${reviews} ${reviews === 1 ? 'review' : 'reviews'}, ${count(quality.withFindings)} with findings, ${count(quality.findings)} ${count(quality.findings) === 1 ? 'finding' : 'findings'} in all`]
      : []],
    ['Decisions made along the way', records(b.decisions).filter((d) => words(d.what)).map((d) => {
      const why = words(d.why);
      return `${words(d.what)}${why ? `: ${why}` : ''}${onDay(d.at)}`;
    })],
    ['Shortcuts and risks', records(b.risks).filter((r) => words(r.what)).map((r) => {
      const later = words(r.costLater);
      return `${words(r.what)}${later ? `; it would cost later: ${later}` : ''}`;
    })],
    ['Usage by part', [
      ...PARTS.map(([key, name]) => {
        const figure = isRecord(usage[key]) ? usage[key] : {};
        const said = spend(figure.tokens, figure.usd);
        return said ? `${name}: ${said}` : null;
      }).filter(Boolean),
      ...(isNumber(usage.subagents) && usage.subagents > 0 ? [`Subagents: ${tokenWords(usage.subagents)}`] : []),
    ]],
  ];
}

// A section as it is cut so far: `shown` of its entries, then "and N more" for the rest.
function sectionLines(section) {
  if (section.items === null) return [section.heading];
  if (section.items.length === 0) return [section.heading, 'None'];
  const lines = [section.heading, ...section.items.slice(0, section.shown)];
  if (section.shown < section.items.length) lines.push(more(section));
  return lines;
}
const more = (section) => `- and ${section.items.length - section.shown} more`;

// A section's length as sectionLines would join it, from the characters of its shown entries
// (each with the new line before it), without joining them.
function lengthOf(section, shownChars) {
  if (section.items === null) return section.heading.length;
  if (section.items.length === 0) return section.heading.length + '\nNone'.length;
  const cut = section.shown < section.items.length ? 1 + more(section).length : 0;
  return section.heading.length + shownChars + cut;
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
    const section = sections[longest];
    section.shown -= 1;
    shownChars[longest] -= section.items[section.shown].length + 1;
    const length = lengthOf(section, shownChars[longest]);
    total += length - lengths[longest];
    lengths[longest] = length;
  }
  const text = sections.map((s) => sectionLines(s).join('\n')).join('\n\n');
  if (text.length <= limit) return text;
  const within = text.slice(0, limit + 1);
  const end = within.lastIndexOf('\n');
  return end > 0 ? within.slice(0, end).trimEnd() : `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '')}…`;
}

// renderBoard(model, { tab, limit }): the chosen tab first ('director' unless 'build' is asked for),
// then the other. Changes waiting for the director's confirmation come before both, and what
// couldn't be read after both, each only when there is some. `limit` is CONTEXT_CHARS unless a
// caller that adds words of its own asks for less.
export function renderBoard(model, { tab = 'director', limit = CONTEXT_CHARS } = {}) {
  try {
    const m = isRecord(model) ? model : {};
    const director = directorSections(isRecord(m.director) ? m.director : {});
    const build = buildSections(isRecord(m.build) ? m.build : {});
    const project = words(m.project);
    const when = typeof m.builtAt === 'string' && !Number.isNaN(Date.parse(m.builtAt)) ? `as at ${sayTime(m.builtAt)}` : 'the time couldn\'t be read';
    const intro = `Wheelhouse's board${project ? ` for ${project}` : ''}, ${when}.`;
    const missing = isRecord(model) ? list(m.missing).map(words).filter(Boolean) : ['The board couldn\'t be read'];
    const first = list(m.director?.first).map(words).filter(Boolean);

    const section = (heading, items) => {
      const lines = items === null ? null : items.map((item) => `- ${unlinked(item)}`);
      return { heading, items: lines, shown: lines ? lines.length : 0 };
    };
    const tabs = {
      director: [section('## Director', null), ...director.map(([heading, items]) => section(`### ${heading}`, items))],
      build: [section('## Build', null), ...build.map(([heading, items]) => section(`### ${heading}`, items))],
    };
    const order = tab === 'build' ? ['build', 'director'] : ['director', 'build'];
    const sections = [
      section(unlinked(intro), null),
      ...(first.length > 0 ? [section('## Changed without your confirmation', first)] : []),
      ...tabs[order[0]],
      ...tabs[order[1]],
      ...(missing.length > 0 ? [section('## What couldn\'t be read', missing)] : []),
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
