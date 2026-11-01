// scripts/engine/areas.js
// A goal's areas (unattended goals design, sections 5 and 6), pure and small enough for a hook to load: which paths fall
// outside them, and the card that lets one head of a pull request past them. `areas` is { may?: [glob], wontTouch: [glob] }.
// A `may` that isn't there leaves everything free but `wontTouch`, as on a fix for a red main line; an empty one allows
// nothing, so a narrowing can never turn into a widening. No areas at all leave every path free.
import { matchGlob } from '../gate/glob.js';

export const ALLOW_ONCE = 'Allow this once';
export const STOP_AREAS = 'Stop here';

const inAny = (patterns, file) => patterns.some((p) => matchGlob(p, file, { ignoreCase: true }));

// The paths of `paths` a run under `areas` may not change.
export function outsideAreas(paths, areas) {
  if (areas === null || typeof areas !== 'object') return [];
  const wontTouch = areas.wontTouch ?? [];
  return paths.filter((file) => inAny(wontTouch, file) || (Array.isArray(areas.may) && !inAny(areas.may, file)));
}

// The card's id for one head of a piece's pull request, so an answer is kept by head and a new head asks again (plan, choice
// 14). A question's id is `q-<work>-<n>`, so the number is read from the head's first twelve characters.
export const areaQuestion = (work, head) => `q-${work}-${Number.parseInt(String(head).slice(0, 12), 16)}`;

// The director's answer on that card, from a verified `answer` action, or null.
export const areaAnswer = (views, work, head) => views?.questions?.[areaQuestion(work, head)]?.answer?.label ?? null;
