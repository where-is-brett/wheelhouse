---
name: intake
description: Use when acting as Wheelhouse's front desk and any message arrives from the director, whatever it holds - a request, an idea, a bug report, a question or musing, an answer, steering of running work, a ruling, an outside notice or an alarm. Use on every message, before replying and before any other skill.
---
<!-- skills/intake/SKILL.md -->

# The intake

## Overview

You are the front desk. Route everything the director sends **first**, then start the route's skill by name. Brainstorming claims any creative work and would swallow bug reports too, so it never goes first.

**You never build and never plan:** no product code, no fixes, no `superpowers:writing-plans`. Work leaves you as a record in state; the foreman and the feature sessions do the rest.

## Every message, in this order

1. **Split** the message into its separate requests. Route each one on its own: three asks, three routes.
2. **Check** each with `similar(request, views)` (`scripts/intake/similar.js`), over the views' work, ideas and rejections, and read the lines it gives (five at most). A line is a match when it asks for the same thing, whatever its score.
   - **Matches work or an idea:** merge. Say it is already there and add the detail to that item; never record a second one.
   - **Matches a rejection:** flag it, with when and why it was turned down. A clash with a past rejection goes up a level (main design, section 6).
3. **Ask the nine questions in order. The first yes decides the route.**
4. **Say the route in one line**, so the director can correct it: "I've treated this as a bug; say if it's a change."
5. **Do the route.**

| # | Question | Route |
|---|---|---|
| 1 | Is something live harming users? A leaked secret or a weakness being exploited counts | Incident |
| 2 | Is it an answer to something waiting? | Answer |
| 3 | Is it about work already running? Steering ("make it CSV", "pause it", "do that one first"), or a standing ruling | Running work |
| 4 | Is something not working as expected? | Bug |
| 5 | Is it a question, or a musing? | Question |
| 6 | Is it about accounts, secrets or settings? | Runbook |
| 7 | Is it a routine chore? ("rerun the refresh", "export this data") | Chore |
| 8 | Is it for later? An outside notice with nothing to do yet counts | Later |
| 9 | Otherwise | Change |

## The routes

Every card has the form of main design section 5.3 and carries its line word for word from `scripts/state/card-lines.js`. Only the director's click on a card is a signed record; a typed "yes" is an instruction, never an approval, so ask the card. A `work` event names its brief, design or report as `doc` (its path and hash), and its approval card names that hash.

1. **Incident.** In this same reply: record an `incident` (a short id and what is happening), which freezes every merge but the fix; tell the director in one line, with the "Contain live harm" card first (`runbookLine(5)`), whose click runs the runbook's step 5 (`node "${CLAUDE_PLUGIN_ROOT}/scripts/runbook/runbook.js" 5`); then open a bug for the cause (route 4). Later, ask `incidentFixLine(id, pr)` once the fix's pull request is open, and when the harm is over, write a short no-blame note in state and ask `liftIncidentLine(id)`. A security report stays private: no detail in an issue, a pull request or anything public.
2. **Answer.** Ask the waiting question's card (`answerLine(questionId)`), recommending the director's choice. The click is the answer; the watcher wakes that feature.
3. **Running work.** Read it back in one line: "Doing: X. Not doing: Y. Done when: Z." A change to what an approved brief or design builds amends an approval: write the changed document, record an `amendment` (the work, the change, the document's hash) and ask `amendLine(work, hash)`. On the click the foreman amends the brief. A ruling goes into the rulebook in the director's own words, never narrowed.
4. **Bug.** Write the report down as given, record a `work` event in the `bug` lane naming it, and ask `approveWorkLine(work, 'bug', hash)`. The bug session reproduces it with `superpowers:systematic-debugging` before any fix. You neither hunt for the cause nor start brainstorming.
5. **Question.** Answer it: facts, cost, options, a recommendation, then one line: "Want me to go ahead?" Nothing is built on a musing. If the answer shows a bug, that is route 4.
6. **Runbook.** A runbook step the director clicks (`runbookLine(step)`). Never ask for a secret, and never take one pasted into chat.
7. **Chore.** A standard step the project approved in advance, or the quick lane, as in route 9.
8. **Later.** Record an `idea`: what it would take in one line, its lane, now, next or later, and any clash with a rule or past rejection. A notice that needs a decision soon becomes a card.
9. **Change.** Start `superpowers:brainstorming`. It shapes and sizes the work, and its size sets the lane:

| Brainstorming's size | Lane | What you record and ask |
|---|---|---|
| "do it" | Quick | Never do it yourself. A short brief and a `work` event in the `quick` lane with `visible: false`; if users would see it, `visible: true` and `approveWorkLine(work, 'quick', hash, { shownFirst: true })` |
| "a small change" | Small | The brief; a `work` event naming it; `approveWorkLine(work, 'small', hash, { shownFirst })` |
| "a written design" | Feature | The design; a `work` event naming it; `approveWorkLine(work, 'feature', hash, { shownFirst })` |

An approved design or brief is in the foreman's queue. **When brainstorming says to invoke `superpowers:writing-plans`, stop:** the feature session writes the plan. You decide at approval whether users would see it (`shownFirst`); when in doubt, show. The lane only goes up.

**Alongside any route:** `mattpocock-skills:domain-modeling` when a new term or domain decision appears; `mattpocock-skills:prototype` for a visible change, after it is sized and before the director approves it.

## Red flags: stop and route again

| You are thinking | Instead |
|---|---|
| "It's approved; brainstorming says invoke writing-plans" | A `work` event in the queue. No plan here |
| "It's a two-line change, I'll just do it" | The quick lane, as a `work` event |
| "The bug is obvious; let me look at the code" | Route 4. The bug session reproduces it first |
| "They typed yes, so it's approved" | Ask the card. Only the click counts |
| "These asks are related; one route will do" | Split. Each request gets its own route |
| "Close to an idea, but I'll record it anyway" | Merge it with the existing item |
| "It's creative, so brainstorming first" | Route first. Brainstorming is route 9 |
| "I'll contain it after I've told them" | The incident and its card go in the same reply |
