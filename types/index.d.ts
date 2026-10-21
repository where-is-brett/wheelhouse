// types/index.d.ts
// The mod's contract: the values it keeps in the session's `$.state`, under its own name. Claude
// Code holds every `$.state` key the mod names to this file.

// A button the bridge gave a card (scripts/mod/buttons.js): its label, and whether a press records
// it or hands the front desk a prompt. The mod draws the label and sends it; `does` is the bridge's.
export type WheelhouseCardButton = { label?: string; does?: string };

// A waiting card as the pane's model holds it (scripts/mod/status.js). Its text is drawn whole.
export type WheelhousePaneCard = {
  id?: string;
  n?: number;
  header?: string;
  kind?: string;
  text?: string;
  hash?: string;
  buttons?: WheelhouseCardButton[];
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

// A row of the settings view as the bridge sends it (scripts/mod/settings-pane.js settingsRows).
export type WheelhouseSettingsRow = {
  key?: string;
  label?: string;
  current?: string;
  from?: string;
  until?: string;
  choices?: { id?: string; label?: string; chosen?: boolean }[];
  here?: boolean;
  why?: string;
};

// The press the bridge is recording: where it was made (a card's id, `setting:<key>`, or
// `lift-stop`) and the label pressed.
export type WheelhousePressing = { on: string; label: string };

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
      // The role the last tick answered: 'front-desk', 'foreman', 'feature' or 'setup'.
      role: string;
      // Whether the last answered tick's answer held the pane's model: false for a session given
      // no pane (a front desk outside a project among them). A failed tick leaves it as it was.
      pictured: boolean;
      // The id of the session whose front-desk answer opened the pane: once opened, a tick or a
      // reload only retitles it while it is open. Null once the mod has closed it because the
      // session's role is no longer the front desk's, so the next front-desk answer opens it.
      opened: string | null;
      // The press the bridge is recording, or null: while one is, every other button but STOP is
      // drawn as plain text, so a double press sends once.
      pressing: WheelhousePressing | null;
      // Whether a press of STOP is being recorded.
      stopping: boolean;
      // The session whose courier wake last couldn't be handed on, or null: its toast has shown, and
      // shows again only after a wake is handed on or a turn starts.
      unhanded: string | null;
      // Which view the pane shows: the board or the settings.
      view: 'board' | 'settings';
      // The settings view's rows as the bridge last answered them, its line under them, and
      // whether the last read failed; null while they are being read.
      settings: { rows: WheelhouseSettingsRow[]; text: string | null; failed: boolean } | null;
      // The keys of the settings rows whose Ask the front desk has been handed over since the
      // settings view was last opened. Each is drawn as plain text until the view is opened again,
      // so a double click asks once.
      asked: string[];
    };
  }
}
