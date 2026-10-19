// scripts/lib/platform-lines.js
// Lines of text that depend on the system the director's computer runs.
export const WINDOWS_LINE = 'This computer has no sandbox: agents are held by the deny rules, the gate and the helper.';
// The level build commands run at on Windows (design section 12.2), shown while it is on.
export const UNATTENDED_LINE = 'Build commands run unattended on this Windows computer, with no sandbox.';
export const GUARDED_LINE = 'Build commands run at low integrity on this Windows computer: they can\'t change files outside the project, but can still use the network.';
export const LOCKED_UNATTENDED_LINE = 'Unattended build commands are off in a Locked project';
