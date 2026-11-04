<!-- docs/checks/70-lean-in-vscode.md -->

# Check 70: Lean in VS Code with nothing added, on the Mac

**Answer:** No, at Auto on this account. The one-line request did set Wheelhouse up: the kit reached `~/.copilot/` with every file checked against its fingerprint, no Node.js was needed, and the chat loaded Wheelhouse's skills and instructions. But the chat skipped every card setup asks, put a second copy of Wheelhouse inside the project, and built two feature requests straight on the main version with no card, no branch and no record. The second request named Wheelhouse's playbook. The Windows half, with the company's usual limits, is not covered.

## Question

Whether Lean works in VS Code with nothing added, from one request in the chat to a first approved feature (Copilot design C17).

## Tested on

4 November 2026, on macOS, VS Code 1.132.0 with the built-in GitHub Copilot Chat (no extension to install). The chat ran in a scratch VS Code profile on a scratch git project with one commit and no remote, in Agent mode, with the Local session target. The model was Auto, the only one listed for this account (a free education plan). It resolved to `mai-code-1.1-flash`. Git and Node.js are both on this Mac. Release `v0.2.6`. The director typed the requests and clicked **Allow** on each command.

## Method

1. A new chat: `Set up Wheelhouse from https://github.com/where-is-brett/wheelhouse at release v0.2.6`, as the README says. The director allowed each command.
2. The same chat: `New feature: add one line to README.md that says "Built with Wheelhouse."`
3. A new chat: `Use Wheelhouse's playbook: new feature, add one line to README.md that says "Built with Wheelhouse."`

The hook logger from check 59 logged every tool call. The agent compared `~/.copilot/` before and after, and read the project, its history and the chat's saved session (which lists the skills and instructions given to the model).

## Evidence

- **Setup's commands.** Seven commands were allowed in one turn, which cost 2 premium requests. The chat first ran `git clone ... .` into the project folder, which failed because the folder isn't empty. It then cloned the release into `wheelhouse/` inside the project and read `adapters/copilot/skills/setup-lean/SKILL.md` from there. It then ran one long block of its own that held setup's steps 2 and 4 together.
- **The kit.** The block cloned the release to `~/.copilot/wheelhouse/v0.2.6/`, checked it was the tag, checked every file against `MANIFEST.txt` before and after copying, and printed "Every file matches MANIFEST.txt". `~/.copilot/` gained the four agents, the instructions file and the eleven skills of `v0.2.6`, and nothing else outside the project. No hook file was copied. No Node.js was used (the block only printed `node --version`).
- **The project.** One commit, "Set up Wheelhouse at Lean", added the ignore lines and `.wheelhouse/record/.gitkeep`. The Logbook `wheelhouse/board.md` was written into the folder that already held the second clone, and that folder is ignored. The project's `.vscode/settings.json` already existed and was left unchanged, with no card for the merge.
- **Cards skipped.** The chat never called its question tool during setup. Nothing was asked about the settings merge, the copy folder (the Logbook says "No copy yet"), the helper (Node.js runs here, so setup should have offered it) or the versions.
- **The skills were there.** The chat's saved session shows that, after the copy, each request gave the model the eleven `wheelhouse-*` skills and `wheelhouse.instructions.md`. It also gave it the skills in the person's own `~/.claude/skills/` and `~/.agents/skills/`: VS Code's chat reads those folders too.
- **The features.** Both feature requests read `README.md` and edited it on `main` in one step, with no card, no feature branch and no record. Neither read a Wheelhouse skill. Each cost about 0.1 to 0.3 of a request. The agent undid both edits.

### What was not tested

- Windows and the company's usual limits (this check's main case).
- Any other model. The picker offered only Auto on this account.
- The **Copilot** session target (VS Code's Copilot CLI harness), and VS Code's Autopilot.
- A computer without Node.js.
- Whether a clickable question can carry **Change the words**. VS Code's question tool allows a typed answer (`allowFreeformInput`), so it can, but check 59 advises against typed answers on binding questions.

## What it means for the design

- **The kit route works.** Getting the release with git and copying the kit with fingerprints did what Step 2 says, with no Node.js.
- **The playbook isn't followed at Auto on a free plan.** The model resolved by Auto took neither the setup skill's cards nor the Lean skill's feature flow, even when told to use Wheelhouse's playbook. Lean's guarantees there rest on the chat following the skills, so at this model Lean doesn't hold. Before Lean is offered on such an account, the director decides whether Lean needs a named model, or whether setup checks the model and says so.
- **Two fixes to setup's words are worth making.** The README's line for the chat should say plainly not to clone into the project. The setup skill should say to run each step's block as given, one step at a time, with its cards, and not to merge steps into one block.
- **VS Code's chat reads the person's Claude skills too** (`~/.claude/skills/`, `~/.agents/skills/`), and its Copilot harness reads a project's `.claude/settings.json` hooks. A person with both tools sees Wheelhouse's Claude-side pieces in Copilot's chat. This belongs with check 55's question of what reaches the chat.

## Needs the director

- A decision: whether Lean needs a named model (rather than Auto) before it is offered, or whether setup checks the model and says so.
- The Windows half, on the work laptop, with the company's usual limits.
