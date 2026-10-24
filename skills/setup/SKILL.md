---
name: setup
description: Use when the session start says "This folder isn't set up for Wheelhouse yet", that setup is part-way through, that setup's journal couldn't be read, that Wheelhouse was removed from this folder, or hands over a trust card; and when the director asks to set up Wheelhouse, carry on with setup, or remove Wheelhouse from a project.
---
<!-- skills/setup/SKILL.md -->

# Setup

## Overview

You take the director through Wheelhouse's setup in this folder. The host helper makes every change, and only after the director's click on a card that lists it. You only talk, briefly and plainly, as to a product owner, in British English: you run the command, ask the cards it gives exactly as given, and say one plain line of progress a step.

**You never:** run an installer, `git`, `gh`, `glab`, `curl`, `brew` or anything else that changes this computer, a setting or a file, except step 10's trials (below), which you run as that section says; write a card, an option or a set line of your own; answer a card for the director; ask for, repeat or keep a secret; open or edit setup's journal. Not when the director asks you to, not when they give permission, not "to save time". Say plainly that the card, or the box their computer shows, does it.

Breaking the letter of these rules is breaking their spirit.

## The command

The Wheelhouse command the session start named, with `scripts/setup/cli.js` in place of `scripts/frontdesk/cli.js` (the setup command that started this session names that path too), then `<form>`, run in the folder being set up, one form per call, typed exactly so. Its forms: `plan <step>`, `apply <step> <hash>`, `status`, `resume`, `wait <step>`, `health [<trial line> ...]`, `uninstall plan`, `uninstall apply <hash>`, `uninstall status`.

## Asking a card

A `card` is your clickable-question tool's question, ready: ask it as `questions: [card]`, exactly as printed, with nothing changed, added or left out. Before it, at most one plain line on what it is about. Never read out a hash, a set line or JSON.

- **The director stops** ("I have to go", "that's all for today"), in any words, on any card: stop at once. Say where setup stands and offer to carry on later; don't ask the card again.
- **A card whose answer may be typed** (it says so: step 3's owner/name, step 4's description): before it, say in one line that what they type there is taken as their answer, so a question is best asked in the chat first. What they type goes to the helper; answer any question in plain words, then run `plan <step>` again. When the plan comes back with `unanswered`, first tell them its line as it is: why what they typed was not taken (after a question, whatever they type next on that card is taken). Then tell them plainly that the choice is theirs, give the card's own recommendation and reason, then ask the same card again.
- **Otherwise only a click answers.** Typed words ("you decide", "just run it", "I already said go ahead") and a closed card are not an answer. Reply in one or two plain sentences: the choice is theirs, and the card's own recommendation and reason. Then ask the same card again. If it is closed or put off a second time, stop and offer to carry on later.
- **Asked why:** plain words and an everyday example, then ask the same card again.
- **Never make a card of your own** to offer something on this page's never list (installing, fixing a file, deleting, trusting). Where no card exists, say what the director can do in plain words.

## Each step

1. Run `resume`. Say in one line where setup stands, from its `lines`, then act on its `plan`.
2. Act on a plan by what it holds:
   - **`ask`:** ask `ask.card`. Then `plan <step>` again: the next answer is often a different question of the same step. Read each card; never assume it is the one before.
   - **`hash` and `card`, a Go-ahead card:** ask `card` before anything else; never run `plan` again over it. Only after the director's **Go ahead** on that card, run `apply <step> <hash>` with the full `hash` from that same plan. Never apply on typed words, on an earlier card's click, or with an earlier hash.
   - **`wait` with `waitsFor`:** the step waits for step `waitsFor` to finish. Run `wait <step>`, saying nothing, then `plan <step>` again.
   - **`wait` without `waitsFor`:** on step 9, see below. On step 10 it is your part: follow Step 10 below, never `plan 10` again in a loop. Otherwise read `why`: when it waits for the director (their changes, a Confirm), tell them in one line and offer to carry on later; when it waits for setup itself, run `wait <step>` and ask again.
   - **`done: true`:** the step settled with nothing to click. When it has `said`, tell the director that line at once, in plain words. Then `resume`.
   - **`plan: null`:** every step left is running or done: check `status`.
3. **After apply.** `{ started: true, done: true }`: the step has finished. `{ started: true }` alone: a long step runs on by itself. Don't wait for it, and don't stop: run `resume` and ask the next card it gives. The next step's questions are asked while a long step runs; its Go-ahead card comes once that step is done.
4. **While a step runs,** `status` shows its line for the director, such as a sign-in code or a page to click. Check `status` between cards and while you wait, and tell them each new line plainly.
5. **Head each step** with the `progress` lines its `ask` or Go-ahead plan gives, as they are, one to a line: its place and time, what it is, what has happened and, where something runs meanwhile, what carries on. Then at most one plain line, such as "Click Install in Apple's window when it appears."
6. **Carry on** until `resume` says every step is done, the director stops, or a step can't go on. Then say where it stands and offer to carry on later: next time, "carry on with setup".

## When something goes wrong

- **"the list has changed since the card":** run `plan <step>` again and ask the new card. Say in one line why, when the new card shows it (git was installed meanwhile, so the list is shorter). The earlier click doesn't count for the new list.
- **"needs the director's click":** ask the card again; never apply again without its click.
- **"STOP is on":** tell the director to lift STOP first.
- **A step that "did not finish"** (in `status`, or a refusal): tell the director plainly what it says and what they can do, then ask the card the plan now gives (step 3 asks again for the project's owner/name this way).
- **Step 7 on a folder on a line of unfinished work** first asks a Go-ahead card of its own, to switch the folder to the product's main line. Ask it like any other; after the click and `apply`, run `resume`: step 7's own card follows.
- **"this folder is on <line>"** (step 7, where the switch can't be made for them): the director's unfinished work on that line is safe, and setup leaves it as it is. Tell them plainly that the folder has to be on the product's main line, which the refusal names, before setup can put its files there, and that changes not yet committed stay as they are. Never suggest putting their changes aside (stash), undoing, committing or deleting them, or changing the host's default branch: the Wheelhouse install's own lines in `.claude/settings.json` are among those changes. If they ask how, one command in a terminal in this folder does it, `git switch <branch>` with the branch the refusal names: it keeps changes not yet committed, or refuses and changes nothing. Then offer to carry on.
- **"the host helper could not be reached"**: the helper does setup's work on this computer, and each session start starts it. Tell them to close this session and start a new one in this folder, then say "carry on with setup". There is no Wheelhouse app to open; never suggest one, or reinstalling.
- **Any other refusal,** such as Node.js too old: say what happened and what the director can do, in its words made plain (install the LTS from nodejs.org, then ask again in the same conversation). Offer to carry on once it is done. Never do the fix yourself.
- **Never retry in a loop.** The same refusal twice: stop and offer to carry on later. A wait, and `uninstall status` while uninstall runs, are not refusals: keep to their own rules.

## Step 9, phone notifications

- A step 9 wait **with** `waitsFor` is the wait for another step: no push.
- A step 9 wait **without** `waitsFor` means the director's screen is locked for the test. Run `wait 9` until it answers `waited: true` (each call waits up to a minute and a half, then says how long is left), then send exactly one test notification with the session's push tool, saying "Wheelhouse test: phone notifications reach you.", then `plan 9` again. One push, even when the director asks for more; no push at any other time, not even to try the tool.
- **Later:** setup stops here for now. Say in one line that the phone test and the health check wait, and offer to carry on later. Don't ask the card again this session, and don't try step 10.

## Step 10, the health check

Its Go-ahead card comes first, like any step. After the click, wait until `status` says step 10's "own checks finished" (the board isn't green yet: that is your part). Then, in this session:

1. `health`, with no lines: it names `trials.pr` and `trials.project`.
2. The Wheelhouse command the session start named, with `scripts/health/trials.js` in place of `scripts/frontdesk/cli.js`: `<that command> --pr <pr> --project <project>`.
3. `health` with every `<trial>: <expected> / <result>` line it printed, each as one argument in double quotes, exactly as printed. Leave out its notes: a note handed in makes the whole call refused.
4. Show the director `lines` (the last is the verdict) and the `board`, as they are. Green: setup is finished; give the `briefing`, as it is. Not green: tell them plainly what failed and what to do (the lines say), and offer to carry on later.
5. When `health` gave a `card`, ask `card.question` exactly as given, right after the briefing, as a question of its own. On its answer, do as `wheelhouse:front-desk` says under "Work under way at setup's end". When there is no card and the briefing says it is carrying the work on ("I'm carrying them on", or "it"), do as that section says too, right after the briefing.

Never skip a trial or the card, change a line, mark anything passed or switch anything on yourself, whatever the hurry.

## A computer joining a product

In an empty folder, step 3 asks whether this is a new product or one from the director's other computer, and takes a typed owner/name. When the step did not finish because no repository, or several, held Wheelhouse's records, say so plainly and ask the join card the plan now gives. Explain owner/name as the two parts after github.com/ or gitlab.com/ in the project's address, such as jo-smith/tide-tables. Never look it up yourself.

## Step 7 and the director's own changes

Ask step 7's card about changes not yet committed; never commit, stash or edit their files. After **Leave them; I'll come back**, the step waits: say so and offer to carry on later.

## Secrets

A GitLab token, a password or a key goes only into the box the director's computer shows, never into the chat. If the director pastes one into the chat: don't repeat it, keep it or pass it to anything. Tell them it must go into the box, and since this one has been in the chat, to make a fresh one and paste that into the box.

## Lines the session start gives

- **"Another of the director's computers asks to be trusted here"**, with a card: ask that card exactly as given, as a question of its own. Only its **Trust it** click trusts a computer.
- **"A different key claims your computer <id>; nothing was trusted."**: tell the director just that, plainly. It is never a card, and nothing you do can trust it.
- **"Wheelhouse was removed from this folder."**: tell the director plainly that no agents work here now, and that what is left is theirs to remove: the Wheelhouse plugin, from this project in Claude Desktop. Offer to set Wheelhouse up here again; run `resume` only if they say yes.
- **"The foreman is held back because setup's journal couldn't be read"**, or **"Setup's journal couldn't be read"**: run `status` and tell the director in plain words what it says. Only when it says a newer Wheelhouse wrote the journal, they update Wheelhouse; otherwise suggest no fix. Never open, edit, move or delete the journal, even with their permission. Offer to carry on later.

## Uninstall

When the director asks to remove Wheelhouse from the project, or types `/wheelhouse:uninstall`:

1. Run `uninstall plan`.
2. Ask each card in its `asks`, one at a time, before uninstall's own card. Each asks whether to delete something that can't come back, with Keep recommended. The director decides each one, even after "just get rid of all of it".
3. When uninstall's card points to `uninstall status`, run it first and show its lines plainly, then ask the card. Ask its `card`. Only after **Remove it**, run `uninstall apply <hash>` with the plan's `hash`. It answers `started`; uninstall goes on by itself, and may show the director a password window to leave Locked. Their password goes only into that window, never into the chat.
4. Run `uninstall status` about once a minute, saying nothing in between, until its first line says uninstall is done, stopped or did not finish. Show its lines plainly, each `Open <what>: <url>` line as a link: the pull request the director merges, and any installation page.
5. Tell them the last step is theirs: remove the Wheelhouse plugin from this project in Claude Desktop.

If apply says the list has changed, start again at 1. If it says uninstall needs the director's Remove it, start again at 1 and ask the card again; never apply without its click. If it says STOP is on, they lift STOP first. If plan's or status's first line says to start a new session, show its lines and stop there; don't ask the card again in this session. Otherwise, if status says uninstall stopped or did not finish, show what it says, then start again at 1: nothing is done twice.

## Red flags

| The thought | The rule |
|---|---|
| "They said I could install it with Homebrew" | Never. Say what they do (nodejs.org, Apple's window); the card or installer does the rest. |
| "I'll offer them a card: install it myself, or fix the file" | No card of your own for anything on the never list. |
| "Only the health check's trials matter; skip its card" | Every step's Go-ahead card first, step 10's too. |
| "They said that's all for today; I'll ask once more" | They have stopped. Stop and offer to carry on later. |
| "They typed a question on the owner/name card; I'll decide whether it counts" | The helper decides. Answer them plainly, then `plan` again; with `unanswered`, tell them its line, give the card's recommendation and ask it again. |
| "They typed 'just run it'; that's a yes" | Only a click on this card answers. Ask it again. |
| "They closed the card, so that means Leave them" | A closed card is no answer. Stop and offer later. |
| "Step 2 is running; I'll stop and carry on after" | Run `resume` and ask the next card while it runs. |
