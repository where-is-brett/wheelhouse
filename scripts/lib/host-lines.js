// scripts/lib/host-lines.js
// Lines about the host connection that the board and setup both say, kept in a module of their own
// so that setup's steps don't load the board (and through it the session start) to say them.
export const QUICK_LINE = 'Agents act with your full GitHub or GitLab access, across all your projects.';
// The calm line when the host's tool stopped starting on this computer and the helper moved to the host's web API.
export const switchedLine = (host) => `${host === 'github' ? 'GitHub' : 'GitLab'}'s tool stopped working on this computer, so Wheelhouse is using ${host === 'github' ? 'GitHub' : 'GitLab'}'s web API instead.`;
// A line for a project with no host: a proposed change is a change, and what stays on a host stays on this computer.
export const localWords = (text) => String(text).replace(/\bpull requests\b/g, 'changes').replace(/\bpull request\b/g, 'change').replace(/\bPull requests\b/g, 'Changes')
  .replace(/\bPull request\b/g, 'Change').replace(/\bon the host\b/g, 'on this computer');
