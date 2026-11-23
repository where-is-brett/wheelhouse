// scripts/update/panel.js
// The update command's own card about adding the Wheelhouse panel to VS Code, asked apart from the Update card: adding software
// to VS Code is the director's choice and is not part of Update. "Not now" is kept for this computer, in Wheelhouse's home, with the
// release it was said to, and the first install is not offered again within that minor release (0.3.x), only in a later one, or when
// the director asks (they click Install the panel on a card from the update command, or add it by hand).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { composeCard } from '../cards/compose.js';

export const INSTALL_THE_PANEL = 'Install the panel';
export const NOT_NOW_PANEL = 'Not now';

const file = () => path.join(wheelhouseHome(), 'panel-declined.json');
const minorOf = (version) => /^v?(\d+)\.(\d+)\./.exec(String(version))?.slice(1, 3).join('.') ?? null;

// The release Not now was said to on this computer, or null (none, or a damaged file).
export function panelDeclined() {
  try {
    const version = JSON.parse(fs.readFileSync(file(), 'utf8'))?.version;
    return typeof version === 'string' && minorOf(version) !== null ? { version } : null;
  } catch {
    return null;
  }
}

// Whether the install is not offered for `version`: Not now was said within the same minor release.
export const panelHeld = (version) => {
  const said = panelDeclined();
  return said !== null && minorOf(said.version) === minorOf(version);
};

// Records Not now for `version`, in place of any earlier one.
export function declinePanel(version) {
  if (minorOf(version) === null) throw new Error('Only a release version can be declined');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const temp = `${file()}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ version: String(version).replace(/^v/, '') })}\n`);
  fs.renameSync(temp, file());
}

// The card, as AskUserQuestion takes it: a composed card of kind panel whose one set line names the panel's version and the showing
// (`token`, in full 64 hex characters), so the director's click on it is signed as the click for that showing and no other.
export function panelCard({ to, token }) {
  return composeCard({
    kind: 'panel',
    level: 3,
    what: `The panel (${to}) is a small panel beside the chat that shows your cards.`,
    why: 'It adds software to VS Code on this computer, so it is your choice. Wheelhouse works in the chat without it.',
    options: [
      { label: INSTALL_THE_PANEL, says: 'Wheelhouse adds it to VS Code now. VS Code then needs a reload, and a Pair it step in Wheelhouse\'s window follows, so the panel\'s clicks count.' },
      { label: NOT_NOW_PANEL, says: 'Nothing is added, and the panel is not offered again until a release that adds features.' },
    ],
    recommend: INSTALL_THE_PANEL,
    because: 'VS Code can remove it again, and no setting changes',
    meanwhile: 'Meanwhile nothing changes, and Wheelhouse works in the chat as it does.',
    target: { to, offer: token },
  }).question;
}

const offerFile = (folder) => path.join(folder, 'panel-offer.json');

// Keeps the showing, in the update's journal folder, where only the helper writes: its version, a fresh token, the time and the card
// as given. The director's signed click must name this token (scripts/hooks/prompt-record.js).
export function showOffer({ folder, to, now = () => new Date() }) {
  const token = crypto.randomBytes(32).toString('hex');
  const card = panelCard({ to, token });
  fs.mkdirSync(folder, { recursive: true });
  const temp = `${offerFile(folder)}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ to, token, at: now().toISOString(), card })}\n`);
  fs.renameSync(temp, offerFile(folder));
  return card;
}

export const readOffer = (folder) => {
  try { return JSON.parse(fs.readFileSync(offerFile(folder), 'utf8')); } catch { return null; }
};

// Marks the showing as answered, so one click is one answer.
export function useOffer(folder) {
  const offer = readOffer(folder);
  if (offer !== null) fs.writeFileSync(offerFile(folder), `${JSON.stringify({ ...offer, used: true })}\n`);
}
