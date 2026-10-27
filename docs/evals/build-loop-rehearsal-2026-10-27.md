<!-- docs/evals/build-loop-rehearsal-2026-10-27.md -->

# The build loop's rehearsal, 27 October 2026

One small piece of work, "add a line to the README", was taken through the whole build loop with real sessions and Wheelhouse's own code. The steps were:

- the director's request;
- the front desk, with an approval card when the director asks to see the work first;
- the foreman;
- the feature session, with its reviewer;
- the pull request;
- the merge gate, the director's approve click, and the merge;
- the director's briefing afterwards.

The aim was to find every place where the loop stops, or asks the director something odd, before a director meets it.

**Run on** 27 October 2026, on macOS, with Claude Code 2.1.302 and Superpowers 7.0.0, from branch `rehearsal/build-loop`. That branch is built on `fix/merge-lock` (#95), so the lock is taken at every session start. The front desk and the foreman ran on the most capable model, and Fable was never used.

## How it was run

The rehearsal is a one-off driver script, kept out of the repository. It builds on the setup end-to-end world (`tests/helpers/setup-e2e.js`):

- **Setup.** Setup's real steps run to green for a new product, "Cafe Menu", in a scratch home with its own `CLAUDE_CONFIG_DIR`. The director's real configuration is never touched. Setup's stand-in host plays GitHub, so no repository is made anywhere.
- **The helper.** The helper is then restarted with a stand-in adapter that can merge. Its checks always pass, it reports every pull request mergeable, and a merge moves `main` to the pull request's head.
- **The watcher.** The real watcher (`scripts/watcher/main.js`) runs for the project. It starts the real foreman and feature sessions through a `claude` shim, which adds:
  - a copy of this checkout's plugin, whose lineage manifest is the setup world's;
  - the installed Superpowers;
  - project and local settings only.

  The models are pinned on the host's main: the most capable model for the front desk and the foreman, the mid-sized model for the rest.
- **The front desk.** A real `claude -p` session plays the front desk, driven over stream-json. The driver plays the director:
  - it types the request;
  - every nine minutes, it asks "Anything for me?";
  - it answers each card as a director would, approving where approval is offered;
  - after the merge, it asks "What happened while I was away?".
- **Sign-in.** Claude Code itself keeps the computer's own sign-in, since a scratch configuration folder has none.

Ten runs were made:

- Each of the first eight stopped at a finding or at a fault in the rig, which was fixed before the next run.
- Run 9 took a quick change, which the director doesn't see first, from the request to the briefing.
- Run 10 took a small change the director asked to approve first, through both approval cards to the briefing.

## Findings

### Blocker (fixed)

1. **No work could start in a folder that setup had connected.** `act start` makes a worktree from `origin/HEAD`. But setup connects a new product's folder, and a joining computer's, with `git remote add` and `git fetch`, never `git clone`, so `origin/HEAD` is never set. The foreman's every `act start` was refused.
   - **Fix:** when `origin/HEAD` is missing, `act start` now asks the helper for the host's default branch and names it (`nameBase`, `scripts/foreman/act.js`).
   - **Test:** `tests/scripts/foreman/act.test.js`.

### High (fixed)

2. **The foreman asked the director for an "appetite" on every quick, bug and small job.** Only a feature's pitch sets an appetite, but every brief needs one, so the foreman put a question to the director that they couldn't sensibly answer.
   - **Fix:** each of these lanes now has its own appetite (`LANE_APPETITE`, `scripts/lib/build-loop.js`):
     - quick: one session, 1.5M tokens;
     - bug: one session, 2M tokens;
     - small: one session, 3M tokens.

     The foreman's `Next:` line gives the appetite, and the foreman skill takes it from there. These figures are a starting point for the designer to set.
   - **Test:** `tests/scripts/foreman/wake.test.js`.
3. **The foreman's own question cards weren't in plain words.** Each option's description was the raw `act start …` command, and the card said "the session building … recommends it". The "meanwhile" line on every answer card was also a lower-case fragment.
   - **Fix:** a card for the foreman's own question now describes each option by its label, and says the agent that runs the building recommends it. The meanwhile line is a full sentence (`scripts/cards/compose.js`).
   - **Test:** `tests/scripts/frontdesk/cli.test.js`.
4. **A pull request waiting for the director's approval never reached them until they typed.**
   - **Run 10:** the gate asked for the director's approval at 02:05 UTC. For the next eight minutes:
     - the status line said "1 building";
     - nothing woke the front desk;
     - when the director asked "Anything for me?" a minute before the gate asked, the front desk said nothing was waiting.

     The card came only at the director's next message.
   - **Why:** the front desk makes the cards for these records only when it runs `cards`:
     - a click the gate waits for (an approval or a CI push);
     - a lineage hold;
     - a control-file record;
     - a premium model's failed evaluation.

     The session-start hook counted them on the director's own message. The pane's model, which the status line and the courier read, didn't count them. So a director who wasn't typing was never told.
   - **Fix:** the pane's model lists each of these records that has no card yet, as a line with no buttons after the cards waiting, as it already did for a question from the build. The status line then counts it, and the courier wakes the front desk. On that wake the front desk runs `cards`, which makes and asks the card (`scripts/mod/status.js`).
   - **Test:** `tests/scripts/mod/status.test.js`.

### Medium (listed, not fixed here)

5. **Certificate noise.** The foreman's and feature sessions' `node` commands lack `--no-use-system-ca`. Under `NODE_USE_SYSTEM_CA=1`, which the Claude desktop app sets, each sandboxed command prints eight "failed to copy trust settings" lines. The front desk's commands already pass the flag.
6. **The tool guard gives the wrong reason for refusing `sh <script>`.** It says "run the host tools, push, or read a .env file". The session spent about six calls working out what was really refused.
7. **The front desk mentions a notification that failed.**
   - In runs 9 and 10 it told the director "I couldn't send a phone notification". In run 10's briefing it suggested setting notifications up.
   - The playbook says to say nothing about what the notification answered.
   - The rig blocked `PushNotification`, but the wording is the front desk's own.
8. **The foreman first typed a bare `act ask …`** rather than the full command. It was asked for approval, then recovered.
9. **A merge held for a provenance mismatch is explained in the gate's own terms.**
   - The card says the change "was not added to the product: its provenance does not match the manifest, because an upstream commit differs".
   - Its glossary leaves out "provenance" and "manifest".
   - The hold was a fault in the rig (see below), but a real mismatch would reach the director in the same words.
10. **A merge held for a provenance mismatch has no way forward.**
    - For a different Wheelhouse version, the card says it "needs your say", but offers only Wait, Leave it, or Suggest a change.
    - None of these lets the change through, and none asks for it to be built again under the version now running, which is what such a hold usually needs.
    - A real mismatch happens whenever Wheelhouse is updated while a pull request waits. The build-loop design (section 14.6) refuses the merge without saying what follows.

    This is a designer's call, so it is listed here, not fixed.
11. **The quick-lane briefing (run 9) speaks a developer's language, and asks the director to do a developer's step.** It said "The main branch now has the commit …", and that the README line "will appear the next time you pull".
    - Nothing in Wheelhouse brings the director's own copy of the project up to date after a merge; only a feature worktree is ever pulled (`scripts/feature/cli.js`).
    - So the director is told about a step they have no way to take.
    - Run 10's briefing, by contrast, was plain: the line went in, it is the one approved, and nothing else changed.
12. **The small-lane feature session was refused what Superpowers asks of it.**
    - It couldn't read Superpowers' own helper scripts in the plugin cache, such as `executing-plans/scripts/task-done`.
    - It couldn't write a test script to `/tmp`.
    - Each needs a permission prompt, which a headless session refuses.

    The session worked around both, but a larger job would lose more turns this way. The rig loaded project and local settings only, so the director's own user settings might allow these; this wants checking on a real install.

### Low and notes

- **An invented ledger.** The small-lane feature session tried to write a ledger into Wheelhouse's state folder, at a path no instruction named. The guard refused it, and the session kept its rulings in its plan instead.
- **A stale "still queued".** At run 10's first look-in, the front desk said the change was "still queued", though its pull request was already open.
- **A glossary entry for the product's name.** The approve-work card's terms line read "Cafe-Menu means A new product, still taking shape", which defines the product's own name, with a capital letter mid-sentence.
- **The quick lane.** The feature session made the edit itself, with no builder subagent. Its reviewer subagent ran in the foreground and signed a CLEAN review on the head. Both pull requests' bodies carried the provenance block.
- **Cards and records.** The front desk queued quick work with no approval card, as designed for work it doesn't show. When asked to show the work first, it made the work's approval card at once. Each time, it said what it would and wouldn't change, and what "done" means.

## Rig faults (not findings)

Each of these came from the rehearsal's own set-up, and was fixed in the driver:

- **The lineage hold.** The director's own kits differed from the setup world's pinned manifest. The rig's plugin copy now carries the world's manifest, and its hooks are given the scratch `CLAUDE_CONFIG_DIR`.
- **The model pins.** The setup world's model pins named stand-ins; they were rewritten to real models on the host's main.
- **Sign-in.** The driver's own environment carried the scratch `CLAUDE_CONFIG_DIR`, so the feature session wasn't signed in.
- **The mergeable value.** The stand-in host reported mergeable as `'mergeable'`, not `'yes'`, so the watcher never woke for `merge-ready`.
- **The provenance holds (runs 6 to 8).** The gate checked the pull request against the real checkout's manifest, but the sessions ran with the rig's copy, whose upstream commits differ. The helper now checks against the rig's copy, whose `wheelhouse.version` is the plugin's own.
- **Blocked tools.** The rig blocked `PushNotification` and switched off the computer's other installed kits.

## Run 9: quick lane, request to merge

Times are from the driver's start (the request goes in at +0:18).

| Time | What happened |
|---|---|
| +0:18 | The director asks: "Please add a line to the README saying that orders close at 9pm on weekdays." |
| +0:55 | The front desk queues it as quick work, and says what it will and won't change. Quick work is seen after it's done, so there's no approval card. |
| about +1:30 | The foreman wakes. It starts the feature with the quick lane's own appetite, and makes the worktree from the host's default branch. |
| +3:56 | The feature session edits the README, and its reviewer signs CLEAN on the head. It opens pull request #1, with the provenance block. |
| +5:42 | The watcher wakes the foreman for `merge-ready`, and the gate merges #1. A hidden quick change needs no approval from the director: the build-loop design (section 13) asks for it "only if shown first". |
| +7:31 | Asked "What happened while I was away?", the front desk says the change went in and nothing is waiting (but see finding 11). |

Nothing stopped the loop, and the director was asked no question.

## Run 10: small lane, shown first, request to merge

The request adds: "I'd like to see and approve it before it goes in." Times are from the driver's start.

| Time | What happened |
|---|---|
| +0:17 | The director asks. |
| +1:04 | The front desk shows the exact line, and asks the approve-work card. The director approves. |
| +2:21 to +4:28 | The foreman starts the feature in the small lane. The feature session writes its plan, records it, and ends its turn to wait for the build wake. |
| +6:55 to +8:55 | On the foreman's build wake, the session writes its tests first, edits the README, has it reviewed, and opens pull request #1. |
| +10:12 | The director asks "Anything for me?". The gate hasn't asked yet, so nothing waits. |
| +11:31 | The foreman's merge finds the gate waiting for the director's approval of the head commit. For eight minutes nothing tells the director (finding 4). |
| +19:27 | At the director's next "Anything for me?", the front desk asks the approval card, "Put pull request #1 live?". The director approves. |
| +21:07 | The foreman's next wake merges #1 at the approved commit. |
| +23:41 | Asked "What happened while I was away?", the front desk says the approved line went in, nothing else changed, and nothing is waiting. |

With finding 4 fixed, the approval card would have woken the front desk at +11:31, and been on the pane at once.
