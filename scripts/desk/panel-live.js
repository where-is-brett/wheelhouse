// scripts/desk/panel-live.js
// Which projects have a live panel beside the chat, and which cards the director asked to have in the chat (spec 3).
// Both are kept in the helper's own process, never in a file an agent could write: a panel is live only after a watch
// signed by a paired app's key (deskCore's `watch`), and a mark lasts for a short while. A mark goes from the director's click
// (`ask-here`) to the panel's signed read, which takes it, and then to the front desk, which asks the card in the chat once.

// The panel is live for this long after its last signed watch; the add-on watches at least every 15 seconds.
export const PANEL_LIVE_MS = 45000;
// An Ask me here mark lasts this long, and is taken once.
export const ASK_HERE_MS = 120000;

const panels = new Map(); // project -> { client, at }
const asks = new Map(); // project -> Map(card id -> at): marks the director made, not yet taken
const handed = new Map(); // project -> Map(card id -> { at, takenAt }): marks a paired app's read took, for the chat to ask

export function markPanel(project, client, nowMs) {
  if (typeof project !== 'string' || project === '' || !Number.isFinite(nowMs)) return;
  panels.set(project, { client, at: nowMs });
}

// Whether a panel's signed watch for the project is no older than PANEL_LIVE_MS at `nowMs`. Never true for a time before the mark.
export function panelLive(project, nowMs) {
  const mark = panels.get(project);
  if (mark === undefined || !Number.isFinite(nowMs)) return false;
  return nowMs >= mark.at && nowMs - mark.at <= PANEL_LIVE_MS;
}

// For tests: forgets every panel and every Ask me here mark.
export function clearPanels() {
  panels.clear();
  asks.clear();
  handed.clear();
}

// Marks the card `cardId` of `project` as one the director wants asked in the chat.
export function markAskHere(project, cardId, nowMs) {
  if (typeof project !== 'string' || typeof cardId !== 'string' || !Number.isFinite(nowMs)) return;
  if (!asks.has(project)) asks.set(project, new Map());
  asks.get(project).set(cardId, nowMs);
}

// The cards of `project` marked within ASK_HERE_MS of `nowMs` that a paired app's signed read has taken, with when each was
// taken, left as they are: a look, never a take. A mark the panel hasn't taken yet is not here, so a caller that isn't the
// panel (the front desk) never sees, and so never moves, a mark. A mark is live for ASK_HERE_MS from when the director made it.
export function handedAskHere(project, nowMs) {
  const taken = handed.get(project);
  if (taken === undefined) return [];
  return [...taken].filter(([, mark]) => nowMs >= mark.at && nowMs - mark.at <= ASK_HERE_MS).map(([id, mark]) => ({ id, takenAt: mark.takenAt }));
}

// A paired app's signed read takes the cards of `project` marked within ASK_HERE_MS of `nowMs`: they leave the marks and are
// handed to the chat (handedAskHere), and their ids are returned. A mark is taken once; older marks are dropped. Only a read
// the desk has checked as signed by a paired app may call this.
export function takeAskHere(project, nowMs) {
  const marked = asks.get(project);
  if (marked === undefined) return [];
  const live = [...marked].filter(([, at]) => nowMs >= at && nowMs - at <= ASK_HERE_MS);
  asks.delete(project);
  if (live.length > 0 && !handed.has(project)) handed.set(project, new Map());
  for (const [id, at] of live) handed.get(project).set(id, { at, takenAt: nowMs });
  return live.map(([id]) => id);
}
