// scripts/desk/visit.js
// What the board-context hook works out about the director's visit from the record itself, beside
// the views it reads through the desk: the briefingGapHours in force, the visit's learning (ruling
// F32), the survey a second look follows and whether the work in flight is offered once more (ruling
// A9). Moved from scripts/hooks/board-context.js, which runs outside the sandbox, so these read the
// files under ~/.wheelhouse as it did; learning's cards are still written through the helper.
import { localViews } from '../hooks/session-start.js';
import { readProfileViews } from '../profile/store.js';
import { effectiveSettings } from '../settings/effective.js';
import { listEvents } from '../state/events.js';
import { cardOutcomes } from '../state/views.js';
import { confirmLine } from '../state/card-lines.js';
import { readEnrolled } from '../state/signing.js';
import { readSurveyAgainAt } from '../briefing/seen.js';
import { UNDER_WAY_TOPIC, LEAVE_FOR_NOW } from '../survey/words.js';
import { clickOutcomes, conceptProposals, conceptSetting, settingProposals } from '../frontdesk/learning.js';
import { levelCard, settingCard, writeSetting } from '../frontdesk/cli.js';
import { profileDir, stateDir } from '../lib/paths.js';
import { BRIEFING_GAP_HOURS } from '../lib/core-numbers.js';
import { wordsOf } from './context.js';
import { readProject } from '../lib/projects.js';
import { switchDue, engineChosen, engineReady, SWITCH_SETTING } from '../engine/switch.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function attempt(read, fallback = null) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// The briefingGapHours in force, read from the settings views alone, so a prompt that needs
// nothing shown asks nothing of the helper.
export function gapHours(project, at) {
  return attempt(() => {
    const views = localViews(project, ['settings']);
    const profile = readProfileViews();
    const settings = effectiveSettings({
      project: isRecord(views?.settings) ? views.settings : {}, profile: isRecord(profile?.settings) ? profile.settings : {}, now: at,
    });
    const value = settings.briefingGapHours?.value;
    return Number.isFinite(value) && value > 0 ? value : BRIEFING_GAP_HOURS;
  }, BRIEFING_GAP_HOURS);
}

// Learning for the visit (ruling F32): the proposals worked out from the project's events, the
// profile's and the board commands, written through the helper (`client`). A profile setting, or a
// level of this project, still waiting for its confirmation, with the words a card names it by, whose
// confirm line no card in this project carries gets its card first (rulings F37, F45): one whose
// card wasn't written, learnt, recorded by the front desk or proposed by the delegation review.
// Each write that fails is left for the next visit, which works it out again.
export async function visitLearning({ project, cwd, client, at, boardAsks, platform = process.platform }) {
  const events = listEvents(stateDir(project), { report: () => {} });
  const own = attempt(() => readProfileViews()) ?? {};
  const views = attempt(() => localViews(project, ['settings', 'unconfirmed'])) ?? {};
  const settings = effectiveSettings({
    project: isRecord(views.settings) ? views.settings : {}, profile: isRecord(own.settings) ? own.settings : {}, now: at,
  });
  const unconfirmed = Array.isArray(own.unconfirmed) ? own.unconfirmed.filter(isRecord) : [];
  const profile = { events: attempt(() => listEvents(profileDir(), { report: () => {} }), []), settings, unconfirmed };
  const enrolled = readEnrolled();
  const words = wordsOf(project, settings, null);
  const tried = async (write) => {
    try {
      await write();
    } catch {
      // Worked out again next visit.
    }
  };

  const lines = new Set(events.filter((e) => e.kind === 'card').map((e) => e.data?.line));
  const levels = Array.isArray(views.unconfirmed) ? views.unconfirmed.filter((u) => isRecord(u) && u.kind === 'level') : [];
  for (const entry of [...unconfirmed.filter((u) => u.kind === 'setting'), ...levels]) {
    if (typeof entry.id !== 'string' || !isRecord(entry.data) || typeof entry.data.words !== 'string') continue;
    const event = { kind: entry.kind, id: entry.id, data: entry.data };
    if (lines.has(confirmLine(event))) continue;
    await tried(async () => {
      const { card } = entry.kind === 'level' ? levelCard(event, words) : settingCard(event, words);
      const got = await client.state.write({ cwd, kind: 'card', data: card });
      if (got?.ok !== true) throw new Error('not written');
    });
  }
  const outcomes = clickOutcomes(events, profile, { enrolled });
  const proposals = [
    ...conceptProposals(events, profile, { now: at, enrolled, outcomes }).map(conceptSetting),
    ...settingProposals(events, profile, { now: at, outcomes, boardAsks }),
  ];
  for (const data of proposals) await tried(() => writeSetting({ client, cwd, data, words }));
  // The switch to the new engine, offered once to a project set up before it (scripts/engine/switch.js). Once it is
  // confirmed, each visit asks the helper for the switch's next step, until the engine can build the project: its pull
  // request opened, the director's approval asked for, then its merge.
  const record = attempt(() => readProject(project));
  const due = attempt(() => switchDue({
    settings: views.settings, unconfirmed: views.unconfirmed, cards: events.filter((e) => e.kind === 'card').map((e) => e.data), record, platform,
  }), false);
  if (due) await tried(() => writeSetting({ client, cwd, data: SWITCH_SETTING, words }));
  const switching = record?.host === 'github' && attempt(() => engineChosen(views.settings, { now: at }) && !engineReady(project), false);
  if (switching) await tried(() => client.engineSwitch({ cwd }));
}

// The survey a second look follows (one taken again after the host was missed), when a briefing or
// the carry-on card mentioned it (`surveyAt`): its data, read from the project's events, or null.
// What it held was said then, so the second look says only what is new (briefingLines' `since`).
export function earlierSurvey(project, survey, surveyAt) {
  if (!isRecord(survey?.data) || survey.data.again !== true || typeof surveyAt !== 'string' || survey.id === surveyAt) return null;
  const found = listEvents(stateDir(project), { report: () => {} }).find((e) => e.kind === 'survey' && e.id === surveyAt);
  return isRecord(found?.data) ? found.data : null;
}

// How long after the director's Leave it for now on setup's carry-on card the work in flight is
// offered once more (ruling A9).
export const OFFER_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;

// Whether this briefing offers the work in flight once more (ruling A9): a week or more after the
// director's Leave it for now on setup's carry-on card, and only until a briefing has offered it
// (seen.json's surveyAgainAt). Its answer is a plain card-answer, so the project's events say it.
export function offerAgainDue(project, at) {
  if (readSurveyAgainAt(project) !== null) return false;
  const events = listEvents(stateDir(project), { report: () => {} });
  const left = cardOutcomes(events, readEnrolled()).find((o) => o.card.data?.topic === UNDER_WAY_TOPIC && o.decided?.label === LEAVE_FOR_NOW);
  return left !== undefined && at.getTime() - Date.parse(left.decided.at) >= OFFER_AGAIN_MS;
}
