<!-- docs/specs/notes/2026-11-26-desktop-builder-start.md -->
# How builders start on the Desktop route: options after check 97

Written on 26 November 2026. It follows the findings of check 97 (`docs/specs/notes/2026-11-24-desktop-probe.md`) and the assessment of them against parts 1–8 of the builders design (`docs/specs/2026-11-24-builders-and-user-settings-design.md`). Nothing here is decided: the options go to the director as a card, and the recommendation is only a recommendation.

## 1. The problem in plain words

The design has the foreman ask Desktop to offer each new builder, and the director presses one **Start all** per batch (sections 7.3 and 14, decision 16.1). Check 97 showed that this can't happen as designed:

- Desktop shows a **Start** card only in a turn the director typed at the composer. The foreman's turns are started by its background wait command or by a builder's finish notice, never by the director, so every offer it makes is refused: "No card was shown: this turn's request did not come from someone at this app's composer, so there is nobody to ask."
- Even in a typed turn, each offer must be the only call in its message, so there is no **Start all**: one card per builder. Check 97 took 4 typed messages and 3 clicks for 3 sessions.
- An offer can't name the folder. The builder opens in the starter's folder, and the worktree is a switch on the card that the director, not Wheelhouse, controls.

So, as built, no builder on the Desktop route can start without the director typing something. The question is what the director types or clicks, where, and how often.

What did work: nesting under the starter is automatic; the starter is woken when a builder ends its turn without `wake_when_done`; and `send_message` works in turns the director didn't type (all three probe sessions messaged the starter from turns Desktop started).

## 2. The options

Counts are per batch of N new builders. A batch is every piece waiting to start at the moment the director acts, so pieces that become ready while the director is away join one batch. Wakes of builders already running need nothing from the director in any option: `send_message` works in any turn.

### Option A. The First Mate starts builders while the director is talking to it

When pieces are waiting, the First Mate's next reply to the director carries a Wheelhouse card: "3 builders are ready: <titles>. Start them?" with **Start them** and **Not now**. A click on **Start them** is the director asking in words, so the First Mate starts each one with `initiation: user_asked`, the same ground section 7.1 already uses for "Start the foreman".

- **The director, per batch:** 1 click, but only when they next talk to the First Mate. If they aren't talking to it, the batch waits; to start it they open the First Mate and type something (1 message, 1 click).
- **If `user_asked` turns out to be card-only too** (unprobed): N Desktop **Start** cards, so N clicks, plus the card click.
- **Design changes:** 7.1 and 7.3 (the First Mate starts builders, not the foreman), 7.4 and 16.1 (builders nest under the First Mate's row, not the foreman's: a departure from the director's nesting requirement), 14 (the table row), 4 (findings).
- **Code changes:** the front desk skill (`skills/front-desk/SKILL.md`) gains the card and the start step; the First Mate's session-start facts gain "Builders waiting: N". `act start` stays the foreman's, so the First Mate needs its own way to read the pending offers (a new `act waiting` read through the helper, or a read-only script). `scripts/foreman/desktop-start.js` sets `user_asked` and `cwd`. The foreman keeps waking running builders.
- **Risks:** builders wait for as long as the director is away from the First Mate, which is the opposite of "not involved". The First Mate starts sessions, which mixes the front desk's job with the foreman's. Builders nest under a row that isn't the foreman's.
- **Still to probe:** whether `user_asked` with several calls in one turn starts every session at once with no card; whether `cwd` is honoured on `user_asked`; whether a session started that way nests.

### Option B. The director types "go" in the foreman's row (recommended)

When the foreman takes a `feature-start` wake, it prepares the piece as now but doesn't offer it. It ends its turn with one plain line: "3 builders are ready: <titles>. Type go here to start them." The First Mate's facts and, if phone notices are on, one phone notice say the same. When the director types **go** in the foreman's row, that turn came from the composer and the director asked in words, so the foreman starts every waiting piece with `initiation: user_asked`, each call in its own message, with `cwd` set to a worktree Wheelhouse made itself, as on the background route.

- **The director, per batch:** open the foreman's row (1 click in the sidebar, none if it is already open) and type one word. No card clicks. If `user_asked` turns out to be refused or card-only in that turn, the fallback is offers in the same typed turn: 1 word and N **Start** clicks (still better than check 97, if several offers one after another in one typed turn all show; see the probe).
- **Design changes:** 7.3 (start on "go", `user_asked`, `cwd` to Wheelhouse's own worktree; adoption dropped for new starts), 7.5 (a resume is a "go" start with the piece's same worktree as `cwd`, so it works as the design wants), 14 (the row becomes "type go in the foreman's row, once per batch"), 16.1 (one typed word per batch in place of one **Start all** click: a departure the director must accept), 4 (findings). Nesting under the foreman stays as the director asked, if `user_asked` starts nest as offers do.
- **Code changes:**
  - `skills/foreman/SKILL.md` "On the Desktop route": steps 3–5 become "in a wake turn, prepare and say the go line; in a turn the director typed, start every waiting piece". Step 4's `start_session` arguments change. "When Desktop was closed" step 2 uses the same go.
  - `scripts/foreman/act.js`: `start` on the Desktop route makes Wheelhouse's own worktree (the background route's code) and keeps the brief pending; a new `act waiting` prints one `Desktop start: <json>` per waiting piece, and the go line; `builder-started <work> --session <local_ id>` records the session id `start_session` gave back.
  - `scripts/foreman/desktop-start.js`: `initiation: user_asked`, `cwd` always, no `wakeWhenDone`, no `nest`.
  - `scripts/foreman/desktop-findings.js`: a finding for the start route (for example `start: 'go'`), so the fallback to offers is one value.
  - `scripts/foreman/adopt.js`: no longer needed for new starts; kept only if the fallback to offers is in force.
  - The First Mate's facts and the phone notice (`scripts/watcher/foreman-away.js`, `scripts/watcher/waker.js`): "Builders waiting: N · type go in the Foreman row".
- **Risks:**
  - "Type go" is a plain line, not a clickable card. The foreman can't show a card in a wake turn (the same refusal likely covers question cards; see the probe). It is a small departure from "each question offers clickable options".
  - The director has to notice the line. The First Mate's facts, the foreman row's own finished-turn mark in the sidebar, and the phone notice carry it.
  - Desktop's own guidance for `user_asked` is a judgement of the session. A one-word "go" in reply to a line naming the pieces is the director asking in words; Wheelhouse still never claims `user_asked` for a start the director didn't type.
- **Still to probe:** see section 5. In short: `user_asked` in a typed turn starts at once with no card; `cwd` to a Wheelhouse worktree is honoured; several starts in one typed turn (each in its own message) all go; the sessions nest under the starter; Wheelhouse's plugin and project hooks load in them.

### Option C. Start builders without Desktop cards: `claude --desktop`

The watcher, or the foreman's background command, runs `claude --desktop` with the builder's prompt in the worktree, as the background route runs `claude -p` today. If that opens a Desktop session with the prompt sent and no click, nothing is asked of the director at all.

- **The director, per batch:** none, if it works as hoped. If it only fills the prompt box (as deep links do), N sends, which is worse than A or B.
- **Design changes:** 5 D already names this as a later choice for the waker. 7.2 and 7.3 (the waker or foreman runs the command instead of offering), 7.4 (rows are probably top-level, not nested under the foreman: titles carry the project), 16.1.
- **Code changes:** the Claude Code adapter's start functions gain a `desktop-cli` start; the route record gains a value; the foreman's start step becomes a background command.
- **Risks:** the least known. It may bring Desktop to the front or open a window on every start, which the director has ruled out firmly (no pop-up windows). It may not send the prompt. Rows are unlikely to nest under the foreman. Its sign-in may be the CLI's, not Desktop's, which is the failure the Desktop route exists to avoid on the work laptop.
- **Still to probe:** whether it starts a session with the prompt sent and no click; whether Desktop comes to the front or opens a window; which folder it opens in; whose sign-in it uses; where the row shows.

### Option D. Builders start in the background, as before

Keep the Desktop route for nothing, or drop it, and use the background route (with the launch command on the work laptop). This is built and runs today.

- **The director, per batch:** none.
- **Visibility:** builders are not sidebar rows; the director sees them through the First Mate's Builders line, the board and the Logbook. Taking the helm in a builder's own row is not possible.
- **Design changes:** none, except that the Desktop route becomes parked or a choice nobody picks. The director asked for builders nested under the foreman in Desktop, so this goes against that wish.
- **Risks:** on the work laptop, it works only if the launch command's sign-in works for background runs (part 4's check says so per computer).
- **Still to probe:** nothing new on the Mac; on the work laptop, part 9's trial with the wrapper.

## 3. Recommendation: option B

- It keeps what the director asked for: builders as Desktop rows nested under the foreman, with the native way to watch or take the helm.
- It needs the least of the director that Desktop allows: one word per batch, and no clicks once they are in the foreman's row. Batches coalesce while they are away, so one word can start everything waiting.
- It is honest about Desktop's rule: the start comes from a turn the director typed, asking in words.
- It is simpler than the built code: with `cwd` allowed on `user_asked`, Wheelhouse makes its own worktree as on the background route, adoption and the "worktree turned off on the card" gap go away, and a resume after Desktop was closed works as section 7.5 wants.
- Its fallback inside the same design (offers in the typed turn) needs no new route: one word and N clicks.

Option C would need nothing of the director, but it is unproven and may raise Desktop or a window on every start. The probe below tries it at no extra cost to the director; if it starts silently, with the prompt sent and the window left alone, it goes to the director as a later choice. Option D stays the route for terminals and for any computer where the director doesn't want the go.

## 4. Follow-ups within the design, needed whichever option wins

These come from the assessment of check 97 (items 3 gap 1, 4, 5 and 6). None needs the director.

1. **Worktree turned off on the card** (item 3, gap 1). While offers are in force (options A and B's fallback), the builder prompt from `builderStart` opens with the folder check the resume prompt already has: if the folder isn't a linked worktree of the project, change nothing and end the turn saying so. The foreman then says the piece waits for a restart with the worktree on. Under option B's `user_asked` with `cwd`, the check stays as a guard.
2. **Drop `wake_when_done`** (item 4). Desktop refuses it after an offer and wakes the starter anyway. Remove `wakeWhenDone: true` from `scripts/foreman/desktop-start.js` and "`wake_when_done: true`" from step 4 of the foreman skill.
3. **Message builders by their `local_` id** (item 5). The id `adopt.js` records is the transcript id, and a message to it gets "session not found". The foreman records the `local_` id that `start_session` or `list_sessions` gives it (`act builder-started <work> --session local_…`), and `SESSION_ID` in `scripts/foreman/desktop-builders.js`, `scripts/foreman/wait-wake.js`, `scripts/foreman/check-in.js`, `scripts/foreman/helm-hold.js` and act's `--foreman-session` allows `_`. The transcript id stays for the hook's own use. A builder's brief names its starter as "the session that started you", never by an id.
4. **Nesting is automatic** (item 6). `scripts/foreman/desktop-findings.js` records `nesting: { automatic: true, how: null }`, `builderTitle` uses the nested form (no project in the title) and passes no `nest`. Step 4's "when the json has a `nest` object" can stay as written.

Still untried from check 97, and wanted whichever option wins: `quitAndReopen` (what Desktop does with builder rows after a quit), the sidebar itself (seen, not only `list_sessions`), and whether Wheelhouse's prompt hook and project hooks run in a Desktop builder on a computer where Wheelhouse is enabled in Desktop.

## 5. Probe plan for option B

An agent runs this on a Desktop computer (the Mac, or the computer check 97 used) where Wheelhouse is enabled in Claude Desktop. It follows check 97's pattern (`probes/97-desktop-builders/`): a script prepares a scratch git project, a probe session does the calls, and the findings go to `docs/specs/notes/`. The director's part is three actions at most, all in chat, no windows: start the probe session (1 click on the First Mate's card), type **go** once in it, and answer one closing card.

**Prepare (agent, no director).** Make a scratch git repository with one commit and two linked worktrees under `<scratch>/.claude/worktrees/probe-a` and `probe-b`. Write a probe brief that names both. Record Desktop's session list before.

**Step 1. `user_asked` in a typed turn (needs the director's "go").** The probe session's line says: "Type go to start two probe sessions." When the director types **go**, the probe session, in that one turn:

1. calls `start_session` with `initiation: user_asked`, `cwd` = `probe-a`, worktree off, Auto, title "Probe · go a", prompt "Report your folder, branch, entrypoint, whether Wheelhouse's skills are listed and whether the project's SessionStart hook ran, to the session that started you", as the only call in its message;
2. then, in its next message, the same for `probe-b`;
3. then one message with two `user_asked` calls together (titles "Probe · pair 1" and "Probe · pair 2", `cwd` = `probe-a`), to learn whether the one-call rule applies to `user_asked` too.

It records, for each: started at once or a card shown or refused (exact words); `cwd` honoured; nested under the starter (Desktop's session record `spawnedFrom`, and `list_sessions` linked); the reported folder, branch, entrypoint, plugin load and project hook. Expected for B: 1 and 2 start at once in their worktrees, nested.

**Step 2. Offers one after another in the same typed turn (no extra director action).** Still in the go turn, the probe session calls two offers, each in its own message, titles "Probe · offer 1" and "Probe · offer 2", in the scratch project. It records whether both cards show. The director is not asked to press them; the closing card asks whether they saw two cards. This settles option B's fallback count (1 word and N clicks).

**Step 3. A turn the director didn't type (no director action unless a card shows).** The probe session starts a 20-second background command. In the turn its end starts, it tries, in order: `start_session` with `user_asked` (expected refused); a Wheelhouse question card with **Start** and **Skip**. If the card shows and the director clicks **Start**, it tries `start_session` `user_asked` once more and records the answer. This tells whether the foreman could ask with a clickable card in its wake turn, which would turn B's typed word into one click.

**Step 4. `claude --desktop` (no director action).** From a background command in the scratch project's `probe-b` worktree, run `claude --desktop "Probe: report your folder and sign-in to the session that started you"`, unsandboxed only for this command. The agent records: whether a new session shows in `list_sessions` and whether its prompt was sent; its folder; where its row sits (nested or top-level). The closing card asks the director whether Desktop came to the front or a new window opened.

**Step 5. Quit and reopen (optional, only if the director is free; 2 actions).** The closing card offers it: quit Desktop, reopen it, and say go in the probe session again. The probe session records whether the probe rows came back and whether `send_message` to them works. Without it, section 7.5 keeps relying on the folder check and the go resume.

**Close (1 director click).** One card: "Did you see two Start cards? Did Desktop jump to the front or open a window when the last probe started? Shall we try a quit and reopen?" Then the agent writes `docs/specs/notes/<date>-desktop-go-probe.md` with each finding, archives the probe sessions with `archive_session`, and removes the scratch worktrees by their literal paths.
