<!-- docs/specs/2026-11-24-own-design-step-design.md -->

# The feature design step, on Superpowers brainstorming: design (24 November 2026)

**Status:** rewritten to the director's decisions of 24 November 2026 ("Yes use superpowers and fix this. keep to design we meticulously built."). Built on branch design/own-design-step (24 November 2026); the sitting renders come next.

The approved design (`docs/specs/2026-10-17-wheelhouse-design.md`, the feature route) shapes features with Superpowers brainstorming, and the core cut keeps Superpowers as the one process framework. This design keeps that and mends the faults within it. Wheelhouse has no design skill of its own.

## 1. The fault

At the rehearsal on the work laptop on 24 November 2026 (fault 19), the feature design step:

- ran on the director's own Superpowers plugin, which Wheelhouse doesn't give the First Mate in Copilot;
- asked the director no questions;
- ended on an approval card that said "the design you shaped" (the director shaped nothing), didn't show the design, said three times that nothing is built before the click, and showed a broken character in "Suggest a change…".

## 2. The causes

- **No questions.** `skills/front-desk/SKILL.md` says: "When you start `superpowers:brainstorming` and the request already answers its questions, skip brainstorming's questions and go on with what it says." The model judged the request answered them all. The Copilot First Mate (`adapters/copilot/first-mate/agents/wheelhouse-first-mate.agent.md`) is built from that playbook and carries the same line.
- **The director's own Superpowers.** In Claude Code, setup already installs the pinned Superpowers at project scope (`.claude-plugin/marketplace.json`, `scripts/setup/project-files.js`, step 7). In Copilot, only the background sessions get kept copies of its skills (`scripts/agents/copilot/kits.js`); the First Mate, in the director's own chat, gets none, so it ran on whatever the director had installed.
- **The card's words.** `approveWorkInput` in `scripts/frontdesk/cli.js`: `why` for a feature says "It is built from the design you shaped, so it starts only once you approve it"; `because` says "it is the design you shaped…"; `meanwhile`, every lane, says "Nothing is built until you approve"; and Approve's `says` ends "It only goes into your product when you say yes to that." The question, "Approve this work as written?", is `ASKS` in `scripts/cards/compose.js`.
- **No design shown.** Nothing puts the design in front of the director before the card. Show me on this card runs `preview <n>`, which is for pull requests, so it has nothing behind it.
- **The broken "…".** `SUGGEST` in `scripts/lib/calm-words.js` ends with U+2026. The front desk prints its JSON as UTF-8 (`scripts/frontdesk/cli.js`, `json`). The likely cause is the Windows shell reading that output in the old console code page, so the three bytes of `…` reach the model as three wrong characters.

## 3. Brainstorming, with Wheelhouse's rules on top

The First Mate starts `superpowers:brainstorming` (in Copilot, `wheelhouse-brainstorming`, section 4) for every feature, as route 9 of `skills/intake/SKILL.md` says now. The front desk's line that skips its questions goes, in both chats. In its place, one paragraph in the front desk playbook sets Wheelhouse's rules over brainstorming's (the "written Wheelhouse override" the core cut names):

1. **Questions.** Always at least one: what the first version includes, with the recommended scope, a smaller one and a larger one. At most about three in all; the others only where the request leaves a product call open, such as whether to see it working half way. Anything the code answers is never asked.
2. **As cards.** Each question is a `question` card from `card` (`proposal: true`, topic `design-<work id>`, three options at most, a recommendation), asked in the chat. Never in plain text, and never one at a time in chat as brainstorming says.
3. **No windows.** Brainstorming's visual companion is never offered: Wheelhouse opens no windows.
4. **Where the design goes.** At `.wheelhouse/work/<id>.md`, recorded with `record work`; never under `docs/`, never committed.
5. **Its review.** The design reaches the director as section 5 says, in place of brainstorming's review in chat.
6. **Where it stops.** When brainstorming says to invoke `superpowers:writing-plans`, stop: the feature session writes the plan (as route 9 says now).

## 4. Installing Superpowers

Wheelhouse installs Superpowers itself in both chats and never relies on the director's own copy. Neither route asks anything of the director.

**Claude Code.** Claude Code plugins can declare `dependencies` (code.claude.com/docs/en/plugins/dependencies). `.claude-plugin/plugin.json` gains `"dependencies": ["superpowers"]`. A bare name resolves in the declaring plugin's own marketplace, where the `superpowers` entry is already pinned to the tested commit, so installing Wheelhouse installs the pinned Superpowers at the same scope. No `version` range is given: a range resolves to `superpowers--v<version>` tags, which the upstream repository doesn't make, and the marketplace's sha is the pin. Setup's step 7 keeps its install and lineage check, which then finds the pin in place and confirms it; it is the fallback should a Claude Code release not honour the field. The build confirms first, with a throwaway project, that `claude plugin install wheelhouse@wheelhouse --scope project` brings Superpowers at the pinned sha; if it doesn't, the field is left out and setup's install stays the route.

**Copilot.** Superpowers ships a plugin for Copilot's CLI, not for VS Code's chat, where the First Mate runs. But VS Code's chat reads Agent Skills from the person's `~/.copilot/skills/` folder, and brainstorming is a plain skill folder, so it can run there as it is. Setup copies Wheelhouse's kept copy of `skills/brainstorming` (the one `kits.js` already fetches at the pinned commit and checks against `lineage/manifest.json`'s hash) to `~/.copilot/skills/wheelhouse-brainstorming/`, after the check passes. Only two things change in the copy, both in its front matter: `name` becomes `wheelhouse-brainstorming` (VS Code needs the name to match the folder, and the new name keeps clear of a copy the director may have), and the description begins "In a Wheelhouse project only:", since this folder is offered in every workspace. The text of the skill is upstream's, word for word. Setup records the copy in the journal like the First Mate's files, so uninstall takes it out, and the First Mate's build maps `superpowers:brainstorming` to `wheelhouse-brainstorming`. When the pin moves, setup and `/wheelhouse:update` copy it again.

## 5. Showing the design

The design file starts with `## Summary`: at most 200 words, in plain words, under *What you get*, *What it won't do*, *How you'll see it*, and *Calls I made for you*. The rest (how it works, tests, and the `wheelhouse-facts` and `wheelhouse-slices` blocks) is for the builders, as today.

- `record work` for a feature refuses a design with no `## Summary`, or one over 200 words, and prints `summary`: the section word for word, then `The whole design: [<id>.md](.wheelhouse/work/<id>.md)`.
- The First Mate posts `summary` as its own chat message, word for word, **not inside a card**, then asks the approval card straight after. Markdown renders in a reply in both Claude Desktop and VS Code's chat, and the link opens the file.
- A new command, `show <work id>`, prints the same for any recorded work. Show me on a work approval card runs it, then asks the card again.

## 6. The card's words

| Part | Feature | Other lanes |
|---|---|---|
| Question | Approve this design? | Approve this work as written? (as now) |
| what | Work `<id>`: `<title>`. (as now) | as now |
| why | It is a new feature, so its design comes to you first. It is in the message above. | as now, less any words that building waits for approval |
| Approve says | Wheelhouse builds it in slices and tests each one, then shows you the result. Building waits for your approval. | as now, ending "Building waits for your approval." |
| because | you'll see it working before it goes live | as now, less "you shaped" |
| meanwhile | Other work carries on. | Other work carries on. |

"You shaped" goes from every card. Building waiting for approval is said once, in Approve's `says`.

## 7. The "…" character

The label keeps its "…". The break is stopped at its source: every Wheelhouse command that prints JSON for the model writes each character outside ASCII as `\uXXXX`, which the model reads back as the character, so no code page can break it, and the same protects every accent and dash. The build confirms the cause first from the laptop rehearsal's transcript. Should the transcript show the break is somewhere else, such as in Copilot's own card, the builder reports it to the foreman and keeps the "…".

## 8. Tests

Test-first, each file run on its own:

- `tests/skills/front-desk.test.js`: the playbook has no line skipping brainstorming's questions; it names the first-version card, at most about three questions, cards never chat, no visual companion, `.wheelhouse/work/`, and stopping at writing-plans.
- `tests/scripts/agents/copilot/first-mate.test.js`: the built agent names `wheelhouse-brainstorming`, carries the same rules, and has no skip line; the built folder matches the playbook.
- A plugin manifest test: `plugin.json` lists `superpowers` in `dependencies`, and the marketplace's `superpowers` entry is pinned to the manifest's sha.
- `tests/scripts/agents/copilot/setup.test.js`: setup plans the copy to `~/.copilot/skills/wheelhouse-brainstorming/` only after the kit's hash check passes; the copy differs from upstream only in `name` and the description's opening; the journal holds it; a mismatched kit refuses it.
- The front desk's `record` and `show` tests: a feature design with no `## Summary`, or over 200 words, is refused; `record work` prints `summary` with the link line; `show <id>` prints the same and refuses an unknown work.
- `tests/scripts/cards/compose.test.js` and the approve-work tests: a feature card asks "Approve this design?"; no card says "you shaped"; each card says once that building waits for approval; `meanwhile` is "Other work carries on.".
- The encoding test: every command's JSON output is ASCII only, parses back to the same labels with `…` intact, and reads the same after a Windows code-page decode.
- An evaluation scenario in `scripts/eval/front-desk.js`: a feature request gets the first-version card and at most three in all, the summary message before the approval card, and brainstorming loaded from Wheelhouse's copy.
- Before the next sitting: render the summary and the card on the exact Desktop and Copilot paths, as the sittings require.

## 9. Build list (one builder)

1. Confirm the "…" cause from the laptop transcript; then the ASCII-escaped JSON output and its test.
2. Front desk playbook: drop the skip line; add section 3's paragraph; rebuild the Copilot First Mate (`npm run copilot-first-mate`) with the `wheelhouse-brainstorming` mapping.
3. `approveWorkInput`, `ASKS` and the Show me route: section 6's words.
4. `record work`'s summary check and `summary` output; the `show` command.
5. `plugin.json`'s `dependencies`, after the throwaway-project check in section 4.
6. Copilot setup: the kept brainstorming copy to `~/.copilot/skills/wheelhouse-brainstorming/`, journalled, and copied again on update.
7. The evaluation scenario; then render on both paths before the sitting.
