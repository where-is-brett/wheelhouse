// scripts/desk/visit-learning.js
// The learning the board-context hook runs on a visit's first prompt (ruling F32), in a module of its own so a prompt that runs
// no learning doesn't load what it reads (scripts/desk/visit.js has what every prompt needs).
import { readProfileViews } from '../profile/store.js';
import { effectiveSettings } from '../settings/effective.js';
import { listEvents } from '../state/events.js';
import { confirmLine } from '../state/card-lines.js';
import { readEnrolled } from '../state/signing.js';
import { clickOutcomes, settingProposals } from '../frontdesk/learning.js';
import { settingCard, writeSetting } from '../frontdesk/cli.js';
import { retiredPiece } from '../settings/catalogue.js';
import { profileDir, stateDir } from '../lib/paths.js';
import { wordsOf } from './context.js';
import { readProject } from '../lib/projects.js';
import { chosenWindow } from '../settings/compact-window-pr.js';
import { switchDue, engineChosen, engineReady, SWITCH_SETTING } from '../engine/switch.js';
import { engineWanted } from '../engine/parts.js';
import { localViews } from '../lib/local-views.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function attempt(read, fallback = null) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// Learning for the visit (ruling F32): the proposals worked out from the project's events, the
// profile's and the board commands, written through the helper (`client`). A profile setting, or a
// level of this project, still waiting for its confirmation, with the words a card names it by, whose
// confirm line no card in this project carries gets its card first (rulings F37, F45): one whose
// card wasn't written, learnt, or recorded by the front desk.
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
  // A proposal for a setting that has since been retired (a `known:*` concept, say) gets no card: nothing acts on it.
  for (const entry of unconfirmed.filter((u) => u.kind === 'setting' && retiredPiece(u.data?.key) === undefined)) {
    if (typeof entry.id !== 'string' || !isRecord(entry.data) || typeof entry.data.words !== 'string') continue;
    const event = { kind: entry.kind, id: entry.id, data: entry.data };
    if (lines.has(confirmLine(event))) continue;
    await tried(async () => {
      const { card } = settingCard(event, words);
      const got = await client.state.write({ cwd, kind: 'card', data: card });
      if (got?.ok !== true) throw new Error('not written');
    });
  }
  const outcomes = clickOutcomes(events, profile, { enrolled });
  const proposals = [
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
  // Off the Mac the engine never runs, so the switch's steps are left to a Mac.
  const switching = engineWanted({ platform }) && record?.host === 'github' && attempt(() => engineChosen(views.settings, { now: at }) && !engineReady(project), false);
  if (switching) await tried(() => client.engineSwitch({ cwd }));
  // The compaction window the director chose reaches the project's settings file the same way: each visit asks for the next step.
  if (attempt(() => chosenWindow(views.settings, { now: at }) !== null, false)) await tried(() => client.compactWindow({ cwd }));
}
