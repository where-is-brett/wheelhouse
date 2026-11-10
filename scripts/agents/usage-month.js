// scripts/agents/usage-month.js
// An agent's month, for the agents whose allowance is a month's (Copilot's): the board and the briefing ask here by the
// agent's name, so core code never names an agent. An agent with no entry has no month (Claude Code's allowance is the
// week's, read by scripts/usage/figures.js).
import { readLedger, readAccount, monthState } from './copilot/usage.js';

const MONTHS = Object.freeze({
  // settings: the effective settings view ({ <key>: { value } }), or null.
  copilot: ({ settings, now, dir }) => monthState({
    lines: dir === undefined ? readLedger() : readLedger({ dir }),
    account: dir === undefined ? readAccount() : readAccount({ dir }),
    allowance: settings?.copilotAllowance?.value,
    mark: settings?.usageMark?.value,
    now,
  }),
});

// The month for `agent`, or null when it has none or it can't be read.
export function monthFor(agent, { settings = null, now, dir } = {}) {
  if (typeof agent !== 'string' || !Object.hasOwn(MONTHS, agent)) return null;
  try { return MONTHS[agent]({ settings, now: now ?? new Date(), dir }); } catch { return null; }
}
