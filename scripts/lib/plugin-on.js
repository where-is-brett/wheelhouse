// scripts/lib/plugin-on.js
// Whether a folder's own Claude settings switch the Wheelhouse plugin on. The hooks
// (scripts/hooks/kit.js, beingSetUp) and the setup engine's folder check
// (scripts/setup/engine.js, admitFolder) both read it, so it lives apart from either: the engine
// reaches no hook code, and the hooks reach none of setup's writers.
import path from 'node:path';
import { readSmallText } from './small-file.js';

const WHEELHOUSE_PLUGIN = /^wheelhouse@[^@\s]+$/;

// Whether the folder's own Claude settings switch the Wheelhouse plugin on (installed for this
// project, or for the director in it): `.claude/settings.local.json`, which wins where it names the
// plugin, then `.claude/settings.json`. Small files only, read without waiting. A folder above it
// is not looked at.
export function pluginOnIn(dir) {
  const named = (name) => {
    try {
      const enabled = JSON.parse(readSmallText(path.join(dir, '.claude', name)) ?? 'null')?.enabledPlugins;
      if (!enabled || typeof enabled !== 'object') return undefined;
      const values = Object.entries(enabled).filter(([k]) => WHEELHOUSE_PLUGIN.test(k)).map(([, v]) => v);
      return values.length === 0 ? undefined : values.includes(true);
    } catch {
      return undefined;
    }
  };
  return (named('settings.local.json') ?? named('settings.json')) === true;
}
