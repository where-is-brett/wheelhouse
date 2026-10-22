// types/index.d.ts
// The mod's contract: the values it keeps in the session's `$.state`, under its own name. Claude
// Code holds every `$.state` key the mod names to this file.

// A button the bridge gave a card (scripts/mod/buttons.js): its label, whether a press records it
// ('record'), hands the front desk a prompt ('turn'), opens the card's reasons ('why') or opens the
// box for the director's words ('suggest'), and its shape: 'filled', 'outlined', 'small' or 'link'.
// A link carries its address in `href`; `corner` marks Not now, drawn in the card's header row.
// The mod draws the label and sends it; `does` is the bridge's.
export type WheelhouseCardButton = { label?: string; does?: string; shape?: string; href?: string; corner?: boolean };

// A card's parts as the composer keeps them (scripts/cards/compose.js), in plain words. Every field
// is read as possibly missing.
export type WheelhouseCardParts = {
  kind?: string;
  header?: string;
  ask?: string;
  what?: string;
  small?: string;
  recommendation?: string;
  options?: { label?: string; says?: string; recommended?: boolean }[];
  why?: string;
  meanwhile?: string;
  checks?: string;
  changed?: string;
  line?: string | null;
  code?: string | null;
  suggest?: boolean;
  optional?: number;
  revises?: string;
};

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
  // The card's parts, or null for a card with none, which is drawn as its text.
  parts?: WheelhouseCardParts | null;
  // When the director last suggested a change on it, as HH:MM in the computer's own time, or null.
  steered?: string | null;
  // "asked 2 hours ago", or null.
  waited?: string | null;
  // Whether it is a revised proposal, replacing a card.
  revised?: boolean;
};

// A piece of work being built, and when the director will see it (null for the line "and 2 more").
export type WheelhouseBuilding = { text?: string; see?: string | null };

// Progress to launch: blockers resolved of all, those resolved since the director's last visit, and
// what is next, the director's own marked.
export type WheelhouseLaunch = { resolved?: number; total?: number; gained?: number; next?: { text?: string; yours?: boolean }[] };

// The health group's facts: whether all is well, the protection level (Standard or Locked) and the
// week's share line. `health` stays the list of lines at watch or stop.
export type WheelhouseHealthNote = { allWell?: boolean; protection?: string | null; week?: string | null };

// A health line, `of` naming STOP's own line ('stop') or an incident's.
export type WheelhouseHealthLine = { level?: string; text?: string; of?: string | null };

// The pane's model as the bridge sends it (scripts/mod/status.js paneModel). It comes from
// another process, so every field is read as possibly missing.
export type WheelhousePaneModel = {
  v?: number;
  project?: string;
  at?: string | null;
  glance?: string;
  // The one-line verdict, and the line saying when the director was last here (null for never).
  verdict?: string;
  since?: string | null;
  launch?: WheelhouseLaunch | null;
  ideas?: { count?: number; fresh?: number };
  // When the model was built, as HH:MM.
  updated?: string | null;
  stop?: { on?: boolean; since?: string | null };
  cards?: WheelhousePaneCard[];
  // Each piece of work as { text, see }; a model an older bridge wrote holds lines of words instead.
  building?: (WheelhouseBuilding | string)[];
  health?: WheelhouseHealthLine[];
  healthNote?: WheelhouseHealthNote;
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
      // The id of the card whose Why? is open in place, or null.
      why: string | null;
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
      // The card whose Suggest a change… box is open, and the words typed in it so far, or null.
      // Kept only while the box is open; cleared on Send, on Cancel and at a session's start.
      suggesting: { card: string; words: string } | null;
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
