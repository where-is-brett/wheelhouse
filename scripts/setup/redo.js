// scripts/setup/redo.js
// Changing a setup answer (design section 15.1, the director's ruling of 26 October 2026: any answer
// can be changed until the step that uses it has run, and after that a short card offers what
// changing it takes, never a flat "not possible").
//
// A choice still open (its step not run) is changed by asking its own card again: the new click is
// a fresh signed answer, and the old one lapses. A choice a step has acted on gets a redo card, a
// question of step 0 (scripts/setup/choices.js), whose id names it and how many answers the run
// held, so it is never the same card twice:
//   - real users, after step 3: the phase changes at once with the click (its card writes the
//     `phase` setting, signed by the prompt record); Locked is then offered from Settings.
//   - the description, once answered: the glossary entry changes at once with the click.
//   - live data or Apple signing, after step 7 has saved the project's settings: Change it after
//     setup, which the front desk starts as a reviewed change right after the first briefing
//     (changeRequests, which /setup/health gives once the board is green), or Keep it.
//   - the host, the connection, or new versus from another computer, after step 3: Set up again,
//     which removes Wheelhouse from the project by uninstall's own card and then starts setup
//     afresh (setUpAgainAsked, which /setup/status gives), or Keep it.
// Live data and Apple signing changed after step 4 settled but before step 7 ran need no redo card:
// their own card is asked again, and the engine settles step 4 again on the new answer
// (stepFourDrift).
import { askedRecord } from './clicks.js';
import { REAL_USERS } from './host.js';
import { LIVE_DATA, PRODUCT, SIGNS_APPS, MEANWHILE } from './questions.js';
import { ONE_CARD_STEP, aboutOf, actedBy } from './choices.js';

export const CHANGE_AFTER = 'Change it after setup';
export const KEEP = 'Keep it';
export const AGAIN = 'Set up again';
export const STEP_FOUR_KEYS = Object.freeze(['4.live-data', '4.apple-apps']);
const REDO = /^redo-([a-z-]+)-[0-9]+$/;

// The newest answer of the run to each kind of choice, by what it is about, for the choices not in
// `open`: { key, label, text, at }.
function answeredOutside(open, answers) {
  const kinds = new Map();
  for (const [key, a] of Object.entries(answers)) {
    if (!/^[34]\./.test(key) || open.some((c) => c.key === key)) continue;
    const about = aboutOf(key);
    const was = kinds.get(about);
    if (!was || Date.parse(a.at) > Date.parse(was.at)) kinds.set(about, { key, ...a });
  }
  return [...kinds.values()];
}

// Every choice of the run, for the director to name one: those still open, as openChoices gives them,
// then those a step has used. Each { key, about, chosen, acted }: `chosen` the answer as it stands (a
// label or typed text), `acted` whether changing it takes more than a new answer. `doneOrRunning(n)`
// says whether step n has run or is running.
export function choiceList({ open, answers, doneOrRunning }) {
  const now = open.map((c) => ({ key: c.key, about: aboutOf(c.key), chosen: c.text ?? c.label, acted: false }));
  const used = answeredOutside(open, answers).map((a) => {
    const step = actedBy(a.key);
    return { key: a.key, about: aboutOf(a.key), chosen: a.text ?? a.label, acted: step === null ? true : doneOrRunning(step) };
  });
  return [...now, ...used];
}

const HOST_NAME = { github: 'GitHub', gitlab: 'GitLab' };

// The redo card for a choice a step has used: { id, card, typed, writes, found }, `card` the
// composer's question input. `answers` are the run's; `name` the product's; `record` its project
// record ({ host }), or null; `described` the README's words, or null; `count` how many answers the
// run holds. Gives null for a choice that needs none (live data or Apple signing before step 7, or a
// key that is no choice).
export function redoCard({ key, answers, name, record, described, count, stepRan }) {
  const id = key.slice(key.indexOf('.') + 1);
  const n = count;
  if (id === 'real-users') {
    const phase = (value) => [{ kind: 'setting', data: { key: 'phase', value } }];
    return {
      id: `redo-real-users-${n}`,
      card: {
        level: 2,
        what: `Does ${name} have real users now: people who rely on it, beyond you and anyone testing it?`,
        why: 'It sets how carefully agents treat it. Locked is then offered from Settings, under Protection.',
        options: [
          { label: REAL_USERS.yes, says: 'It is recorded as launched.' },
          { label: REAL_USERS.no, says: 'It is recorded as before launch.' },
        ],
        recommend: answers['3.real-users']?.label === REAL_USERS.yes ? REAL_USERS.no : REAL_USERS.yes,
        because: 'you asked to change it',
        meanwhile: 'Nothing else changes.',
      },
      writes: { labels: { [REAL_USERS.yes]: phase('launched'), [REAL_USERS.no]: phase('before-launch') } },
    };
  }
  if (id.startsWith('product-')) {
    const entry = (plain) => ({ kind: 'glossary', data: { term: name, plain } });
    const options = [
      ...(described === null ? [] : [{ label: PRODUCT.readme, says: `"${described}"` }]),
      { label: PRODUCT.shaping, says: 'No description yet; you can give one to the front desk later.' },
    ];
    return {
      id: `redo-describe-${n}`,
      typed: true,
      card: {
        level: 2,
        what: `In a sentence, what is ${name}, and who uses it? Type it as your answer.`,
        why: 'Wheelhouse explains its work to you in terms of your product.',
        options,
        recommend: options[0].label,
        because: described === null ? 'you can describe it later' : 'it is how the project already describes itself',
        meanwhile: 'Nothing else changes.',
      },
      writes: { labels: described === null ? {} : { [PRODUCT.readme]: [entry(described)] }, typed: [{ ...entry(''), typedInto: 'plain' }] },
    };
  }
  if (id === 'live-data' || id === 'apple-apps') {
    if (!stepRan(7)) return null;
    const live = id === 'live-data';
    const now = answers[key]?.label;
    const want = live
      ? (now === LIVE_DATA.yes ? 'say it has no live data' : 'say it has live data, so agents use test data only')
      : (now === SIGNS_APPS.yes ? 'keep builds away from your saved passwords' : 'let builds use your saved passwords to sign the app');
    return {
      id: `redo-${id}-${n}`,
      card: {
        level: 2,
        what: `${live ? 'Live data' : 'Apple signing'} is saved in the project's settings now. Change them to ${want}?`,
        why: 'The project\'s settings change only through a reviewed change, which you approve.',
        options: [
          { label: CHANGE_AFTER, says: 'The front desk starts the change right after the first briefing, and you approve it as usual.' },
          { label: KEEP, says: 'It stays as it is.' },
        ],
        recommend: CHANGE_AFTER,
        because: 'you asked to change it',
        meanwhile: MEANWHILE,
      },
      found: [`Change the project's settings to ${want}.`],
    };
  }
  if (actedBy(key) === 3) {
    const host = HOST_NAME[record?.host] ?? 'its host';
    return {
      id: `redo-again-${n}`,
      card: {
        level: 3,
        what: `${name} is already set up on ${host}, so changing ${aboutOf(key)} means setting it up again.`,
        why: 'The repository and the connection already exist, and setup changes neither in place.',
        options: [
          { label: AGAIN, says: 'Wheelhouse is removed from the project, on uninstall\'s own card, and setup then starts afresh. Your project\'s files stay.' },
          { label: KEEP, says: 'It stays as it is.' },
        ],
        recommend: KEEP,
        because: 'nothing is lost by keeping it, and setting up again takes a few minutes',
        meanwhile: 'Nothing changes until you choose.',
      },
    };
  }
  return null;
}

// The newest answer to each kind of redo card in the run: { kind, id, label, text, at }.
function redoAnswers(answers) {
  const kinds = new Map();
  for (const [key, a] of Object.entries(answers)) {
    if (!key.startsWith(`${ONE_CARD_STEP}.`)) continue;
    const m = REDO.exec(key.slice(2));
    if (!m) continue;
    const was = kinds.get(m[1]);
    if (!was || Date.parse(a.at) > Date.parse(was.at)) kinds.set(m[1], { kind: m[1], id: key.slice(2), ...a });
  }
  return [...kinds.values()];
}

// The changes the director asked for after setup, each in their words for the front desk to start:
// live data or Apple signing changed once step 7 had saved them (Change it after setup).
export function changeRequests(runId, answers) {
  return redoAnswers(answers).filter((a) => ['live-data', 'apple-apps'].includes(a.kind) && a.label === CHANGE_AFTER)
    .flatMap((a) => askedRecord(runId, ONE_CARD_STEP, a.id)?.found ?? []).filter((line) => typeof line === 'string');
}

// Whether the director's newest answer on a Set up again card asked for it.
export function setUpAgainAsked(answers) {
  return redoAnswers(answers).some((a) => a.kind === 'again' && a.label === AGAIN);
}

// Whether step 4 settled on live data or Apple signing that the run's answers now say differently,
// so it is to settle again before step 7 uses them. `settled` is step 4's newest settled record.
export function stepFourDrift(settled, answers) {
  if (!settled || typeof settled !== 'object') return false;
  const live = answers['4.live-data'];
  if (live && (live.label === LIVE_DATA.yes) !== (settled.liveData === true)) return true;
  const apple = answers['4.apple-apps'];
  return Boolean(apple) && (apple.label === SIGNS_APPS.yes) !== (settled.signsApps === true);
}
