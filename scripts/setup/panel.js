// scripts/setup/panel.js
// The optional offer of the Wheelhouse panel for VS Code, asked in step 6 once the coding agent is set up (design 23 November 2026,
// section 8). It is asked only where the release carries the panel's package, VS Code is on this computer, and no company list
// leaves the panel out. An answer of Install the panel adds one line to step 6's card and one change to its list; Skip for now is
// a kept answer, so the offer is not asked again in this run; running setup again asks it again. (The composer refuses a put-off button on a question card, scripts/cards/compose.js, so the label is Skip for now.) The install runs
// in step 6's apply, after the director's Go ahead on the card that names it. Nothing here throws.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addonOffer } from '../update/addon.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PANEL_ASK_ID = 'panel';
export const PANEL_ANSWER = `6.${PANEL_ASK_ID}`;
export const PANEL_LABELS = Object.freeze({ install: 'Install the panel', update: 'Update the panel', skip: 'Skip for now' });

// The question card's words, for an offer { kind, from?, to }.
export function panelAsk(offer) {
  const update = offer.kind === 'update';
  const label = update ? PANEL_LABELS.update : PANEL_LABELS.install;
  return {
    id: PANEL_ASK_ID,
    card: {
      level: 2,
      what: update
        ? `The Wheelhouse panel in VS Code is ${offer.from}, and this release has ${offer.to}. Update it?`
        : `Add the Wheelhouse panel to VS Code (${offer.to})? It is a small panel beside the chat that shows your cards. It is optional.`,
      why: `It adds software to VS Code on this computer, so it's your choice. Wheelhouse works in the chat without it; with it, the cards that wait for you sit in the panel.`,
      options: [
        { label, says: update ? 'The next card lists it with the rest, and it is brought up to date on your Go ahead.' : 'The next card lists it with the rest, and it is added on your Go ahead.' },
        { label: PANEL_LABELS.skip, says: 'The panel is left as it is. Run setup again to add it.' },
      ],
      recommend: label,
      because: 'it needs no setting changed, and VS Code can remove it again',
      meanwhile: 'Setup waits at this step; nothing changes.',
    },
  };
}

// The answer to the question: 'install' | 'update' (the director said yes), 'skip', or null when it was not asked or answered.
export function panelChosen(answers) {
  const label = answers?.[PANEL_ANSWER]?.label;
  if (label === PANEL_LABELS.install) return 'install';
  if (label === PANEL_LABELS.update) return 'update';
  return label === PANEL_LABELS.skip ? 'skip' : null;
}

// The planned change for an offer the director accepted. The list is hashed, so it holds only the offer.
export const panelChange = (offer) => ({ kind: 'panel', target: 'the Wheelhouse panel in VS Code', what: 'panel', offer });

// The line step 6's card carries for it.
export const panelLine = (change) => (change.offer.kind === 'update'
  ? `the Wheelhouse panel in VS Code is brought from ${change.offer.from} to ${change.offer.to}; VS Code then needs a reload`
  : `the Wheelhouse panel (${change.offer.to}) is added to VS Code; VS Code then needs a reload`);

// The release's version, which the panel carries.
function ownVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null; } catch { return null; }
}

// The real offer, read when step 6 is planned: { offer } to ask, { blocked: <line> } when a company list leaves the panel out,
// or {} when there is nothing to offer (this release has no package for it, or VS Code isn't here, or it is current).
export async function realOffer({
  platform = process.platform, env = process.env, run, home = os.homedir(), root = ROOT, present, listAllowed,
} = {}) {
  try {
    if (!fs.existsSync(path.join(root, 'vscode', 'vsix.sha256'))) return {};
    const offer = await addonOffer({ platform, env, ...(run === undefined ? {} : { run }), ...(present === undefined ? {} : { present }), pluginVersion: ownVersion() });
    if (offer === null) return {};
    const { addonAllowed, NOT_ALLOWED_LINE } = await import('../addon/allowed.js');
    if ((await (listAllowed ?? addonAllowed)({ platform, env, home, version: offer.to }))?.allowed === false) return { blocked: NOT_ALLOWED_LINE };
    return { offer };
  } catch {
    return {};
  }
}

// The real install, run in step 6's apply: { ok, says }.
export async function realInstall({ platform = process.platform, env = process.env, run } = {}) {
  const { installPanel } = await import('../addon/install.js');
  return installPanel({ root: ROOT, platform, env, ...(run === undefined ? {} : { run }) });
}
