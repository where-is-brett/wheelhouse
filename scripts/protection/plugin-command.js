// scripts/protection/plugin-command.js
// The command that runs one of the plugin's scripts, in a module of its own so a hook that only names the front desk's command
// doesn't load the settings it is written into (scripts/protection/settings.js).

// The one flag a plugin script's command may carry between `node` and the script. Claude Code sets
// NODE_USE_SYSTEM_CA=1 for a session's commands, and in the sandbox Node.js then prints a line for each
// system certificate whose trust settings it can't read; this flag turns the system store off for that process.
export const NO_SYSTEM_CA = '--no-use-system-ca';

// Whether the Node.js running this knows NO_SYSTEM_CA (Node.js 22.15 and later); `flags` is what it allows.
export function knowsNoSystemCa(flags = process.allowedNodeEnvironmentFlags) {
  return flags.has('--use-system-ca');
}

// The command that runs one of the plugin's scripts (`script`, its path inside the plugin, such as
// scripts/frontdesk/cli.js), as its allow rule and its playbook write it: `node`, then the
// script's full path in double quotes. On Windows the path has forward slashes after its drive
// letter, which node and Git Bash both take, and which the STOP guard reads as the same path. Null
// when the plugin's folder isn't a full path, or holds a character that could end the quotes or
// change what the rule matches (a quote, `*`, a parenthesis, `$`, a backtick, a backslash or a
// control character): that folder gets no rule, and the command is asked about each time.
// With `noSystemCa`, `node` is followed by NO_SYSTEM_CA.
export function pluginScriptCommand(pluginRoot, script, { platform = process.platform, noSystemCa = false } = {}) {
  if (typeof pluginRoot !== 'string') return null;
  if (typeof script !== 'string' || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(script) || script.split('/').includes('..')) {
    throw new Error('The script must be a path inside the plugin, written with forward slashes');
  }
  let root = pluginRoot;
  if (platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(root)) return null;
    root = root.replaceAll('\\', '/');
  } else if (!root.startsWith('/')) {
    return null;
  }
  if (/["*()$`\\\p{Cc}]/u.test(root)) return null;
  return `node ${noSystemCa ? `${NO_SYSTEM_CA} ` : ''}"${root.replace(/\/+$/, '')}/${script}"`;
}

// The front desk's command (scripts/frontdesk/cli.js), as pluginScriptCommand gives it.
export function frontDeskCommand(pluginRoot, { platform = process.platform, noSystemCa = false } = {}) {
  return pluginScriptCommand(pluginRoot, 'scripts/frontdesk/cli.js', { platform, noSystemCa });
}
