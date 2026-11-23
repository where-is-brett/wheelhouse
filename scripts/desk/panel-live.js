// scripts/desk/panel-live.js
// Which projects have a live panel beside the chat, and which cards the director asked to have in the chat (spec 3).
// Both are kept in the helper's own process, never in a file an agent could write: a panel is live only after a watch
// signed by a paired app's key (deskCore's `watch`), and a mark waits a short while for the panel and a longer while for the chat. A mark goes from the director's click
// (`ask-here`) to the panel's signed read, which takes it, and then to the front desk, which asks the card in the chat once.

// The panel is live for this long after its last signed watch; the add-on watches at least every 15 seconds.
export const PANEL_LIVE_MS = 45000;
// An Ask me here mark lasts this long before the panel takes it, and is taken once.
export const ASK_HERE_MS = 120000;
// A mark the panel has taken stays for the chat to ask for this long after it was taken, unless the card is asked or stops waiting.
export const HANDED_MS = 30 * 60 * 1000;

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

// The cards of `project` that a paired app's signed read has taken, with when each was taken, left as they are: a look, never a
// take. A mark the panel hasn't taken yet is not here, so a caller that isn't the panel (the front desk) never sees, and so
// never moves, a mark. A taken mark stays until the card is asked or stops waiting (the desk's waiting view decides that), with
// a cap of HANDED_MS from when it was taken, so the list can't grow without end: the director may not speak to the chat for
// minutes. Entries past the cap are dropped here.
export function handedAskHere(project, nowMs) {
  const taken = handed.get(project);
  if (taken === undefined) return [];
  pruneHanded(taken, nowMs);
  return [...taken].map(([id, mark]) => ({ id, takenAt: mark.takenAt }));
}

// True once, when every card in `cardIds` is one the panel's read handed to the chat of `project` and the mark is still in time;
// removes what it passed. For the card-check hook, which lets a card moved by Ask me here be asked in the chat once, whether or not the
// front desk has already printed it as asked. It makes no mark and moves none the panel didn't take.
export function passHanded(project, cardIds, nowMs) {
  const taken = handed.get(project);
  if (taken === undefined || !Array.isArray(cardIds) || cardIds.length === 0) return false;
  pruneHanded(taken, nowMs);
  if (!cardIds.every((id) => taken.has(id))) return false;
  for (const id of cardIds) taken.delete(id);
  return true;
}

function pruneHanded(taken, nowMs) {
  for (const [id, mark] of taken) if (!(nowMs >= mark.takenAt && nowMs - mark.takenAt <= HANDED_MS)) taken.delete(id);
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
  if (handed.has(project)) pruneHanded(handed.get(project), nowMs);
  for (const [id, at] of live) handed.get(project).set(id, { at, takenAt: nowMs });
  return live.map(([id]) => id);
}
