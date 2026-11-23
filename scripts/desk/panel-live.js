// scripts/desk/panel-live.js
// Which projects have a live panel beside the chat, and which cards the director asked to have in the chat (spec 3).
// Both are kept in the helper's own process, never in a file an agent could write: a panel is live only after a watch
// signed by a paired app's key (deskCore's `watch`), and a mark lasts for a short while.

// The panel is live for this long after its last signed watch; the add-on watches at least every 15 seconds.
export const PANEL_LIVE_MS = 45000;
// An Ask me here mark lasts this long, and is taken once.
export const ASK_HERE_MS = 120000;

const panels = new Map(); // project -> { client, at }
const asks = new Map(); // project -> Map(card id -> at)

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
}

// Marks the card `cardId` of `project` as one the director wants asked in the chat.
export function markAskHere(project, cardId, nowMs) {
  if (typeof project !== 'string' || typeof cardId !== 'string' || !Number.isFinite(nowMs)) return;
  if (!asks.has(project)) asks.set(project, new Map());
  asks.get(project).set(cardId, nowMs);
}

// The cards of `project` marked within ASK_HERE_MS of `nowMs`, which are then forgotten: a mark is taken once. Older marks are dropped.
export function takeAskHere(project, nowMs) {
  const marked = asks.get(project);
  if (marked === undefined) return [];
  const live = [...marked].filter(([, at]) => nowMs >= at && nowMs - at <= ASK_HERE_MS).map(([id]) => id);
  asks.delete(project);
  return live;
}
