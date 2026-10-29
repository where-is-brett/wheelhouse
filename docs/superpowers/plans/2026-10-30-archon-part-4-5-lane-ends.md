<!-- docs/superpowers/plans/2026-10-30-archon-part-4-5-lane-ends.md -->
# Part 4.5: the engine lanes' loose ends

**Goal.** Two gaps left by parts 4.1 to 4.4 (#119, #123): nothing on the new engine writes a `merged` report for quick, small or bug work, and a feature can hold the feature lane's place with no card.

**Where it lands.** `scripts/engine/dispatch-run.js`, with a one-block change to the helper's wiring (`scripts/host/helper.js`). #125 also changes the helper, so the helper change stays small.

## What the old engine did, and where the director reads it

- The old engine wrote the report in the foreman's `act close` (`scripts/foreman/act.js`): `report { work, outcome, summary, rulings, pr }`. The outcome was `merged` only when the host said the pull request had merged.
- The director reads it in three places:
  - the briefing's shipped lines (`shippedLines` in `scripts/engine/words.js`);
  - the board (`scripts/board/model.js`);
  - the pane (`scripts/desk/mod-pane.js`).
- The dispatcher reads it too. `dependsOn` clears only on a `merged` report. While a ready pull request's work has no report, the merge queue counts it as waiting and starts again every 15 minutes.

## Decisions

1. **A merged report for quick, small and bug work** (spec 3.1's last step: "briefing line, shipped, with its cost").
   - Each tick reads the work that has no ending report since it was queued. That is work in any lane but `feature`, with a run that ended with a pull request.
   - When the host says that pull request has merged, the tick writes `report { work, outcome: 'merged', pr, summary: MERGED_WORDS, rulings: [] }`, once.
   - The tick reads the run records, not the ready list, as the feature lane does. A pull request the director merged by hand still counts as shipped.
   - Fix-main work has no work record, so it gets no report.
2. **A slice's or the feature's own pull request closed unmerged → one card** (level 3). Wheelhouse can't tell why someone closed it, so the director decides.
   - **Build it again:** that step carries on from its branch and opens a new pull request.
   - **Stop here:** the feature ends.
   - The recommendation is Stop here, because someone closed the pull request on purpose.
   - Meanwhile, nothing more of the feature starts.
3. **Stop here on the cap card → the lane is released, with a Logbook line.** The director has already decided, so a second card would ask again.
   - It writes `report { outcome: 'closed' }`, which frees the place. The slices already added stay behind their switch.
   - The First Mate's Carry on queues the feature again.
   - A raised cap that is spent too ends the feature the same way. Its note says so already; until now it held the place.
4. **A run of the feature that was cancelled with no card → one card.** This covers a midpoint demo the director rejected, a switch-on they rejected, and a cancel made in Archon itself.
   - It is a run whose latest record ended `cancelled`, whose pull request hasn't merged, which All stop didn't cancel, and which no question names. The cap card names its run.
   - The card has the same two options as decision 2 and recommends **Build it again**, since the director's rejection asks for a change of course, not an end.
   - The card names the demo or the switch-on when the run was one.
   - I could find no record that says a run was rejected. The `rejected` node is a cancel and gives no output, so the rule asks only that nothing else explains the cancel.
5. **#123's MEDIUMs on the same path:**
   - A pull request read as closed is kept, so later ticks don't ask the host about it again.
   - The feature's report is written before its flag is set, so a write that fails is tried again on the next tick, not lost.
   - The other MEDIUMs are elsewhere and stay open: null slice heads, contrast, `approved.js`, and the tester's own judgement.

**Interface.** `dispatchRun` takes `prState(pr) -> 'merged' | 'open' | 'closed' | null`. `prMerged` is kept as a fallback for callers that pass only that. The helper passes `prState`.

## Tasks (each test written and seen failing first)

1. `tests/scripts/engine/dispatch-merged.test.js` (new):
   - quick, small and bug work whose pull request merged gets one merged report;
   - an open pull request gets none;
   - feature work gets none from this path;
   - work queued again is judged on its new runs only.
2. `tests/scripts/engine/dispatch-feature.test.js`:
   - a slice pull request closed unmerged brings one card, and the host isn't asked about it again;
   - Build it again carries the slice on from its branch;
   - Stop here, on the closed card and on the cap card, writes a closed report and a Logbook line, and frees the place;
   - a rejected midpoint demo brings one card;
   - a cap-cancelled run or an All stop cancel brings none;
   - the report is written before its flag is set.
3. Implement in `dispatch-run.js`; wire `prState` in the helper.
4. Scenarios 90 to 94, in `tests/eval/build-loop/`:
   - 90: quick work merged, with its report and its shipped line;
   - 91: small work merged, and dependent work starts;
   - 92: a slice pull request closed unmerged brings a card, and Build it again;
   - 93: Stop here frees the feature lane for the next feature;
   - 94: a rejected midpoint demo brings a card.
5. Run the touched folders; an independent whole-branch review; open the pull request.
