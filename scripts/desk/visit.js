// scripts/desk/visit.js
// What the board-context hook works out about the director's visit from the record itself, beside
// the views it reads through the desk: the briefingGapHours in force, the survey a second look follows
// and whether the work in flight is offered once more (ruling A9). Moved from scripts/hooks/board-context.js, which runs outside the sandbox, so these read the
// files under ~/.wheelhouse as it did. The visit's learning (ruling F32) is in scripts/desk/visit-learning.js.
import { localViews } from '../lib/local-views.js';
import { readProfileViews } from '../profile/store.js';
import { effectiveSettings } from '../settings/effective.js';
import { listEvents } from '../state/events.js';
import { cardOutcomes } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { stateDir } from '../lib/paths.js';
import { readSurveyAgainAt } from '../briefing/seen.js';
import { UNDER_WAY_TOPIC, LEAVE_FOR_NOW } from '../survey/words.js';
import { BRIEFING_GAP_HOURS } from '../lib/core-numbers.js';

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
