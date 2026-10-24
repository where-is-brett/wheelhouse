<!-- docs/research/adoption-2026-10.md -->

# How agent plugins win users, and where Wheelhouse stands: October 2026

Research for the question the director asked on 24 October 2026: how could Wheelhouse become as widely used as Superpowers, usable by anyone, including people who aren't technical, while still offering what an enterprise needs?

Every fact below comes from a primary source: the projects' own repositories (read through GitHub's API), their release notes, the official Claude Code and GitHub docs, and the authors' own posts. All were accessed on 25 October 2026. Star and contributor counts are GitHub's figures on that day. "Not verified" marks what the sources didn't settle. "Reading" marks this report's own interpretation, as distinct from a sourced fact. The ranked plan built on this report is `docs/plans/adoption-plan.md`.

## 1. The projects compared

| Project | What it is | Stars | Forks | Contributors | Created |
|---|---|---|---|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | A development method for coding agents, packaged as skills plus a start-of-session instruction | 304,518 | 27,124 | 37 | 9 October 2025 |
| [anthropics/skills](https://github.com/anthropics/skills) | Anthropic's example and document skills, carried by the official marketplace | 183,445 | 21,723 | about 15 | 22 September 2025 |
| [github/spec-kit](https://github.com/github/spec-kit) | A spec-first toolkit with a command-line installer, for Copilot, Claude Code and others | 142,688 | 12,776 | 317 | 21 August 2025 |
| [github/awesome-copilot](https://github.com/github/awesome-copilot) | A community catalogue of Copilot agents, skills, instructions and plugins | 40,369 | 5,207 | 432 | 11 June 2025 |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | Claude Code's official plugin marketplace (the channel, not a product) | 44,291 | 4,650 | 42 | 20 November 2025 |
| [where-is-brett/wheelhouse](https://github.com/where-is-brett/wheelhouse) | This project | 0 | 0 | – | – |

Superpowers' own numbers: more than 120,000 stars by 31 March 2026 ([author's post](https://blog.fsck.com/2026/03/31/slop-prs/)), and about 300,000 a year after launch, the most-installed third-party Claude Code plugin with more than 1.1 million installs ([author's post, 9 October 2026](https://blog.fsck.com/2026/10/09/what-a-year/)). Its launch day was the day Anthropic's plugin support rolled out (same post). The 37 contributors against 304,000 stars show it is one author's project with a very large audience.

## 2. Findings, by theme

### 2.1 Install friction

- **Superpowers: one command.** `/plugin install superpowers@claude-plugins-official`, from the official marketplace, or two commands through its own marketplace ([README](https://github.com/obra/superpowers#claude-code)). At launch it was two commands and a restart ([launch post](https://blog.fsck.com/2025/10/09/superpowers/)). It has no third-party dependencies, by design ([AGENTS.md](https://github.com/obra/superpowers/blob/main/AGENTS.md)).
- **The official marketplace needs no "add" step.** Claude Code registers it the first time an interactive session starts ([install docs](https://code.claude.com/docs/en/plugins/install.md)).
- **anthropics/skills: two commands**, then mention the skill in a prompt ([README](https://github.com/anthropics/skills#try-in-claude-code-claudeai-and-the-api)). On claude.ai the example skills are already there for paid plans ([launch post](https://claude.com/blog/skills)).
- **awesome-copilot: one command or one click.** Copilot CLI and VS Code ship with its marketplace registered, so it's `copilot plugin install <name>@awesome-copilot`. Single agent files have VS Code install buttons ([README](https://github.com/github/awesome-copilot#install-a-plugin), [GitHub docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing)).
- **Spec Kit is the heaviest:** Python 3.11+, `uv`, a command-line tool, then six slash commands ([README](https://github.com/github/spec-kit#get-started)). Its most-discussed issues are about install, upgrade and model errors ([#167](https://github.com/github/spec-kit/issues/167), [#1414](https://github.com/github/spec-kit/issues/1414), 79 comments).

*Reading:* the projects with the most users ask for one or two commands and no prerequisites beyond the agent itself. Every extra prerequisite shows up later as issue traffic.

### 2.2 Time to first value

- **Superpowers needs no setup at all.** A session-start hook injects its bootstrap skill into every session ([hooks/session-start](https://github.com/obra/superpowers/blob/main/hooks/session-start)), so the user's first "let's build X" already runs its brainstorming skill. The README gives exactly that as its smoke test ([README, Muse section](https://github.com/obra/superpowers#muse)).
- **Anthropic's skills:** install, then "use the PDF skill" on a file ([README](https://github.com/anthropics/skills)). Skills load themselves when relevant ([launch post](https://claude.com/blog/skills)).
- **Spec Kit's first output is a document.** Its most-voiced criticism is that it "creates the illusion of work" ([#75](https://github.com/github/spec-kit/issues/75)), and its most-reacted issue is that existing specs are hard to refine ([#1191](https://github.com/github/spec-kit/issues/1191), 115 reactions).
- None of the four publishes a measured time to first value. Not verified anywhere.

*Reading:* value arrives on the user's first ordinary request, inside work they were going to do anyway. Nothing has to be learnt first.

### 2.3 The README's story

- **Superpowers sells a method and an outcome, not a feature list.** It opens by calling itself a complete development method for coding agents. A short "How it works" story follows: the agent asks what you want, shows the design in small pieces, writes a plan and works on its own for hours. Then come seven numbered steps, described as mandatory workflows rather than suggestions ([README](https://github.com/obra/superpowers#readme)). Its telemetry, a logo fetch, is disclosed in the README with three ways to switch it off.
- **Anthropic's skills README is plain and educational.** It says the repository is for demonstration, and the launch post leans on named customers instead ([README](https://github.com/anthropics/skills), [launch post](https://claude.com/blog/skills)).
- **Spec Kit's tag line offers three entry points**: build with a spec, fix a bug, or assess an idea ([README](https://github.com/github/spec-kit)).

### 2.4 Demos

- **None of the four launched with a video.** Superpowers' launch post linked one long transcript of an agent building a small to-do app ([launch post](https://blog.fsck.com/2025/10/09/superpowers/); the transcript itself not opened). Its README has no video or GIF.
- Spec Kit added two episodes of GitHub's Open Source Friday to its README later, in May and October 2026, and a worked example, "Taskify", in its quickstart ([README](https://github.com/github/spec-kit#in-the-news), [quickstart](https://github.com/github/spec-kit/blob/main/docs/quickstart.md)). Its workflow-diagram thread drew 70 reactions ([#467](https://github.com/github/spec-kit/issues/467)).

*Reading:* a demo didn't drive these launches; the channel and the one-line install did. A demo matters more for Wheelhouse than for them, though. Its audience can't judge a method from its skill files, and its value appears minutes after install, not on the first prompt.

### 2.5 How skills are packaged and composed

- **Superpowers:** 15 skills, one hook and one bootstrap skill. The bootstrap tells the agent to use a skill if there is even a 1% chance one applies, lists the excuses it mustn't make, and puts the user's own instructions above the skills ([using-superpowers](https://github.com/obra/superpowers/blob/main/skills/using-superpowers/SKILL.md)). Skills name each other as a chain: brainstorming, then worktrees, plan, execution, tests, review, finish ([README](https://github.com/obra/superpowers#readme)). One repository carries manifests for about 16 agent tools, among them Codex, Cursor, Gemini, Copilot CLI and OpenCode ([repository root](https://github.com/obra/superpowers/tree/main)). Long skills are split because Claude Code truncates skills re-attached after compaction at 20,000 characters, and a test enforces it ([release notes, v7.0.1](https://github.com/obra/superpowers/blob/main/RELEASE-NOTES.md)).
- **Anthropic:** one folder per skill, bundled into plugins through a marketplace file ([marketplace.json](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json)). It also ships the open skill standard that GitHub's Copilot docs now point to ([GitHub docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)).
- **awesome-copilot:** six kinds of resource, with plugins built as roll-ups that link to files authored once ([#751](https://github.com/github/awesome-copilot/issues/751)).
- **Spec Kit:** layers of integrations, extensions, presets, workflows, bundles and catalogs, including private catalogs and air-gapped use ([README](https://github.com/github/spec-kit#capabilities)).
- **More agent tools is the top demand everywhere.** Superpowers' most-reacted issue is Agent Teams support ([#429](https://github.com/obra/superpowers/issues/429), 115 reactions), and its other feature requests are mostly new harnesses. Spec Kit's are Cursor, Codex and Antigravity ([#9](https://github.com/github/spec-kit/issues/9), [#30](https://github.com/github/spec-kit/issues/30), [#1213](https://github.com/github/spec-kit/issues/1213)).

### 2.6 Community and contributions

- **Superpowers is strict.** Pull requests go to `dev`; new skills are generally refused, since domain skills belong in plugins of their own; a human-written summary is required; agent-written pull requests for other people's issues are refused. Its AGENTS.md reports a 94% rejection rate ([AGENTS.md](https://github.com/obra/superpowers/blob/main/AGENTS.md)). The author has written about the flood of agent-written pull requests ([post](https://blog.fsck.com/2026/03/31/slop-prs/)). Community happens on Discord and in issues ([README](https://github.com/obra/superpowers#readme)).
- **anthropics/skills shows open intake without review capacity:** 1,020 open pull requests against 59 merged (GitHub search, 25 October 2026).
- **The official marketplace closes outside pull requests automatically** and takes submissions through a form. Each one gets an automated policy scan, licence and URL checks, and nightly pin bumps ([workflows](https://github.com/anthropics/claude-plugins-official/tree/main/.github/workflows), [README](https://github.com/anthropics/claude-plugins-official#external-plugins)).
- **awesome-copilot shows intake at scale:** 432 contributors and 1,519 merged pull requests. A required `submission-gate` check sorts each change into low, medium or high merge risk, and any change to review policy is high risk ([CONTRIBUTING](https://github.com/github/awesome-copilot/blob/main/CONTRIBUTING.md), [risk-tiers.yml](https://github.com/github/awesome-copilot/blob/main/.github/risk-tiers.yml)).
- **Spec Kit** has a code of conduct, issue and pull request templates, and a rule that large changes are agreed before work starts ([CONTRIBUTING](https://github.com/github/spec-kit/blob/main/CONTRIBUTING.md)).

### 2.7 Versioning and trust

- **Superpowers:** semantic versions, 16 or more releases, roughly monthly (v7.0.1 on 21 October 2026). It keeps a 1,555-line release-notes file that credits reporters by handle ([releases](https://github.com/obra/superpowers/releases), [RELEASE-NOTES.md](https://github.com/obra/superpowers/blob/main/RELEASE-NOTES.md)). Its security fixes appear in the notes, for example an unauthenticated local server and a Windows hook path that could be planted (same file). Whether it has a SECURITY.md: not verified.
- **Spec Kit:** 235 releases, a changelog, and a recommendation to install from a release tag, with PyPI and air-gapped routes ([installation docs](https://github.com/github/spec-kit/blob/main/docs/installation.md)).
- **anthropics/skills and awesome-copilot have no releases at all** (`gh release list`, 25 October 2026).
- **Trust is pinning, not signing.** No signing was found in any of the four. The official marketplace pins outside plugins by commit and bumps the pins nightly ([bump-plugin-shas.yml](https://github.com/anthropics/claude-plugins-official/blob/main/.github/workflows/bump-plugin-shas.yml)). Claude Code refuses a commit other than the pinned one ([security docs](https://code.claude.com/docs/en/plugins/security.md)). Anthropic says plainly that it doesn't verify what a plugin contains (same page).
- **The live trust complaints are impersonation and drift:** community skills posing under `anthropic/` ([#492](https://github.com/anthropics/skills/issues/492), 46 comments), and a stale pin of Matt Pocock's skills in the official marketplace ([#6360](https://github.com/anthropics/claude-plugins-official/issues/6360), 36 reactions).

### 2.8 What users complain about

| Complaint | Where | Evidence |
|---|---|---|
| Token cost and slowness | Superpowers | [#743](https://github.com/obra/superpowers/issues/743) (27 comments, open, absorbs duplicates), [#953](https://github.com/obra/superpowers/issues/953), [#1152](https://github.com/obra/superpowers/issues/1152) |
| No way to switch automatic triggering off | Superpowers | [#645](https://github.com/obra/superpowers/issues/645); optional worktrees [#583](https://github.com/obra/superpowers/issues/583), [#721](https://github.com/obra/superpowers/issues/721) |
| Too much process for small jobs | Superpowers, Spec Kit | [#895](https://github.com/obra/superpowers/issues/895) (36 reactions), [#1120](https://github.com/obra/superpowers/issues/1120), [#2530](https://github.com/obra/superpowers/issues/2530); Spec Kit [#75](https://github.com/github/spec-kit/issues/75) |
| Windows hooks | Superpowers | its issue template says the Windows start-of-session hook was reported 29 times |
| Breakage when the agent tool or model changes | Superpowers, Spec Kit | [#2177](https://github.com/obra/superpowers/issues/2177), [#1441](https://github.com/obra/superpowers/issues/1441); Spec Kit [#1414](https://github.com/github/spec-kit/issues/1414) |
| A new install showing old commands | Superpowers | [#756](https://github.com/obra/superpowers/issues/756) (36 reactions) |
| Install and upgrade | Spec Kit, official marketplace | [#167](https://github.com/github/spec-kit/issues/167); [#587](https://github.com/anthropics/claude-plugins-official/issues/587) |
| Duplicated or bloated context | anthropics/skills | [#189](https://github.com/anthropics/skills/issues/189), [#1486](https://github.com/anthropics/skills/issues/1486) |

### 2.9 What an enterprise can already control

**Claude Code** gives an administrator real controls over plugins, all from the [organisation docs](https://code.claude.com/docs/en/plugins/org.md) unless noted:

- **Delivery.** Settings arrive by server-managed settings, by MDM or by a `managed-settings.json` file.
- **Fleet install.** An administrator can require a plugin across the fleet with `extraKnownMarketplaces` plus `enabledPlugins`.
- **Allow- and block-lists.** `strictKnownMarketplaces` allows only listed sources, with owner wildcards; `blockedMarketplaces` blocks named ones.
- **Sideloading.** `disableSideloadFlags` turns it off.
- **Pinning.** A marketplace entry can be pinned by `ref` and `sha`, and an archive by `sha256` ([hosting docs](https://code.claude.com/docs/en/plugins/host-marketplace.md)).
- **Updates.** They are controlled per marketplace, and are off by default for anything not official ([install docs](https://code.claude.com/docs/en/plugins/install.md)).
- **Audit.** Plugin installs and loads emit OpenTelemetry events, and Enterprise has an analytics API ([security docs](https://code.claude.com/docs/en/plugins/security.md)).
- **Stated gaps.** Server-managed settings can't target groups, and an allowed marketplace can't be narrowed to some of its entries except by `enabledPlugins: false`.

**GitHub Copilot** offers less:

- **Where skills live.** Skills can sit in `.github/skills`, `.claude/skills` or `.agents/skills` ([docs](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)).
- **Sharing agents.** Custom agents can be shared at repository, organisation and enterprise level ([docs](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents)).
- **Enterprise-managed plugins.** They have been in public preview for Copilot CLI since 6 May 2026, for Copilot Business and Enterprise, configured in `.github-private` ([changelog](https://github.blog/changelog/2026-05-06-enterprise-managed-plugins-in-github-copilot-cli-are-now-in-public-preview/)).
- **No allow-list or pinning found.** The pages read document no marketplace allow-list and no version pinning, only "update to latest" ([docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing)). Not verified beyond those pages. Two GitHub pages also disagree on whether Copilot CLI ships with one default marketplace or two.

## 3. What wins, in short (reading)

1. **The channel beats the content.** The largest numbers belong to projects in the platform's default marketplace, or shipped by the platform owner. Superpowers launched on the day plugins did, and is now installed from the official marketplace with one command.
2. **One command, no prerequisites,** and value on the first ordinary request.
3. **A clear method with a name,** told as a story of what the agent does for you, not as a feature list.
4. **Steady, visible releases** with plain notes that credit reporters. Trust comes from pinning and a public record, not from signatures.
5. **Narrow contribution intake,** stated plainly. Open intake without reviewers turns into a backlog, and agent-written pull requests now arrive in floods.
6. **The complaints that grow with popularity:** token cost, too much process for small jobs, no off switch, Windows hooks, and breakage when the platform moves.

## 4. Wheelhouse's first ten minutes: an audit

Sources: `README.md`, `SECURITY.md`, design section 15 (setup) and section 16 (open source), and the timed rehearsal `docs/evals/rehearsal-project-under-way.md` (24 and 25 October 2026). The repository's state was checked with `gh` on 25 October 2026.

### 4.1 What a person meets, in order

| Minute | What happens | Where a non-technical person stalls, gets scared or gives up |
|---|---|---|
| Before 0 | Needs a Claude plan with Claude Code, Claude Desktop, a GitHub or GitLab account, and Node.js 22 or later | **Node.js is a developer's install**, done by hand from nodejs.org. Without it, every tool call is refused with a message naming a script and "node: command not found" (README step 2; design section 15, check 35). This is the scariest possible first impression. Superpowers has no prerequisite at all. |
| 0 | Reads the README | **Its first screen talks about the project, not the reader.** The opening line is right, but the next lines are "Status: built, and not yet released", a pointer to a 2,194-line design and a handover file, and the history of a pilot. Nothing shows what the reader will see or get. There is no picture, demo or example briefing. |
| 1 | Pastes the install line | **The line holds a placeholder,** `#<tag>`, that the reader must replace "from Wheelhouse's releases page". **That page is empty.** The `v0.1.0` tag exists, but no GitHub release was ever published (`gh api …/releases` returns 0). A reader following the instructions finds nothing. |
| 1 to 2 | Confirms the source; chooses where to install | The README warns them to choose **this project**, not "for you": a choice a newcomer doesn't understand, with the wrong answer the more natural one. If the line fails, a second route goes through the plugin browser. |
| 2 to 3 | Setup step 2: tools | The git installer may ask for the computer's password. It is explained on the card, but it is still a password prompt from a tool they installed a minute ago. |
| 3 to 4 | Step 3: real users, host, connection | **Three to five questions before anything useful,** among them Quick against **Make it stricter**, with a warning that the ordinary sign-in "opens your whole account". This is honest, and alarming without context. |
| 4 to 6 | Steps 4 to 6 | Questions about the product, then one card of changes to the computer: telemetry, 30-day transcripts, the update channel, phone notifications and a signing key. Accurate, but long. |
| 6 to 7 | Step 7: project files, pins, protection | **The card is one 600-character sentence** (rehearsal finding 7). **On a project already under way, setup stops here** if the folder isn't on the main line, and the only remedy is a terminal command. In the rehearsal, sessions improvised advice that would have broken Wheelhouse, such as stashing or changing the default branch (finding 1; the advice is now fixed, the stop isn't). |
| 7 to 9 | Step 9: phone notifications | A two-minute wait with a locked screen, before the first briefing. It is useful, but it isn't part of the first value. |
| About 9 | Step 10: health check, then the first briefing | **The first value**: a green board and a plain briefing. In the rehearsal this took 530 seconds with installs stood in. On a real computer, git and the kits add their own time (rehearsal, "Timings"). Twelve cards and three permission prompts came first. |

**Against the findings:**

- **Time to first value** is about nine minutes and twelve cards at best, against zero setup for Superpowers.
- **The install** is one line, but with a placeholder and a dead link, plus a hand install of Node.js.
- **The README** tells the project's history, not the reader's outcome.
- **Wheelhouse does things right that the others don't.** Every change is listed on a card before it happens. Setup can be stopped and resumed, and uninstall puts things back. Its security page has a section in plain words, its data note says where conversations go, and its dependencies are pinned by commit. These are its competitive edge and should be shown, not buried.

### 4.2 Where an enterprise reviewer would say no

| Concern | State on 25 October 2026 | Evidence |
|---|---|---|
| No published release | Tag `v0.1.0` only; no release, no notes, no changelog | `gh api repos/where-is-brett/wheelhouse/releases` returns 0 |
| No release signing | Designed (keyless signing in CI, once the repository is public) but not started; the repository is now public | design section 16, check 17 |
| No code owners on safety paths | Design section 16 calls for a code-owners file that marks the safety checks; `.github/` holds only `ci.yml` | repository tree |
| No contribution policy | No CONTRIBUTING, code of conduct, or issue and pull request templates; GitHub's community health score is 57% | `gh api …/community/profile` |
| One maintainer, version 0.1.0, no outside review yet | An outside-review plan exists but hasn't been run | `docs/reviews/2026-10-24-outside-review-plan.md` |
| Quick connection uses the person's whole account | The default on the Mac; narrow is behind **Make it stricter** | `SECURITY.md` |
| Windows has no sandbox | Stated plainly; guards and helper still hold | `SECURITY.md` |
| Locked is Mac-only and needs an administrator password | By design until tried on Windows with admin rights | design section 12.1; HANDOVER |
| Not in any default marketplace | Admins must allow-list `where-is-brett/wheelhouse` themselves; no admin guide says how | `.claude-plugin/marketplace.json`; no admin page |
| Copilot side untested | The tested-versions table has no rows; check 70 is held | `docs/copilot/tested-versions.md` |

**What a reviewer would like:**

- the plain-words threat model and its developer half, with honest "what doesn't" lists;
- pinned dependencies by tag and commit;
- signed approvals recorded on a state branch, an audit trail most agent plugins lack;
- server-side branch protection, switched on at setup;
- a computer-wide Locked mode;
- a data note;
- private vulnerability reporting with a stated reply time.

Few of the projects compared offer as much. None of it shows on the README's first screen.

### 4.3 Copilot reach

- **Install.** The Copilot install is a sentence pasted into chat that asks the agent to clone a tag and follow a skill, approving each command (README, "On GitHub Copilot"). Copilot now has plugins and a default marketplace, `awesome-copilot`, installed with one command (section 2.1). Wheelhouse already builds a Copilot plugin bundle (`adapters/copilot/plugin/`, with `plugin.json`, four agents and eight skills), but doesn't offer it as a plugin install.
- **Organisations.** Enterprise-managed plugins in Copilot CLI give organisations a route to install Wheelhouse for everyone (section 2.9).
- **Testing.** Nothing in VS Code has been tested yet.

## 5. Not verified

- **Star histories.** Superpowers' early star history beyond the two dates its author gives; any project's measured time to first value.
- **Unread sources.** The full text of the authors' posts (read as fetched summaries); the transcript Superpowers' launch post links; whether Superpowers has a SECURITY.md.
- **Copilot policy.** GitHub's organisation policy page for Copilot CLI (search summary only); whether GitHub documents a marketplace allow-list or version pinning on pages not read.
- **Real-computer timings.** Wheelhouse's own time on a real computer: the rehearsal stood in for installs and the host, and the director's timed run (check 19) is still to come.
