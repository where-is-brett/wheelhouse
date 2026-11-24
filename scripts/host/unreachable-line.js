// scripts/host/unreachable-line.js
// The line for a GitLab that can't be reached, and whether an address is the public service's. Read by the board's words without
// reading company-ca.js, which brings the tools that reach a server.
import { DEFAULT_GITLAB } from './gitlab-base.js';

// Whether the address is the public service's: its lines carry no "company" wording.
export const isPublic = (base) => String(base ?? '').replace(/\/+$/, '') === DEFAULT_GITLAB;
export const HOST_UNREACHABLE = (base) => (isPublic(base)
  ? `GitLab (${new URL(DEFAULT_GITLAB).host}) can't be reached from here. Work carries on here and is sent when it can be.`
  : `Your company's GitLab, ${base}, can't be reached from here, perhaps off the company network. Work carries on here and is sent when it can be.`);
