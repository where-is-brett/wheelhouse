// scripts/desk/mod-records.js
// What the mod's presses, replies and settings presses read of the record before they sign, on the
// desk's side of the seam: the views built from the private record this moment (a record the helper
// took a moment ago has already spent its card), whether a card confirms a Windows build-commands
// setting, whether an Allow would grant nothing on this computer, the settings views a press reads,
// and the setting event the helper made for a press. Each reads this computer's files in process,
// as the bridge runs outside the sandbox, beside the markers and the pending records the presses keep.
import { computerId, profileDir, stateDir } from '../lib/paths.js';
import { listEvents } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { confirmLine } from '../state/card-lines.js';
import { localViews } from '../hooks/session-start.js';
import { readProfileViews } from '../profile/store.js';
import { BUILD_QUESTION_LABELS, isBuildQuestion, settingKey } from '../protection/windows-builds.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The views and the events they were built from, from the private record as writeViews builds them.
// A reply reads its card in the shown view, and a press on the pane in the waiting view.
export function viewsNow(project, now) {
  const damaged = [];
  const events = listEvents(stateDir(project), { report: () => {}, skipped: damaged });
  return { views: buildViews(events, readEnrolled(), { damaged, now }), events };
}

// Whether `question` carries the confirm line of a Windows build-commands setting, in the project's
// state or the director's profile, as the prompt record would find it. That setting is set only by
// a click on its own card (design section 12.2), so no reply confirms it, whatever card carries it,
// and no pane press does either (press.js).
export function confirmsBuilds(project, question) {
  const builds = (dirOf) => {
    try {
      return listEvents(dirOf(), { report: () => {} }).some((e) => e.kind === 'setting' && typeof e.data?.key === 'string'
        && e.data.key.startsWith(settingKey('')) && question.includes(confirmLine(e)));
    } catch {
      return false;
    }
  };
  return builds(() => stateDir(project)) || builds(profileDir);
}

// Whether an Allow reply on the answer card for question `id` would grant nothing: the question is
// a build-command one, and this isn't the computer that recorded it (unknown counts as another). A
// grant holds only on the computer whose key signed the answer (buildGrants), so an answer signed
// here would close the card and leave the builder's commands unallowed there. A pane press is
// refused the same way (press.js).
export function allowsElsewhere(project, id, label) {
  if (label !== BUILD_QUESTION_LABELS.once && label !== BUILD_QUESTION_LABELS.feature) return false;
  try {
    const asked = listEvents(stateDir(project), { report: () => {} }).filter((e) => e.kind === 'question' && e.data?.id === id).at(-1);
    return isBuildQuestion(asked?.data) && asked.computer !== computerId();
  } catch {
    return true;
  }
}

// The settings views as the last sync left them: { project, profile }, each {} when it can't be read.
export function settingsViews(project) {
  const views = { project: {}, profile: {} };
  try {
    const own = localViews(project, ['settings'])?.settings;
    if (isRecord(own)) views.project = own;
  } catch {
    // None can be read.
  }
  try {
    const profile = readProfileViews()?.settings;
    if (isRecord(profile)) views.profile = profile;
  } catch {
    // None can be read.
  }
  return views;
}

// The setting event the helper made, read back from the clone it kept it in (`home` 'profile' or
// the project's). It must be the setting that was pressed: the key, the value and the end time all
// equal, so an answer naming some other event signs nothing.
export function settingEventOf(home, project, id, data) {
  if (typeof id !== 'string') return null;
  const dir = home === 'profile' ? profileDir() : stateDir(project);
  return listEvents(dir, { report: () => {} }).find((e) => e.id === id && e.kind === 'setting'
    && e.data?.key === data.key && e.data.value === data.value && e.data.until === data.until) ?? null;
}
