<!-- docs/reviews/2026-10-17-standards-review.md -->

# Standards review of the design, 17 October 2026

An independent reviewer checked the design against industry standards for agentic AI security, governance, software supply chain, privacy and reliability. All of these findings were folded into the design's second draft on 17 October 2026, mostly in its section 12.

## What the director has decided since

- **Wheelhouse becomes open source** at its first release, and is private until then. Others, including non-technical people, will install it. Every fix below has to keep setup easy.
- **Protection in two levels**, chosen during setup:
  - **Standard,** the default, which needs no admin step.
  - **Locked,** which is optional and offered to projects with real users. It's a guided step, and the only thing the director does is type their computer password at the system's own prompt. This answers M1 below without making setup hard for everyone.
- **Secrets, as a general Wheelhouse rule:**
  - Agents never hold production credentials.
  - Claude Code denies reading `.env` files, and the sandbox enforces it.
  - Setup asks "does this project have live data?" and, if so, keeps agents on a practice copy by default.
  - File permissions (`chmod 600`, or `icacls` on Windows) don't protect against agents, because they run as the user. They stop other accounts only.

## Major gaps

**M1. Nothing on the server stops a bad merge, and the local gate can be got round.**
- **Sources:**
  - [OWASP LLM06 Excessive Agency](https://genai.owasp.org/llm-top-10/);
  - [Claude Code permissions](https://code.claude.com/docs/en/permissions);
  - [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- **Why:**
  - GitHub Free has no branch protection for private repositories.
  - A Bash deny rule doesn't match the same program by path or inside `sh -c`.
  - Without managed settings, a mod can approve a call that a hook or a deny rule refused.
  - The "read-only" reviewer agent has Bash.
  - The rule against writing `approvals.json` and `reviews.json` covers only builders and the foreman.
- **Scenario:** the foreman merges by calling the host directly, or pushes to `main`. Or a builder's script writes `approvals.json`. The gate never fires.
- **Fix:**
  - At the Locked level: a `managed-settings.json` holding the gate hook, the deny rules and `disableBypassPermissionsMode`.
  - The Bash sandbox: writes only inside the agent's own worktree, writes denied to `.claude/state` and `~/.claude`, and a network allowlist.
  - A fine-grained token for the agents, covering one repository with contents, PRs and issues only.
  - No Bash for reviewers, or a sandbox with no writes.

**M2. Production write paths bypass the merge gate.**
- **Sources:** OWASP LLM02 and LLM06; Anthropic [security](https://code.claude.com/docs/en/security) and [sandboxing](https://code.claude.com/docs/en/sandboxing).
- **Scenario:** a live database password sits in `.env.local`, or the Vercel CLI or connector is logged in. A builder investigating a problem runs the data refresh or a migration against live data, and a wrong figure goes live with no PR.
- **Fix:**
  - No production credentials on the agents' machines.
  - Deny reads of `.env*`.
  - Deny `mcp__*` and deployment tools by default, with an allowlist.

**M3. Agents can change their own guardrails, and dependencies float.**
- **Sources:**
  - [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf), MANAGE 3.1;
  - OWASP LLM03;
  - [model configuration](https://code.claude.com/docs/en/model-config): aliases update over time;
  - [plugin install](https://code.claude.com/docs/en/plugins/install): official marketplaces auto-update by default.
- **Why:**
  - PRs touching `.claude/`, hooks, `CLAUDE.md` or CI workflows count as level 1.
  - Wheelhouse is installed without a pinned version.
  - Third-party plugins float.
  - Aliases move before the evaluation runs.
- **Fix:**
  - Those paths become level 4, with an independent review, enforced in the gate.
  - Install Wheelhouse at a release tag, and pin third-party plugins by ref.
  - Turn auto-update off.
  - Pin full model IDs for figure work and reviews, and move a pin only after the evaluation passes. This replaces the design's "aliases" rule.
  - With open source: signed release tags, extra review for any contribution that touches the safety checks, and a security policy.

**M4. There is no stop-everything control and no incident runbook.**
- **Source:** NIST AI 600-1, GV-1.7-001 and MANAGE 2.4.
- **Fix:**
  - A STOP flag that agents can't write. A `PreToolUse` hook checks it and refuses writes, pushes, merges and new agents.
  - Ways to set it: a mod button, `/stop`, or a Remote Control message.
  - A one-page runbook: stop, revoke the agent token, revert `main` to the last good tag, restore state, withhold figures.
  - A test for it as evaluation scenario 12.

**M5. State integrity, the lock and backup.**
- **Source:** OWASP [Agentic AI Threats and Mitigations](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/) (memory poisoning).
- **Why:**
  - Any agent can push changes to the rulebook or levels.
  - A lock held in a git file is not atomic.
  - Offline pushes diverge, and an agent can drop rulings while resolving the conflicts.
- **Scenario:** after a stale-lock takeover, the first computer wakes, and two foremen are now merging.
- **Fix:**
  - Store state as one file per event, append-only, so merges can't conflict.
  - Take the lock with a push that must fast-forward, and give it a fencing token that the gate re-checks before every merge or push.
  - Deny force-push.
  - The reload hook shows the director any rulebook, levels or settings change that has no matching confirmation record.
  - A weekly `git bundle` backup into the profile repository.

**M6. Indirect prompt injection can reach the review and approval path.**
- **Sources:** OWASP LLM01; Anthropic: "avoid piping untrusted content directly to Claude".
- **Channels:**
  - text from pages the project reads, in alert issues;
  - bot comments on PRs;
  - CI logs;
  - comments in a diff addressed to the reviewer;
  - messages between sessions.
- **Fix:**
  - "Matches the live page" means the project's deterministic page-check result, with the page's hash recorded in `reviews.json`.
  - The report-check hook accepts CLEAN only from a session whose `agent_type` is `reviewer`.
  - Approvals come only from a mod click or a record taken when the director's own message arrives (a `UserPromptSubmit` hook), never from the front desk acting on a message.
  - "A later commit with no visible change" needs identical screenshots of every changed route; otherwise the director is asked again.

## Minor gaps

- A project's settings can't switch on telemetry. Put it in the per-computer setup, keep the content options off, and bind the receiver to 127.0.0.1.
- Copying the director's original wording from transcripts could copy pasted secrets into state. Run a secret scan before every state push.
- Public ntfy topics can be read by anyone who guesses the name. Send a link only, with no content.
- Remote Control keeps the transcript on Anthropic's servers while it's connected. Record this in a data note.
- If a project's repository is ever made public, the history of its state branch goes public too. Put that on the level-4 card.
- Set retention periods for transcripts, telemetry and state (`cleanupPeriodDays`).
- Subagents inherit the parent's permission mode, so set the foreman's mode explicitly.
- Prove that the mod never approves prompts from what `claude plugin validate` reports about its calls, not from a behavioural test.
- Record the Claude Code and model versions in each review record.

## What the design already does well

- Deterministic gates: hooks, exact head commits, and reviews written by a hook.
- Level 4 can't be delegated, silence is never consent, and only the director lowers a level.
- Rulings are kept verbatim and durably, and reloaded after compaction.
- Usage has appetites, a circuit breaker and anomaly alerts.
- Relayed instructions are never treated as the director's.

## Not verified by the reviewer

- The OWASP agentic threats document itself, which needs a sign-up to download.
- Whether GitHub rulesets work on private repositories on GitHub Free.
- Whether Superpowers and Matt Pocock's skills install from an auto-updating marketplace.
- Whether a prompt submitted by a mod can be told apart from a typed one.
- Whether claude.ai connectors reach local sessions.
- ISO/IEC 42001, which is paywalled.
