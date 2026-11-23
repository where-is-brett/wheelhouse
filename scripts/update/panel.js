// scripts/update/panel.js
// The update command's own question about adding the Wheelhouse panel to VS Code, asked apart from the Update card: adding software
// to VS Code is the director's choice and is not part of Update. "Skip for now" is kept for this computer, in Wheelhouse's home, with the
// release it was said to, and the first install is not offered again within that minor release (0.3.x), only in a later one, or when
// the director asks (they click Install the panel on a card from the update command, or add it by hand).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { composeCard } from '../cards/compose.js';

export const INSTALL_THE_PANEL = 'Install the panel';
// The composer refuses Not now on a question card (ruling R50), so the label is Skip for now.
export const NOT_NOW_PANEL = 'Skip for now';

const file = () => path.join(wheelhouseHome(), 'panel-declined.json');
const minorOf = (version) => /^v?(\d+)\.(\d+)\./.exec(String(version))?.slice(1, 3).join('.') ?? null;

// The release "Not now" was said to on this computer, or null (none, or a damaged file).
export function panelDeclined() {
  try {
    const version = JSON.parse(fs.readFileSync(file(), 'utf8'))?.version;
    return typeof version === 'string' && minorOf(version) !== null ? { version } : null;
  } catch {
    return null;
  }
}

// Whether the install is not offered for `version`: "Not now" was said within the same minor release.
export const panelHeld = (version) => {
  const said = panelDeclined();
  return said !== null && minorOf(said.version) === minorOf(version);
};

// Records "Not now" for `version`, in place of any earlier one.
export function declinePanel(version) {
  if (minorOf(version) === null) throw new Error('Only a release version can be declined');
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const temp = `${file()}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ version: String(version).replace(/^v/, '') })}\n`);
  fs.renameSync(temp, file());
}

// The question, as AskUserQuestion takes it: { question, header, recommend, options, multiSelect }.
export function panelCard({ to }) {
  return composeCard({
    kind: 'question',
    level: 2,
    what: `Add the Wheelhouse panel (${to}) to VS Code? It is a small panel beside the chat that shows your cards.`,
    why: 'It adds software to VS Code on this computer, so it is your choice. Wheelhouse works in the chat without it.',
    options: [
      { label: INSTALL_THE_PANEL, says: 'Wheelhouse adds it to VS Code now. VS Code then needs a reload.' },
      { label: NOT_NOW_PANEL, says: 'Nothing is added. The next Wheelhouse release with a new second number offers it again, and setup offers it whenever you run it.' },
    ],
    recommend: INSTALL_THE_PANEL,
    because: 'VS Code can remove it again, and no setting changes',
    meanwhile: 'Meanwhile nothing changes, and Wheelhouse works in the chat as it does.',
    suggest: false,
  }).question;
}
