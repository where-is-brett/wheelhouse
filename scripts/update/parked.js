// scripts/update/parked.js
// A project whose configuration still names an agent that is parked (scripts/agents/names.js, parkedAgentOf) gets one card in
// the update: that agent is parked, and the project carries on with Claude Code. The card changes nothing in the
// configuration, whose `agents` map is already ignored; the director's answer is the card's own, kept in the project's state.
// The update keeps a record of having asked, per project and agent, in the project's folder under the Wheelhouse home, so a
// later update does not ask again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { composeCard } from '../cards/compose.js';
import { stateDir } from '../lib/paths.js';

export const PARKED_AGENT_CARD = Object.freeze({ carryOn: 'Carry on with Claude Code', leave: 'Leave it for now' });

const AGENT_NAMES = Object.freeze({ copilot: 'Copilot' });
const nameOf = (agent) => AGENT_NAMES[agent] ?? agent;

const fileFor = (project) => path.join(stateDir(project), '..', 'parked-asked.json');

// { <agent>: <when asked> } for the project; empty when none was asked (or the file is damaged).
export function parkedAsked(project) {
  try {
    const got = JSON.parse(fs.readFileSync(fileFor(project), 'utf8'));
    return got !== null && typeof got === 'object' && !Array.isArray(got) ? got : {};
  } catch {
    return {};
  }
}

function markAsked(project, agent, at) {
  const file = fileFor(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ ...parkedAsked(project), [agent]: at })}\n`);
  fs.renameSync(temp, file);
}

// The card, composed: { question, card }. `name` is the project's name as the director knows it.
export function parkedCard({ agent, name }) {
  const shown = nameOf(agent);
  return composeCard({
    kind: 'question',
    level: 2,
    suggest: false,
    what: `${name} was set to run on ${shown}, which Wheelhouse has parked: Claude Code is the only coding agent for now.`,
    why: `Wheelhouse has stopped using ${shown}, so ${name} runs on Claude Code whichever you pick here. Nothing in the project's files changes.`,
    meanwhile: 'Meanwhile the project carries on with Claude Code, and this is not asked again.',
    recommend: PARKED_AGENT_CARD.carryOn,
    because: `${shown} is parked`,
    options: [
      { label: PARKED_AGENT_CARD.carryOn, says: `${name} carries on with Claude Code.` },
      { label: PARKED_AGENT_CARD.leave, says: 'Nothing changes; the project still carries on with Claude Code.' },
    ],
  });
}

// Raises the card once for the project, where its configuration names a parked agent and none was asked about it before.
// `parked` gives the agent's name or null for the project's folder. Resolves { done, lines }: done is false only when the
// state would not take the card, which is tried again at the next update.
export async function raiseParked({ project, folder, client, parked, progress, save = () => {}, now = () => new Date() }) {
  let agent = null;
  try { agent = parked(folder); } catch { agent = null; }
  if (typeof agent !== 'string' || agent === '') return { done: true, lines: [] };
  if (parkedAsked(project)[agent] !== undefined) return { done: true, lines: [] };
  const composed = parkedCard({ agent, name: path.basename(folder) });
  const made = await client.state.write({ project, kind: 'card', data: composed.card });
  if (made?.ok !== true) return { done: false, lines: [`The card about ${nameOf(agent)} being parked was not raised (${made?.refused ?? 'no reason given'}); run the update again.`] };
  markAsked(project, agent, now().toISOString());
  progress.parked = agent;
  save();
  return { done: true, lines: [] };
}
