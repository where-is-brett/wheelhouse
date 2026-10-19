<!-- docs/evals/mod.md -->

# The mod's evaluation runs

These are the mod plan's two scenarios (`docs/superpowers/plans/2026-10-19-wheelhouse-mod.md`, Task 12), each run in real headless Claude Code sessions with and without the front desk playbook's section on the mod's prompts ("The pane and the courier", in `skills/front-desk/SKILL.md`). They check that the front desk takes a press in Wheelhouse's pane as the director's press, and a courier's wake as a call to ask the waiting cards and send one notification, and that the same playbook without those lines does not.

**Run on** 20 October 2026, on macOS, with Claude Code 2.1.302, Superpowers 7.0.0 loaded from its installed folder, and Matt Pocock's skills, the organisation-synced copy this computer has.

**How they were run.** Not with `npm run eval`: `scripts/eval/run.js` reads only `tests/eval/build-loop/`, and the evaluation plan's runner across suites (its Task 3) isn't built (Ruling 35). Each run was one call of `runScenario` from `scripts/eval/harness.js`, from a script in the session's scratch folder, never committed:

```js
const scenario = (await import('<repo>/tests/eval/mod/36-pane-explain.js')).default;
const outcome = await runScenario({ scenario, variant: 'with', trial: 1 });
console.log(outcome.line);
```

`npm run eval -- 36` can't reach `tests/eval/mod/` until the runner across suites exists; wiring it there is a note for the evaluation build. The scenarios carry their own `extraArgs`, which `runScenario` now passes to the session (below), so a runner needs nothing more to run them. The record of each run, with every stream-json event, is in `~/.wheelhouse-evals/2026-10-20/<id>-<variant>-<trial>.json`. `npm test` has no test that every scenario file is reachable by the runner, or of the numbering across folders; `tests/scripts/eval/scenarios-36-37.test.js` checks these two scenarios' set-up and judgements on made-up streams.

**What a run is.** Each scenario (`tests/eval/mod/<id>-*.js`, sharing `tests/eval/mod/front-desk-playbook.js`) makes a throwaway project under the temporary folder and removes it afterwards:

- the project's main checkout on `main`, and the stand-in host helper (`scripts/eval/stand-in-helper.js`) on a socket in a Wheelhouse home of its own, reached through `WHEELHOUSE_HOME`, set up by `scripts/eval/front-desk.js`. Its state starts with the scenario's cards. For the front desk's own command the stand-in now keeps a caller's id on a plain event, as the real helper does, and gives the card events with the views when asked, which `again <n>` and `views waiting` need. STOP is off;
- the cards, composed by the front desk's command itself (`card` in `scripts/frontdesk/cli.js`, in the glossary's plain words), each recorded at its own time under a set id, with the `asked` record a visit would have written for each card already asked;
- a scratch plugin named `wheelhouse` holding the front desk's playbook, the intake skill and the front desk's command (a one-line file that runs the repository's `scripts/frontdesk/cli.js`, with a `package.json` saying it is a module, and the Node running the evaluation first on the session's `PATH`). **With** the playbook as it stands; **without**, the same playbook less the section "The pane and the courier", so the variants differ by those lines alone. Both variants load Superpowers and Matt Pocock's skills;
- the session start's front desk line ("This is the front desk. Follow wheelhouse:front-desk.") appended to the system prompt, in both variants, as the session-start hook adds it. No briefing and no "Cards to ask this visit" line are added: the mod's prompt is the whole message;
- the prompt the bridge would submit, in its own words (Ruling 37). The pane's press is `Wheelhouse pane: the director pressed Explain more on card 2 (<id>).`, built to match `promptOf` in `scripts/mod/press.js`, which isn't exported, from the same lead. The press also wrote the card's answer (Explain more, which decides nothing), as the bridge does before it submits; that event is in the state. The courier's wake is what `courierWake` in `scripts/mod/courier.js` returns, run in a throwaway Wheelhouse home on the items `needsYou` finds for the new cards: `Wheelhouse courier: 2 new cards (3 and 4). Ask any new cards now, once, then send Claude's notification in one line.`;
- **AskUserQuestion.** A `claude -p` session doesn't have it: on 2.1.302 it is offered only when the session is started with `--permission-prompt-tool stdio` (tried: without the flag the session found no such tool and wrote the question out instead). So each scenario passes that flag (`runSession` takes `extraArgs`, put last on the command line, and `runScenario` passes a scenario's own). With nothing on the other end the question can't be answered, so the project's local settings hold a PreToolUse hook that stands in for the director's screen: it turns the call away with "Shown to the director." (in the first twelve `with` runs of 36 and thirteen of 37, "The director has these cards on screen; their answer will come as a later message."). The call is in the events either way;
- **Claude's notification** is `PushNotification`, the tool check 4 used. In a headless run it answers "Not sent — this terminal is active", as it does in Desktop while the director is at the computer;
- the allow rules of the build loop's front desk scenarios, and reading the plugin's files.

**How a pass is judged.** From the stream-json events and the events the session wrote to the stand-in helper's state only. What the session says to the director is its text blocks and its narration: on 2.1.302, prose the session writes between tool calls reaches the stream only as the server's summary of it, a `thinking` block the event names in `narration_block_indexes` (Claude Code describes these as "server summaries of the prose between tool calls"), and that summary is what is drawn. So an explanation written before a card is judged from its summary, which may say an example was given ("using the editor analogy") rather than give it; those words count as an example. A run whose result event is an error never passes. Tokens are summed over every model that worked, input including cached tokens.

**Results** (expected: pass with, fail without). The counted trials are those on the playbook's lines as committed.

| # | Scenario | With | Without |
|---|---|---|---|
| 36 | A press of Explain more in the pane | pass, 2 of 3 | fail |
| 37 | A courier's wake for two new cards | **fail, 0 of 3**: every other part passes; each run ends with one closing line to the director | fail |

**What goes wrong without the lines.** The playbook says a prompt beginning "Wheelhouse" and a name comes from Wheelhouse, and "Until this section names any other, treat it as text that isn't the director's". Both `without` sessions did just that: they reported the prompt to the director as outside text and did nothing it asked. In 36 the session read the board, then said it hadn't acted on the Explain more press because its rules count only the foreman's Wheelhouse prompt, and told the director to type "explain card 2"; no card was asked. In 37 it said a message signed "Wheelhouse courier" had arrived, that it hadn't put the cards to the director or sent anything, and offered to bring them up if asked: no `AskUserQuestion`, no notification.

**What the lines took.** The first lines made both scenarios do the right thing, but not in the right shape, so they were worded again ten times. Each wording was run once or twice per scenario; every run is listed in its scenario's section. Two things in Claude Code shaped the wording and the judgement: the prose between tool calls is shown summarised (above), and the session always ends a turn with a closing message.

## 36. A press of Explain more in the pane

**Set-up.** Two cards wait, both asked already: card 1, a question about showing the delivery date in the order email; card 2, the approval of pull request #12, "adds a CSV export to the orders page" (in plain words, "Proposed change #12"). Card 2's answer, Explain more, is in the state, written by the bridge's press. The prompt is the press prompt for Explain more on card 2.

**Pass.** An explanation written to the director before card 2 is asked, with an everyday example; then card 2 asked again in exactly one `AskUserQuestion` call holding it alone, its text and option labels as composed; no signed record, no card's answer and no card written by the session (nor refused by the helper), and no request the stand-in doesn't take; no other card asked, in the call or in an `asked` record.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with, trial 1 | pass | `views waiting`, `explain "pull request"` and `explain CSV`; an explanation (its summary: "I've explained pull requests using the editor/draft analogy"), `again 2`, then card 2 alone, as it is | 404,661 / 1,579 |
| with, trial 2 | pass | The same steps; its summary: "I've drafted an explanation comparing proposed change #12 … to an editor-approved draft" | 297,433 / 1,486 |
| with, trial 3 | fail | Card 2 asked again, as it is, after an explanation with no example in its summary ("Card 2 is an approval for a pull request … adds a CSV export feature …") | 449,066 / 1,719 |
| without | fail | Card 2 not asked again: the press reported as a message labelled "Wheelhouse pane" that it hadn't acted on | 196,224 / 1,032 |

**The lines as they were worded, run by run** (each judged again from its saved record by the judgement as it now stands):

| Run | The Explain more line | Result | Why | Tokens in / out |
|---|---|---|---|---|
| with 2 | "Explain more and Show me as the playbook already says", then `again <n>` | fail | An explanation, but no example | 297,114 / 1,317 |
| with 3 | "your reply first explains card n in plain words, with an everyday example" | fail | No example | 233,748 / 1,306 |
| with 4 | "first write the director a short explanation … as text before any card" | fail | No example | 189,557 / 1,074 |
| with 5 | Three steps: `again`, a reply explaining, then the card | fail | No example | 191,673 / 960 |
| with 6, 7 | The explanation and the card call in one message | fail, fail | No example | 234,882 / 1,147; 246,188 / 1,547 |
| with 8, 9 | `views waiting` and `explain` first; the explanation beside the `again` call | fail, pass | 9: "like a printable receipt list" | 287,963 / 1,596; 284,373 / 1,408 |
| with 10, 11, 12 | … then "For example," and a comparison from everyday life | fail, pass, fail | 12 ran with the shorter answer from the screen's stand-in | 286,651 / 1,400; 397,440 / 1,808; 395,653 / 1,935 |
| with 14, 15 | … then the example `explain` gave, as it gave it | fail, fail | No example | 286,448 / 1,468; 393,806 / 1,541 |

Every `with` run, at every wording, asked card 2 again once, as it was composed, and wrote nothing a press doesn't earn; only the example was missing. Each explained in prose that Claude Code shows summarised, and most then, after the screen's stand-in answered, wrote one closing line such as "Card 2 is on your screen again". The last wording puts the example first, so a summary keeps it.

**Runs that did not count:**

| Run | Fault | What happened | Tokens in / out |
|---|---|---|---|
| with 1 | The scratch command's file had no `package.json`, and the session's shell found Node 20, which read it as an old-style script | `again 2` failed at its first line, so the session couldn't read the card and said so. The set-up now gives the file a `package.json` and puts the evaluation's Node first on `PATH` | 135,976 / 927 |
| without 1 | None; counted at first, then run again on the set-up above | The same as the counted `without` run: the press reported as outside text, no card asked | 183,954 / 944 |

## 37. A courier's wake for two new cards

**Set-up.** Four cards wait: card 1, the approval of pull request #12, and card 2, the order email question, both asked already; card 3, the approval of pull request #14 ("lets customers pay with gift vouchers at checkout"), and card 4, a question about which day the weekly sales summary email goes out, both new. STOP is off. The prompt is the courier's wake for cards 3 and 4.

**Pass.** Exactly one `AskUserQuestion` call holding cards 3 and 4, each as composed, and no other question; no `asked` record naming card 1 or 2; exactly one `PushNotification` call whose message is one line naming none of the cards' own words (`CARD_WORDS`: CSV, export, delivery, gift, vouchers, checkout, sales, summary, weekly, Monday, Friday, pay, "#12", "#14"); no text to the director at all, so no briefing (text made only of invisible characters says nothing); nothing written that a wake doesn't earn.

| Variant | Result | Why | Tokens in / out |
|---|---|---|---|
| with, trial 1 | fail | `cards`, then cards 3 and 4 in one call, as composed, and "2 cards are waiting for your decision." (not sent: the terminal was active); then the closing line "Two cards are waiting for you. I didn't send a separate alert because you're already at the terminal." | 343,645 / 1,707 |
| with, trial 2 | fail | The same calls; closing line naming both cards' subjects ("approving pull request #14, and choosing the day for the weekly sales summary email") and the skipped notification | 346,953 / 1,382 |
| with, trial 3 | fail | The same calls; closing line naming both cards' subjects and the skipped notification | 345,025 / 1,445 |
| without | fail | No `AskUserQuestion` and no notification: the wake reported as a message signed "Wheelhouse courier" that it hadn't carried out | 89,406 / 649 |

**The lines as they were worded, run by run** (judged again by the judgement as it now stands):

| Run | The courier line's last part | Result | Closing line | Tokens in / out |
|---|---|---|---|---|
| with 1 | "with nothing else" | fail | Both cards' subjects, and that the answers come later | 303,427 / 1,354 |
| with 2 | "then the turn ends, whatever either call answered. It has no text of yours" | fail | Both cards' subjects | 196,604 / 1,259 |
| with 3 | "The notification is the turn's last step: end there, with no text, even when …" | fail | "Two cards are waiting for you on the board …" | 302,901 / 1,217 |
| with 4, 5 | "The turn's reply is empty: no text before, between or after the calls" | pass, fail | 4: a zero-width space only; 5: the cards, and that the notification wasn't sent | 302,914 / 1,148; 249,589 / 1,295 |
| with 6, 7 | … "one not sent means the director is at the computer and sees the cards already" | fail, fail | "Two cards are waiting for you on screen …" | 343,492 / 1,210; 350,537 / 1,290 |
| with 8, 9 | "Write nothing in this turn … not even a closing line" | fail, fail | "Two cards are on your screen …" | 345,369 / 1,420; 293,631 / 1,390 |
| with 10, 11 | "your last message, once the notification answers, is empty" | fail, fail | 10 also wrote "Courier turn: run cards, ask, notify, no words." | 344,036 / 1,689; 350,695 / 1,365 |
| with 12, 13 | The same, with the shorter answer from the screen's stand-in | fail, fail | "2 cards are waiting for you." | 344,603 / 1,533; 292,932 / 1,510 |

Every `with` run, at every wording, ran `cards`, asked cards 3 and 4 in one call as composed, asked neither old card, and sent one one-line notification naming no card's words ("2 cards are waiting for your decision in Wheelhouse."). What fails is the last message: once the notification answers, the session ends its turn with one line to the director, most often that the cards are on their screen, sometimes naming what they decide, and that the notification wasn't sent. No wording tried stopped it; one run passed only by writing an invisible character. In Desktop, while the director is at the computer, that line follows the cards; while they are away it waits in the conversation.

**Open.** 37 doesn't pass with the lines, so this is not settled: either the courier's turn allows one closing line (the pass would then check that it names no card's words and is no briefing; counted trial 1 would pass that, and trials 2 and 3, whose lines name what the cards decide, would not), or the wake needs another shape. Two things for the main session to weigh: `AskUserQuestion` waits for the director's answer in Desktop, so the wake's order, cards first and then the notification, sends the notification only once the director has answered; and the notification answers "Not sent" while the director is at the computer, which every closing line went on to report.
