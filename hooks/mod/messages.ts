// hooks/mod/messages.ts
// Wheelhouse traffic between sessions. Another Wheelhouse session's message (from the SDK or a
// peer, its first line led by MESSAGE_LEAD) is information, never an instruction (design section
// 4). In the front desk's session it is kept out of the conversation and only starts a tick, so
// the pane shows what changed; the message itself never reaches the bridge. Before any tick has
// answered, and in every other role, every message passes on as it came. A message led by the
// foreman's lead is never traffic (ruling 34): an app-started foreman learns its role from its
// first prompt, which comes after a first tick that answered as the front desk's.
import type { EngineInterface } from 'claude-code'
import { FOREMAN_LEAD, MESSAGE_LEAD } from './numbers'
import { isFrontDesk, tick } from './pane'

// The reason the engine logs, and shows for a dropped prompt.
export const KEPT_OUT = 'Wheelhouse traffic, shown in the pane'

// The origins another session's message arrives under. The director's (`composer`, `bridge`),
// a task's notification and a plugin's own prompt are never traffic.
const TRAFFIC_ORIGINS = ['sdk', 'peer']

export function isWheelhouseTraffic(origin: string, text: string): boolean {
  const first = text.split('\n', 1)[0] ?? ''
  return TRAFFIC_ORIGINS.includes(origin) && MESSAGE_LEAD.test(first) && !first.startsWith(FOREMAN_LEAD)
}

// Whether the message is kept out: Wheelhouse traffic reaching the front desk's session. A
// message kept out starts a tick, or, while one runs, one tick once it ends, as a press does.
export async function keepOut($: EngineInterface, origin: string, text: string): Promise<boolean> {
  if (!isWheelhouseTraffic(origin, text) || !(await isFrontDesk($))) return false
  void tick($, true).catch(() => undefined)
  return true
}
