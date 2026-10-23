<!-- probes/mac-sitting/run.md -->

# The third Mac sitting: the agent's run sheet

For the agent running the sitting. The director follows `mac-sitting-3.md` (in the main session's notes folder) on screen and never sees this sheet. It covers, in order: Calm in Desktop (check 42), the fixes from the second mod sitting (check 41), the keychain probe (check 73) and the timed setup run (check 19, `probes/19-setup-time/run.md`).

The kit in this folder is the second sitting's, kept in the repository. It makes a scratch Wheelhouse project (its own home, a stand-in host with pull request 7, a real helper with `gh` and `glab` stood in for, and six waiting cards) and never writes in the repository or in `~/.wheelhouse`.

## Before the sitting (all of this has been dry-run)

```bash
S=/private/tmp/wheelhouse-sitting-3        # any folder that does not exist yet
node probes/mac-sitting/copy.mjs "$S" && cd "$S"
node prepare.mjs            # plugin copy at the checkout's HEAD, helper, project, cards
node ready.mjs              # helper answering, host facts, plugin copy
node check.mjs tick         # six cards, glance "Wheelhouse · 6 waiting · launch 3 of 5"
node check.mjs real-home    # nothing under "added"
node brief.mjs <your own local_ id>   # writes scratch-brief.txt, prints card 5's reply code
```

`check.mjs tick` also shows the approval card's Show me as a link (`-> https://example.com/`) and the launch figure for check 42. Press nothing in the scratch session before the director's go.

## Part 1: check 42, Calm in Desktop (about 18 minutes)

Done first, since the pane must be liked before real use. Start the scratch session (Part 2, step 1) and have the director enable it; then these steps. The steps are `docs/checks/42-calm-desktop.md`'s eleven; the director's list says what to look at and answer. The agent's part:
- Step 1 (`/wheelhouse`): nothing to do.
- Step 8 (the Suggest box) and step 10 (Settings): after each press, `node check.mjs records --since T` must show what the press should (a Send gives a prompt naming the card and records nothing; a pick records a signed confirmation; the pick of the value in force, the empty Send and a closed pop-up record nothing). `node check.mjs settings` shows the value in force.
- Step 9 (`$.prompt.fill`): the director types `/probe-fill`; the observer's command answers "probe-fill: filled" or says why not, and notes it (`node check.mjs observer`).
- Step 10's "no value in force": the director picks an away choice in Availability, then opens the row again. Undo puts it back.
- Step 11 (the phone): only the director can see it.
- Afterwards write each answer into `docs/checks/42-calm-desktop.md` as the director gives them.

## Part 2: the fixes from the second mod sitting (check 41, about 14 minutes)

1. `start_session` (initiation `user_asked`, `cwd` `<S>/project`, `use_worktree: false`, title "Wheelhouse test project", prompt = `scratch-brief.txt`). When it says "Ready.", `node link.mjs found --observer`. The director clicks **Enable for this session**; send the session one cue ("Next step.") once the notice is queued. `node check.mjs courier` shows it ticking; `node check.mjs hold` says `held: false`.
2. **A typed code and `stop` in a session another session started.** The director types `<code> Confirm`, then `stop`.
   - `node check.mjs wait record confirmation --since T`, then `records --since T`: signed, verifying, `confirms` = `made.json` `cards.check33Typed.setting`.
   - `node check.mjs wait stop on`: on. The Lift STOP card is asked; the director answers **Lift STOP**, or presses it in the pane.
3. **`/compact`, then a wrap-up and a notification.** Note `T`. The director types `/compact`.
   - `node check.mjs hold`: still `held: false` (a compaction writes no hold).
   - The brief's STEP 3 runs after the compaction (send "Next step: after compact" if it does not). `node check.mjs calls "wrap_up|PushNotification|ToolSearch" --since T`: one wrap-up with no error and one notification (`Mobile push requested.` or `Not sent …`), and `node check.mjs refused --since T` empty.
4. **The hold card leaves within a tick.** `node check.mjs make-hold` once (a hold and its event, as a session start makes them), then `node check.mjs tick --keep`: a card "The installed kits differ…" in the pane. With the hold on, a wrap-up and a notification still pass (`calls … --since T`). Then `rm home/projects/check41__scratch/lineage/hold.json` and `node check.mjs tick --keep` twice: the card is gone by the second tick (the first records the lift). The director watches the pane.
5. **`/wheelhouse-digest` with another plugin installed.** `enterprise-search` is installed on this Mac. The director types `/wheelhouse-digest`. `node check.mjs wait row "digest" --since T`: the command row, then Wheelhouse's briefing; `replies --since T`: no assistant reply after it; `node check.mjs seen`: `briefedAt` moved. If the app runs enterprise-search's own digest skill instead, the name still clashes: save the row.
6. **No certificate ERROR lines.** After any front desk command's output in the session: `node check.mjs certlines --since T` says `rowsWithCertificateErrors: 0`. Also `node check.mjs calls Bash --since T`: the command line carries `--no-use-system-ca`.
7. **The notice wording and the `received` lines.** When the session is idle, send `Wheelhouse: third sitting trial A` with `SendMessage`, and `Wheelhouse: third sitting trial B` with the app's `send_message` (the session's `local_…` id). The director reads what the chat shows. Expected: "Wheelhouse: an update from another session, shown in the pane", a blocked-prompt notice at most, never the line in the conversation.
   - `node check.mjs transcript - "trial A"` and `"trial B"`: no `user` row.
   - `node check.mjs received`: one line for each, with origin and via and no text.

## Part 3: check 73, the keychain (about 5 minutes)

`node probes/73-keychain/run.js` with no flag refuses and changes nothing (dry-run: done). With the director's yes, in their own Terminal or by the agent: `node probes/73-keychain/run.js --consent`. It must print `plain: read n characters`, `deny-scratch-folder: …`, `deny-real-keychains: read n characters`, `search-list: as it was` and `scratch folder: removed`. Then `security list-keychains -d user` must name only the login keychain. If the search list is not as it was: `security list-keychains -d user -s ~/Library/Keychains/login.keychain-db`. No password of the director's is asked.

## Part 4: check 19, the timed setup run (about 45 minutes, 15 to 25 of them timed)

`probes/19-setup-time/run.md` is the sheet. Blocks, found while preparing:
- **No tag on the host.** `git ls-remote --tags https://github.com/where-is-brett/wheelhouse v0.0.0-probe19` prints nothing. The main session pushes `v0.0.0-probe19` on the commit to be timed (the host's `main` was 881df9048ae9 when checked) and deletes it afterwards.
- **Check 37 has not been seen in Desktop** (does the pasted `/plugin install` line work?). The timed run is its first trial; if the line fails, stop there, keep the journal and write down what Desktop said.
- **`/usr/local/bin/node` is 20.9.0**, below the floor of 22: the throwaway user installs the LTS from nodejs.org during the run (a third password; it stays for every account).
- The throwaway user `wh19probe` does not exist yet, and neither do `wh19-trial` or `wheelhouse-profile` on `where-is-brett` (`run.js gone` says "wanted absent: yes" for both). `/Applications/Claude.app` is readable by every user.

## Tidy-up

`node undo.mjs` lists, `node undo.mjs --really` stops the helper and removes the scratch folder; add `--transcripts` only if the director agrees. Stop any `courier-watch`. Archive the test session. For check 19, `probes/19-setup-time/run.md` S6 to S10.
