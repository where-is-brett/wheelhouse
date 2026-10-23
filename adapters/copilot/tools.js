// adapters/copilot/tools.js
// The names Copilot gives its tools, in the shape the adapter contract asks of the `tools` part: the union of
// the tool names seen in checks 58, 63 and 66 (camelCase registration, check 56), not check 58's table alone.
// It imports nothing, so the hook kit and the guards can read it without a cycle.
//
// `read`, `halt` and `notify` mean what they mean for Claude Code (adapters/claude-code/tools.js): the tools
// the STOP guard and the lineage hold let through, because they only read, only stop work that is already
// running, or only tell the director. Nothing that changes a file, starts work or loads instructions is in
// them. `edit` and `other` are Copilot's own additions: what changes files, and the tools seen that none of
// the three lists fits. A tool in neither is an unknown tool, which the guards refuse (design section 6.2).
const freeze = (list) => Object.freeze([...list]);

export default Object.freeze({
  // Tools that only read: view, glob and rg (check 58), web_fetch, the question tool as Claude Code's is, the
  // `read_agent`, which collects a sub-agent's answer (check 63), and the listing and reading tools check 66 saw
  // switched off. `sql` is not here: it takes any SQL statement and check 63 saw it write the `todos` table, so it
  // is in `other` until a probe shows what it can reach.
  read: freeze(['view', 'glob', 'rg', 'web_fetch', 'ask_user', 'read_agent', 'list_agents', 'list_bash', 'read_bash', 'semantic_code_search', 'fetch_copilot_cli_documentation']),
  // The tool that stops a running shell (Claude Code's KillShell), seen in check 66.
  halt: freeze(['stop_bash']),
  // Check 58 saw no notification tool.
  notify: freeze([]),
  // Never offered headless (check 58), so unproven until the first sitting.
  ask: 'ask_user',
  // `powershell` was not seen (check 58: no `pwsh` on the Mac), so it is unproven until the Windows sitting.
  shell: freeze(['bash', 'powershell']),
  // File changes arrive as `apply_patch`, whose input is a patch string (check 58); `edit` and `create` were
  // not seen with that model and are entered under the names the research gives.
  edit: freeze(['apply_patch', 'edit', 'create']),
  // Dispatching a sub-agent (`task`), loading a skill (`skill`), the free-form `sql` tool, the wrapper that runs tools in parallel
  // (check 66; whether the hook sees each call inside it is still open), and the rest of what check 66 saw.
  other: freeze(['task', 'skill', 'sql', 'multi_tool_use.parallel', 'write_agent', 'session_store_sql', 'dynamic_workflows_manage', 'run_dynamic_workflow', 'lsp', 'store_memory', 'vote_memory']),
});
