<!-- docs/specs/2026-11-07-director-way-of-working-design.md -->

# The director's way of working: design (7 November 2026)

**Status:** approved by the director on 7 November 2026, including section 7's data before-and-after on real data. Section 6.6's matching of earlier decisions was cut the same day: agents read the records instead. It builds on the core cut (`docs/specs/2026-11-07-core-cut-design.md`, approved 7 November 2026, on `feature/core-cut-design-5b4673`). Where the two disagree, the core cut stands, except where this design names a change the director decided (section 6.1).

## 1. In plain words

The director is a one-person team. They steer the product; agents do the engineering. Agents can now produce far more work than one person can review, so **the director's attention is the limit, not the agents' capacity.** Parallel sessions are only as fast as the director can judge what they produce.

This design is about that limit. The core cut decides what Wheelhouse is made of. This design decides how the director works with it:

- **Fewer things reach the director.** Work that touches nothing of theirs merges by itself once it clears a bar, and they see it afterwards.
- **What does reach them is cheap to judge.** A decision arrives as one short chat message, with the agent's recommendation explained. Finished work arrives as a proof note, not a diff.
- **Waiting on them never stops the work.** Agents keep building on their recommendation and stop only before a step that can't be undone.
- **They can see everything when they want to,** without being pushed everything.

## 2. Why

The director said, in their own words over the 7 November conversation:

- They want to "steer product decisions and automate as much engineering work as possible", with "most important engineering decisions" still going through them by default.
- "The parallel sessions are only as efficient as I could review them."
- On review: they check that the work does what they meant, not whether the code is elegant (confirmed: "your assumption is correct").
- "Algorithm design perhaps needs my approval too. Anything that ties back to the product should."
- "While waiting on my decision, I would prefer if work can continue where possible, like in real world."
- On silence counting as approval: "Never."
- "I would like to not sit in front of the screen all day", but "visibility is needed even though I may not look at everything all the time. I do also check in from time to time."
- Every decision "is clear and concise with agent's recommendation explained. If I wanted to know more, then agent should be able to explain. This process needs to be efficient."
- Product ideas: "I probably would come to the desk."
- On cards or the chat: the chat is "more universal, easier to read" (decided: chat first, section 6.1).

## 3. Goals, non-goals and anti-goals

**Goals**

| Goal | How this design meets it |
|---|---|
| The director steers the product; agents do the engineering | The decision line (section 5) gives every product and product-shaping call to the director and every how-to-build call to agents |
| The director is no longer the bottleneck | Internal-only work merges itself (section 8); decisions are made before code, not found in diffs (section 6); proof notes replace code review (section 7) |
| Each decision is clear, short and explained, with depth on request | One message shape with a recommendation and its reasons, checked before it is shown; "why" asks a copy of the session that raised it (section 6) |
| Work goes on while a decision waits | Agents build on their recommendation, reversibly, and stop only at a step that can't be undone (section 6.4) |
| The director needn't sit at the screen | Two short desk sessions a day, check-ins whenever, phone alerts only when something waits on them (section 9) |
| They can see everything when they choose | The Logbook on demand in the chat, with drill-down to plan, decisions, log and proof; a daily digest; a weekly decision log (section 9) |
| Low token use on a Max plan | A script makes the engine's routine moves; a model wakes only for judgement (section 10) |

**Non-goals**

- Copilot or any agent but Claude Code. Copilot is the next step after this design, through the agent seam the core cut keeps.
- The pane, the VS Code panel or a phone app. The chat is the one surface for now; the desk interface keeps the way open.
- Unattended goals and delegation. Both stay parked, as the core cut says.
- Archon. Parked, as the core cut says, with the extra conditions in section 10.

**Anti-goals** (failures even if everything technically works)

- The director finds a product-shaping decision already made in a diff.
- Silence, a timeout, or text an agent wrote counts as an approval.
- A decision the director can't answer without asking a question first.
- A piece of work sits idle because a decision waits, when part of it could have gone on.
- Something that changes what users see or get merges without the director.
- The director is pinged for progress rather than for things only they can do.
- The engine burns tokens on a model deciding what happens next.

## 4. Approaches considered

| Approach | What it is | Trade-off | Outcome |
|---|---|---|---|
| **A. Slim and refocus** | Keep Wheelhouse's strong core (the decision shape and its check, the desk interface, intake, review lenses, previews, the helper's gate), cut what real use hasn't needed, and add the way of working in this design | Keeps proven, tested parts; needs discipline so the cut doesn't grow back | **Chosen.** The core cut is its "cut" half; this design is its "add" half |
| B. Rebuild thin on GitHub | Decisions as issues, the board as GitHub Projects, auto-merge by branch protection, rollback by revert pull requests | Little to maintain and a phone app for free, but it throws away the desk, makes decisions comment threads, and can't serve GitLab or projects kept on the computer | Rejected |
| C. Add on top of today | Add these features to v0.2.10 without cutting anything | Keeps every weak piece; more of the complexity a redesign should remove | Dropped |

**Archon.** The director asked for a view on parking it, separately from the core cut. The answer is the same: park it. The deciding reason is that GitLab and projects kept on the computer must run on Wheelhouse's own engine anyway, so keeping Archon means two engines for good. Archon also works against this design: each of its steps starts with fresh context, which makes "why" from the raising agent hard, and a run stops when it asks, which is the opposite of section 6.4. The own engine's one session per piece suits both. The director agreed, with the conditions in section 10.

## 5. The decision line

**The rule:** anything that shapes what the product does, costs money or is hard to undo is the director's. How it is built is the agents'.

| The director decides, before code | Agents decide, and log it |
|---|---|
| Product behaviour: what users see, get or can do | Internal structure, refactors, naming |
| **Algorithms that shape results:** how things are ranked, scored, summarised, priced, chosen or matched, even deep in the code | How to fix a bug that changes no behaviour |
| Anything that costs money: a new paid service, API or infrastructure | The test approach |
| Database or schema changes, and any migration of real data | Performance work that changes no result |
| Auth, permissions, secrets and security | Patch and minor dependency updates |
| Anything others depend on: public APIs, command-line flags, file formats, data contracts | A library inside the stack already in use |
| A new major dependency or framework, or swapping one | Tooling, CI and build changes |
| Deleting data or removing a feature | |
| Large rewrites, or a new service or app | |

This widens the levels in section 6 of the main design (`docs/specs/2026-10-17-wheelhouse-design.md`): algorithms, public interfaces, major dependencies, rewrites, data migration and deletion become director-level by default. The guardrail facts (`scripts/gate/guardrails.js`, the dependency and data-model detection) already find several of these from a change itself; the rest come from the agent saying so when it asks.

**When unsure, it is the director's.** An agent that can't tell which side a call falls on asks.

**The decision log.** Every call an agent makes on its own side is one line in the piece's log: what it decided, the options it saw and why. The weekly digest (section 9) collects them. When the director pulls one back ("I'd have wanted that"), it becomes a ruling for the future, and the line is clearer next time. The pull-back also offers "and change what was built": that goes through the intake as new work, like any request. *Designer's call.*

## 6. Decisions

### 6.1 Chat first

**A decision is a plain chat message,** answered by a short typed reply. It reads the same in any client, in the terminal, in the digest and quoted in an alert. Buttons, where a client offers them, are an extra, never the mechanism.

This changes the core cut, which asks cards through the chat's question picker (`AskUserQuestion`). The picker holds at most four short options, hides the conversation while open, and works only in Claude Code; a card shown twice there led to the one-card design. The director chose chat first on 7 November 2026. What the cards gave is kept:

- **One shape,** composed by `scripts/cards/compose.js` and checked by `scripts/hooks/card-check.js` (section 6.2).
- **Only the director's own words decide.** A reply is recorded from what the director typed, captured by the prompt hook (`scripts/hooks/prompt-record.js`), and signed into the record as clicks are today. Text an agent wrote never counts, however it is worded. Reply codes already count in the chat today; they become the main way to answer.
- **One decision, one answer.** An answered decision isn't asked again, and a second answer to it is refused.

**A known gap in typed replies.** The prompt hook can't tell the director's typing from text another session sends into the director's own front desk, so such text would be signed as their answer. Replies count only in a front-desk session that no script started, which closes the common paths; the gap stays open until the client marks where a prompt came from, and a check of the prompt's source is planned for when that mark exists (main design, section 12.9). *The director's decision, 8 November 2026 (`docs/decisions/2026-11-08-should-a-typed-reply-count-as-the-director-s-answe.md`):* typed replies are on by default, with the gap written in the main design's trust section (section 12.5). They stay one project setting, `typedReplies`: off, a decision is asked through the question picker as before, and the decision message and its check still apply. A setting that can't be read counts as off.

### 6.2 The shape, checked before it is shown

```
Decision needed: <the question, one line>   (holds up: <what waits on it>)
<Why now: one or two lines on what came up and why it's the director's>

A. <option>. <what it costs>. <whether it can be undone>
B. <option>. ...
C. <option> (recommended). ...
Recommended because: <two or three lines, in product terms>

Meanwhile: <what the agent is doing while it waits>
Reply A, B, C, "why", or your own words.
```

- **Two to four options.** Each says what it costs (time, money, tokens or complexity) and whether it can be undone. Today's options have a meaning only; cost and reversibility are new.
- **A recommendation with its reason,** in the director's terms, not code terms.
- **Meanwhile** says what the agent goes on with (section 6.4), so the director knows nothing is idle.
- **Short enough to read on a phone screen.**

Today the check turns a badly formed card into a "stop this work" card. Instead, **a decision that fails the shape goes back to the agent that raised it,** with what is missing, and the agent sends it again. The director only ever sees decisions that pass. An agent that fails three times in a row sends one plain message saying it is stuck.

### 6.3 "Why"

**"Why" asks a copy of the session that raised the decision.** The own engine runs one headless `claude -p` session per piece of work, resumed by its session id (core cut, section 3), so that session holds its full context: what it tried, what it read, what it weighed. The director's question goes to a copy of it (`claude --resume <id> --fork-session`), started read-only, so the building session carries on undisturbed. The answer comes back in the chat, and the director can ask follow-ups the same way. "Why" only explains: anything the director wants changed reaches the builder through their answer to the decision, including their own words. *Designer's call.*

Today's "Why?" reads the card's own parts and a glossary. That stays as the instant first answer; the session copy is asked when the director wants more.

### 6.4 Waiting doesn't stop the work

Like an engineer waiting on a manager, an agent that has asked:

1. **Builds on its recommendation, kept easy to change:** on its own branch, behind a feature switch or behind a clean seam, so a different answer means little rework.
2. **Does the parts that don't depend on the answer:** tests, plumbing, other tasks in its plan.
3. **Stops only before a step that can't be undone:** migrating real data, deleting anything, spending money, or going live. Those wait for the answer.
4. **Never merges what depends on the answer.** Its pull request is marked as waiting on the decision, and the helper's gate refuses to merge it until the decision is answered.

When the director picks the recommendation, the work carries on. When they pick something else, the agent reworks to that answer, and its report says what the change cost.

The dispatcher's parking (`scripts/engine/waiting.js`), which frees a slot while a piece waits, is parked with Archon. In this design a waiting piece usually isn't idle, so it keeps its slot; it gives the slot up only when it has reached a step that can't be undone and nothing else is left.

### 6.5 Never by silence

**Silence never counts as yes.** No decision expires into a choice. Only the director's own reply decides. A decision may be asked again; it is never decided for them.

### 6.6 Decisions are kept

Every answered decision becomes a **decision record**: the question, the options, what the director chose and their words, if any. Two copies:

- **In the project's repository,** as one short file per decision under `docs/decisions/`, so agents and people read the same thing and every future session sees it. A decision that mustn't be public goes to the private record only; when the project is public, the decision message asks.
- **In Wheelhouse's private record,** signed, as today, for the gate and the audit trail.

**How a record reaches the repository.** A decision about a piece is committed on that piece's branch, so it merges with the work. A decision that belongs to no piece, or whose piece is dropped, goes into one batched "decision records" change a day, which touches only `docs/decisions/` and so merges itself as internal-only work (section 8). The private record holds every decision from the moment of the reply, so nothing waits on a merge. *Designer's call.*

**Agents read the records; nothing matches them.** The records are context, read like specs and plans. Superpowers' brainstorming already explores the project before asking and doesn't reopen what was decided, and an approved spec carries the decisions made while shaping it. The records add what a spec doesn't hold: decisions made during a build, and decisions across pieces. There is no search before asking and no "same as last time?" message. If a director-level question comes up again, it is asked as a normal decision, and the agent says what the director chose before. *Decided by the director, 7 November 2026.*

Ask-once (`scripts/delegation/asked.js`) and merged asks (`scripts/state/joiners.js`) stay as they are under the core cut; this design adds no matching of its own.

## 7. Proof notes instead of code review

Every finished piece reaches the director as a **proof note**, written for them rather than as a pull request body:

- what changed, in product terms, and why;
- what it decided on its own (from the decision log), and which decisions it followed;
- how it was checked: tests, the review lenses that ran and what they found;
- what it looks like: preview screenshots on desktop and phone (`scripts/engine/preview.js`), or command output;
- **for data work, a before-and-after of the data:** row counts, changed values on a sample, and anything that moved unexpectedly. This is new. *Decided by the director:* it runs on a **read-only sample of real data**, for a project whose director has approved one read-only route to it, once; otherwise on test data, and the note says which. Agents never write to real data, and the route is a guardrail, not a prompt.

The director reads the note. They open the diff only when the note worries them. The independent reviewer (the Lookout and its lenses) has already read the code.

## 8. Merging

| What the work touches | How it merges |
|---|---|
| Nothing of the director's: internal-only, no change to behaviour, no director-level call | **Merges itself** once checks pass, the reviewer finds nothing blocking and nothing users see has changed. Shown afterwards in the daily digest |
| Something users see, or a director-level call | Waits for the director's approval, with the proof note |

- **"Users see it" is judged from the change as well as at intake.** Today the First Mate decides visibility when the request comes in. The gate also checks the change itself (pages, text, command-line output, flags, settings, results), and a change that turns out visible waits for the director even if intake thought otherwise.
- **Undo is one step on every host.** Today `undo` works only for projects kept on the computer. Each merged change can be reverted by one reply, on GitHub and GitLab as on the computer, by a revert the helper opens and merges through the same gate.

## 9. The director's day and visibility

**The day:**

- **Two short desk sessions,** about half an hour each: in the morning to set direction, shape new work and answer bigger decisions; late in the day to look at what finished and queue the next.
- **Check-ins whenever** the director likes.
- **New product ideas are shaped at the desk,** through the intake and `superpowers:brainstorming`. Agents start from a design the director approved.
- **Phone alerts only when something waits on the director.** Never for progress.

**How things reach the director after the core cut parks the courier.** Decisions and the digest wait in the chat and are shown at the director's next message, as the core cut's board-context hook already does. A phone alert, sent by the helper through ntfy or Telegram, says only that something waits and where ("1 decision waits in vidantic"), with no content and no link, which keeps the existing rule that alerts carry no content. *Designer's call.*

**What is pushed:** decisions, and one **daily digest**: what merged by itself, what finished and waits for approval, what is waiting on decisions and what each piece did meanwhile, and the day's usage. Once a week the digest also carries the **decision log** (section 5).

**What is pulled:** the Logbook in the chat (`/wheelhouse:logbook`): every piece of work and its stage (shaping, building, waiting on the director, in review, merged), its latest step and comment. Drilling into a piece shows its brief, plan, decisions, log and proof note. PR #370's "watch the crew", re-scoped as the core cut says, gives the step-by-step view.

## 10. The engine

The core cut makes Wheelhouse's own engine the only one: the watcher, the foreman and one headless feature session per piece, in its own worktree. This design adds conditions, agreed with the director when Archon was parked:

1. **Routine moves are made by a script, not a model.** Starting the next piece, waking a session after an answer, noticing a finished or stuck piece and opening the gate are a script's job. The foreman model wakes only for judgement: an ambiguous report, work that is stuck, something no rule covers. **Inside a piece, the feature session still runs Superpowers' own loop** (plan, subagent builds, reviews), so Superpowers stays the one process framework, as the core cut says; the script doesn't split a piece into separate calls. The dispatcher's idea is rebuilt small inside the own engine, not restored from Archon's parked code. This keeps the engine predictable, and keeps tokens off deciding what happens next. *Designer's call.*
2. **The engine contract and its fake stay** (`scripts/engine/contract.js`, `fake.js`), as the core cut says, so another engine can be plugged in.
3. **Crash resume,** as the core cut decides.
4. **A reliability bar.** The engine records each piece that is lost, stalls or needs a crash resume. More than **three in a month** across the director's projects triggers the look at Archon early, on top of the core cut's triggers and its 7 February 2027 date.
5. **Three pieces at once** (the `pace` setting), so the director's review keeps up.

## 11. Where it runs

- **Now:** the director's laptop, which is on during the day.
- **Later:** a Mac mini that stays on. The main design lists running on a server as a non-goal; this design makes an always-on Mac a goal for a later release. Nothing in this design depends on which Mac runs it: decisions, the Logbook and the digest come from the desk interface, and alerts go by the helper. What the Mac mini needs (staying awake, starting the helper and watcher at login, how the director reaches the chat from the laptop) is a design of its own when the time comes.

## 12. What changes from today

| Today | After this design |
|---|---|
| Cards in the chat's question picker | Plain chat messages answered by a short reply (section 6.1) |
| A level-3 or 4 ask stops the piece | The piece builds on its recommendation and stops only before an irreversible step (section 6.4) |
| A badly formed card becomes a "stop this work" card | It goes back to the agent to fix (section 6.2) |
| "Why?" reads the card's text | It also asks a copy of the session that raised the decision (section 6.3) |
| Options have a meaning | They also have a cost and say whether they can be undone (section 6.2) |
| Decisions live in the private record | Also as files in the project under `docs/decisions/` (section 6.6) |
| Algorithms, public interfaces, major dependencies, rewrites, migrations and deletion aren't director-level by default | They are (section 5) |
| Agents' own calls appear as assumptions | Each is a line in the decision log, collected weekly (section 5) |
| The briefing shows when the director arrives | A daily digest too, and content-free phone alerts (section 9) |
| Visibility is decided at intake | The gate also judges it from the change (section 8) |
| Undo only for projects on the computer | Undo on every host (section 8) |
| Proof is a pull request body | A proof note for the director, with a data before-and-after for data work (section 7) |

## 13. Left to the builder

- How the session copy answering "why" is kept read-only.
- The exact switch or seam used to keep work on a recommendation easy to change, per project.
- How the data before-and-after is produced for each kind of data work (dbt, SQL, scripts).
- The digest's layout, within section 9.
- How the gate judges "users see it" from a change, starting from the guardrail facts.
- How replies are matched to their decision when more than one waits (for example, a short number on each).

## 14. A rough order for the build

This follows the core cut's build; nothing here starts until its parts 1 to 5 have landed.

1. **Chat-first decisions** (section 6.1): the message shape, replies recorded from the director's own words, the picker retired.
2. **The decision line and the decision log** (section 5): the widened levels, and one log line per agent call.
3. **The shape check and sending back** (section 6.2).
4. **Decision records in the project** (section 6.6).
5. **Building on the recommendation** (section 6.4), with the gate's "waiting on a decision" hold.
6. **"Why" by a session copy** (section 6.3).
7. **Proof notes**, with the data before-and-after (section 7).
8. **Merging by what the change shows, and undo on every host** (section 8).
9. **The daily digest, alerts and the weekly decision log** (section 9).
10. **The script's routine moves and the reliability bar** (section 10).

Parts 3, 7 and 9 touch separate areas and can run side by side.
