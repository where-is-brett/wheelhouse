<!-- docs/checks/18-connectors.md -->

# Check 18: connectors and the deny rule

**Answer:** Yes — connectors reach local sessions, and denying `mcp__*` removes every one of them from the session.

## Question

Whether claude.ai connectors reach local sessions, so the `mcp__*` deny rule covers them.

## Tested on

This session in Claude Desktop on macOS, headless sessions from the command line (Claude Code 2.1.278), and https://code.claude.com/docs/en/permissions, 17 October 2026.

## Method

Looked at the tools this local session lists, and read the permission rule syntax. Then `probes/18-connectors.js` asked a headless session in a scratch project to list its `mcp__` tools and call a read-only one: once with `mcp__*` denied, once with an unrelated rule.

## Evidence

- This local Desktop session lists claude.ai connectors as tools, named `mcp__<id>__<tool>`, where the documentation's form is `mcp__claude_ai_<server>__<tool>`. Either way, they begin `mcp__`.
- "`"mcp__*"` matches every MCP tool across all servers". It works in deny and ask rules, and is skipped with a warning in allow rules.
- `mcp__<server>` matches every tool of one server.
- **Without the rule,** the headless session listed connectors such as `mcp__claude_ai_Claude_Docs__guide` and `mcp__claude_ai_gitlab__list_projects`. Its call to a read-only one stopped at the permission prompt, which a headless session can't answer.
- **With `mcp__*` denied,** the session had no `mcp__` tools at all: "there are no `mcp__`-prefixed tools reachable in this session".

## What it means for the design

- Section 12.2 stands: `mcp__*` in deny covers connectors.
- Section 12.2: a wildcard is ignored in an allow rule, so the allowlist can't be "deny all, allow one" with `mcp__*`. It has to deny each unwanted server by name, or deny `mcp__*` and ask for the allowed ones. The safety plan settles which, after the trial.

## Needs the director

No.
