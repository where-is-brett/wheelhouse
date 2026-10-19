// types/index.d.ts
// The mod's contract: the values it keeps in the session's `$.state`, under its own name. Claude
// Code holds every `$.state` key the mod names to this file.

// A waiting card as the pane's model holds it (scripts/mod/status.js). Its text is drawn whole.
export type WheelhousePaneCard = {
  id?: string;
  n?: number;
  header?: string;
  kind?: string;
  text?: string;
  hash?: string;
  buttons?: string[];
  note?: string | null;
  blocking?: boolean;
  asked?: boolean;
};

// A health line, `of` naming STOP's own line ('stop') or an incident's.
export type WheelhouseHealthLine = { level?: string; text?: string; of?: string | null };

// The pane's model as the bridge sends it (scripts/mod/status.js paneModel). It comes from
// another process, so every field is read as possibly missing.
export type WheelhousePaneModel = {
  v?: number;
  project?: string;
  at?: string | null;
  glance?: string;
  stop?: { on?: boolean; since?: string | null };
  cards?: WheelhousePaneCard[];
  building?: string[];
  health?: WheelhouseHealthLine[];
  usage?: string | null;
  finished?: string[];
  incidents?: string[];
  watcher?: string | null;
  missing?: string[];
};

declare module 'claude-code' {
  interface PluginState {
    wheelhouse: {
      // The last pane the bridge answered, and when the mod read it (`$.clock.now()`'s ms).
      pane: { model: WheelhousePaneModel; readAt: number };
      // The last tick: when it ended and whether it failed.
      tick: { at: number; failed: boolean };
      // The id of the card the pane shows.
      card: string;
      // Whether a turn of the main loop is running.
      busy: boolean;
      // Where the session drew at its start, as session.start said; null for none.
      surface: string | null;
      // The role the last tick answered: 'front-desk', 'foreman' or 'feature'.
      role: string;
    };
  }
}
