// scripts/desk/memory-source.js
// The desk's source over memory, for the stand-in helper: its events, the views built from them,
// the computers it enrols, and no STOP, board, usage or previews (an evaluation has no host).
// `state` is { project, events(), views(), enrolled, profile }: functions, so each read sees the
// stand-in's state as it is then.
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function memorySource({ project = 'stand-in', events, views, enrolled = [], profile = {}, review } = {}) {
  return {
    project,
    events: () => events(),
    enrolled: () => enrolled,
    async views({ cards = false, answers = false, review: withReview = false } = {}) {
      const built = views();
      const ofKind = (kind) => events().filter((e) => e.kind === kind).map((e) => structuredClone(e));
      return {
        ok: true,
        views: built,
        ...(cards ? { cards: ofKind('card') } : {}),
        ...(answers ? { answers: ofKind('card-answer') } : {}),
        ...(withReview && typeof review === 'function' ? { review: review(built) } : {}),
      };
    },
    async profile() {
      return isPlain(profile) ? profile : {};
    },
    async board() {
      return { none: 'The stand-in helper has no board' };
    },
    async usage() {
      return null;
    },
    async stop() {
      return { on: false };
    },
    async preview() {
      return null;
    },
  };
}
