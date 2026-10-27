<!-- docs/evals/setup-rehearsal-2026-10-27.md -->

# Rehearsal: setup at main before v0.1.2

A timed practice run of setup at main (`59c6a97b`), before v0.1.2 is tagged. It took three paths, as close to the director's own as can be run without their accounts:

1. a new, empty product folder, whose first message is a product request;
2. a project already under way, checked out on a line of unfinished work with changes not yet committed;
3. a run that v0.1.1 parked at its phone card (step 9, **Later**), carried on after the update. This is the director's own situation in their project.

**Run on** 27 October 2026, on macOS, with Claude Code 2.1.302.

## How it was run

- **Install.** The README's two commands ran in an empty folder with a scratch `CLAUDE_CONFIG_DIR`, from a copy of main as a local marketplace: `claude plugin marketplace add "<copy of main>" --scope project`, then `claude plugin install wheelhouse@wheelhouse --scope project`. Both worked, and each took about a second (7 seconds once, with the computer busy). Fetching from GitHub at a tag wasn't timed.
- **The session.** Each was a real `claude -p` session on Sonnet, in stream-json both ways, with `--permission-prompt-tool stdio`. It loaded the plugin from the copy the install commands left in the scratch Claude Code folder. A scratch `CLAUDE_CONFIG_DIR` has no sign-in ("Not logged in"), so the session used this Mac's own sign-in, with the evaluation harness's isolation:
  - project and local settings only, and no MCP servers;
  - the harness's denied tools;
  - reads of the director's own places denied.
  Nothing was written to the real `~/.claude` or `~/.wheelhouse`. A permission host answered each card as the director would (Go ahead; **Skip for now** on the phone; the recommendation otherwise), let through only the Wheelhouse command, and refused any other command.
- **The world.** This was setup's end-to-end world (`tests/helpers/setup-e2e.js`): a real helper on a socket in a scratch Wheelhouse home, setup's real steps, a stand-in GitHub of bare repositories, and stand-ins for `gh`, `claude` and the rest on the PATH. Nothing was made on the real GitHub. The installs (gh, the kits), the sign-in and the host's protection are stood in, so steps 2, 3 and 7 are faster here than on a real computer.
- **Path 3's parking** used v0.1.1's own code: its e2e world and its setup, through step 8, then **Later** on its phone card. Main's helper and a main session then carried on over the same home and folder.
- **The rig** is `probes/19-setup-time/rehearsal.js`, with `rehearsal-keys-hook.js`.

What a headless run can't show:
- Claude Desktop's own screens, and its trust dialog;
- the real phone (the push tool is turned away);
- the GitHub sign-in;
- the time a director spends reading, which the permission host doesn't spend.

The time a director spends reading is what makes the real run longer than these.

## Timings

The time runs from the session's first message to the first briefing the director sees, against the design's 6-minute target (section 15.1). The final runs are on this pull request's code.

| Path | Health check green | First briefing seen | Front desk takes the request | Cards | Card words |
|---|---|---|---|---|---|
| 1. New product, product request first | 75 s | 83 s (on the phone card) | 91 s | 2 | 396 |
| 2. Project under way | 132 s | 144 s (on the phone card) | 148 s (the carry-on card) | 5 | 817 |
| 3. Parked by v0.1.1, updated | about 60 s | 58 s (on the phone card) | none asked | 2 | 343 |

At main as it stood, the board went green at about 80 s, 101 s and 34 s. The director never saw a briefing on any path (finding 1).

The cards in the final runs:

- **Path 1:** the one card (123 words), and the phone card opening with the verdict and briefing (273).
- **Path 2:**
  - the one card (148);
  - step 7's switch off `ingredient-units` (126);
  - the phone card with the briefing (256);
  - the carry-on card for the unfinished work (131);
  - the front desk's approval of that work (156).
- **Path 3:** the one card, now naming only the health check (65; 55 at main, with an empty list), and the phone card with the briefing (278).

Every card was answered with no typed words, and none was asked twice. Setup asked no question of its own beyond the one card, apart from path 2's switch.

## Findings

### 1. The director never saw the first briefing (HIGH, fixed)

On all three paths at main, `health` answered green with the verdict, the board and the first briefing. The session then went straight to the phone card, the carry-on card or the front desk. The director saw no verdict, no board and no briefing. In path 2 its last message summed up "all 12 health checks passed", with no briefing. The design's target is measured to that first briefing.

Two fixes in words didn't hold:
- A `show` field holding the verdict and briefing, with the playbook saying to show it first: missed in 1 of 1 runs.
- The same text as step 10's `said` from `resume`, which the session passes on for other steps: missed in 2 of 2 runs on Sonnet and 1 of 1 on Opus. The session read it, summed it up in its own thinking, and moved on.

**Fixed** (`scripts/setup/engine.js`): the phone's first card opens with the verdict and the first briefing whenever it is planned, until the director answers it. A session asks a card word for word, so the director sees them. The card recorded is the one sent, so the click counts as usual. With no phone card left, step 10's plan gives them once as its `said`. The playbook says to run `resume` at once after green, and to show the board only when asked. In the final runs all three paths showed the briefing.

### 2. A run parked by v0.1.1 got an empty one card (HIGH, fixed)

After the update, the parked run's one card read "Set up Wheelhouse for Tides? Here's what I recommend. It takes about 5 minutes." It listed nothing, and only the health check was left. **Fixed** (`scripts/setup/choices.js`): with only the health check left and nothing to choose, the card reads "Finish setting up Wheelhouse for Tides? Setup is nearly done. What's left takes about a minute:" and names the check. Its heading's time says the same. A card never shows an empty list.

### Not fixed here

3. **The phone card is long** (MEDIUM). It is 209 words on its own, and 256 to 278 with the briefing on top. Its **Ready** option reads as one run-on sentence: "…and then asks whether it arrived, because it takes a couple of minutes, and tells you now whether your phone hears from agents."
4. **The request's shaping may not load in the first session** (MEDIUM, to check in Desktop). In path 1 the front desk took the request at once (intake, then `superpowers:brainstorming`). The session then said the brainstorming skill "isn't available in this session… it probably needs a fresh session to load", and shaped the request itself instead. Here the kits are stood in, so this may be the rig. But step 7 installs the kits mid-session in real use too, so the director's first session may hit the same.
5. **A note from the trials reached the director** (MEDIUM). In one path 2 run, the trials noted that their `.env.local` couldn't be removed. The session told the director to check it was gone, but the health check removes it itself. The playbook could say that trial notes are for the session, not the director.
6. **The switch card's Show me** (LOW). Step 7's card for switching the folder off a line of unfinished work offers "Show me: I show you what it looks like", which says little for a switch.
7. **Progress lines** (LOW). The session says one line for nearly every step ("Step 6 of 10: changing this computer's Claude settings…"), about ten in all. They're harmless, and shorter than any card.

### Rig artefacts, not product findings

- **Permission prompts.** Paths 1 and 2 raised 17 permission prompts each. Step 2's allow rule names the helper's own copy of the plugin, and the session ran the installed copy at another path. In real use the paths are the same, and the earlier rehearsal saw 3 prompts, all before step 2.
- **The kits hold in path 3.** With the session on this Mac's own Claude Code folder, the kits that v0.1.1 installed in the world's folder weren't found, so path 3's plugin copy had an empty kit list. Main and v0.1.1 pin the same kits, so the director's update raises no hold.
- **The keys trial line.** It is taken as refused by the rig's own hook, as in the earlier rehearsal.
