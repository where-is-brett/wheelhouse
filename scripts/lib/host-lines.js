// scripts/lib/host-lines.js
// Lines about the host connection that the board and setup both say, kept in a module of their own
// so that setup's steps don't load the board (and through it the session start) to say them.
export const QUICK_LINE = 'Agents act with your full GitHub or GitLab access, across all your projects.';
// The calm line when the host's tool stopped starting on this computer and the helper moved to the host's web API.
export const switchedLine = (host) => `${host === 'github' ? 'GitHub' : 'GitLab'}'s tool stopped working on this computer, so Wheelhouse is using ${host === 'github' ? 'GitHub' : 'GitLab'}'s web API instead.`;
// The lines for a host key GitLab or GitHub refused (401) and for one that is not there. Both send the director to
// setup's step 3, which raises the key card (the host's token page, prefilled, and the computer's own hidden box).
const hostName = (host) => (host === 'github' ? 'GitHub' : 'GitLab');
export const keyRefusedLine = (host) => `${hostName(host)} no longer accepts your key. Ask for step 3 of setup ("check my ${hostName(host)} connection") and a page will open to make a new one.`;
export const keyMissingLine = (host) => `There is no ${hostName(host)} key on this computer. Ask for step 3 of setup ("check my ${hostName(host)} connection") and a page will open to make one.`;
// A line for a project with no host: a proposed change is a change, and what stays on a host stays on this computer.
export const localWords = (text) => String(text).replace(/\bpull requests\b/g, 'changes').replace(/\bpull request\b/g, 'change').replace(/\bPull requests\b/g, 'Changes')
  .replace(/\bPull request\b/g, 'Change').replace(/\bon the host\b/g, 'on this computer');
