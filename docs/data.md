<!-- docs/data.md -->

# Where your data goes

What Wheelhouse keeps, where, and for how long, and what uninstall removes and what it leaves.

## Conversations

What you and the agents say in Claude sessions goes to Anthropic to be processed, as with any use of Claude. Wheelhouse sends your conversations nowhere else. What it does send, and where, is below: your product's code goes to GitHub or GitLab as it always did, Wheelhouse's records of what you say and click stay on your computer, and a link goes to ntfy or Telegram only if you switch them on.

## Transcripts

Claude keeps each session's transcript on your computer. Setup sets how long: 30 days, even if you had chosen longer, and its card at step 6 tells you so. Older transcripts are removed for good.

## Remote Control

While Remote Control is connected, the transcript is also kept on Anthropic's servers. Setup asks you to switch it on so agents can reach your phone. A notification says how many things need you and their card numbers, never what a card says.

## Usage counts

Setup switches on Claude Code's usage counts for this computer only, with your agreement, and with every option that would record what you or the agents wrote left off. The counts go to a small receiver on your computer and nowhere else.

Claude Code sends your email and account IDs with every figure. The receiver keeps none of that: only the session, the model, the kind of count, the count, its time, and one short word for where in the session it went (such as "main"). Nothing else is stored. Wheelhouse also notes each session's running cost and how much of your allowance is used. The counts are kept for 14 days and the daily summaries for 90, in `~/.wheelhouse`.

## Your project's records

The project's decisions and records (your requests and ideas, rulings, cards and your clicks on them, approvals and reviews) stay on your computer, in the project's private record, `~/.wheelhouse/projects/<project>/record/`. It is a git repository with no remote: Wheelhouse adds to it and never sends it anywhere. Your personal settings, and your own GitHub app if you made one, are kept the same way in `~/.wheelhouse/settings/`, one for each computer.

A project kept on this computer goes nowhere: its history stays in your folder and in a private copy, `~/.wheelhouse/projects/<project>/home.git`, which only Wheelhouse's helper changes.

For a project on a host, nothing of yours goes to GitHub or GitLab, even if the repository is public. The one thing Wheelhouse keeps there is the `wheelhouse-lock` branch, which stops two computers driving one project at once: it holds only a computer id and a counter.

Each card the build engine raises also gets a seal in that record: a signed line of what Wheelhouse's own checks could tell from the change when the card was written. It stays in the private record. No agent, board or review reads what a seal says, and only a count of them is shown. It changes nothing about a card. Once a card is answered, a further signed line scores what would have been decided against the answer. The scores stay sealed too.

When the First Mate ends a turn on a question with no card, Claude Code's Stop hook adds one line to the same record with the time and none of the words, so those questions can be counted. A pick of Suggest a change… in the chat on a build's question keeps only the card's id, for its score.

A question card's seal may gain a second line: a small read-only run's own reading of the question, made after the card is written. That run sees the question, the bare options and the change with its comments taken out, in a folder of its own on this computer, and reads nothing else. What it was shown is kept only until it has read it. Its reading stays in the private record with the seal, and its tokens are kept under a line of their own, against no piece. It changes nothing about a card, and no card waits for it.

When two pieces ask the same question in the same words and options, the second is kept as a question that names the first, with no card of its own, so one answer can go to both. Each tick, Wheelhouse may also add a line naming the card that everything else is waiting behind, and how many pieces each card holds up. Both stay in the same record, and neither holds anything from your work beyond the question's own words.

A rule you sign, so that Wheelhouse may one day settle a kind of question without you, is kept in the same private record, with the click that signed it. A rule can't sit in the project's repository, because an agent can edit that. For now a signed rule decides nothing: it only names the seals of the cards it would have covered. Each rule comes up for review after six months.

If you choose a backup folder for a project kept on this computer, Wheelhouse writes one file there, `<project>.wheelhouse-backup`, with the project's code and its history, and keeps one earlier copy beside it. The file holds none of the records above and none of Wheelhouse's own branches. Where it goes from there is up to the folder you chose: a cloud service sends it off your computer under its own terms.

Beside each project, `backup.json` says where its backups go and how the last one went, and `safekeeping.json` holds what the Safekeeping line last found: names of branches and how many changes are only here, never your code. **Keep a copy online** sends a branch to your host under `keep/<branch>`, and only when you press it.

Your history doesn't follow you to another computer, as Claude's chats don't: a second computer starts its own record. Wheelhouse keeps no backup of it anywhere else, so if a computer is lost, its private record is lost with it unless a backup of the computer (Time Machine, or File History on Windows) has it.

On your computer, Wheelhouse also keeps in `~/.wheelhouse` setup's journal of every change it made, the keys agents work with, the tools it fetched and the usage counts. Keys never appear in the chat.

If you set a project up with an earlier Wheelhouse (v0.1.x), its records were on a `wheelhouse-state` branch and your settings in a `wheelhouse-profile` repository. The first session after the update copies them into the private record and settings on this computer. Nothing old is deleted, here or on GitHub or GitLab: that branch and that repository stay where they are until you choose to delete them.

## The build engine

On a Mac, from v0.2.0, for a product on GitHub, setup installs Wheelhouse's build engine, Archon. It keeps two folders on your computer:

- `~/.wheelhouse/engine`, the engine itself: Archon, built from its pinned source with Wheelhouse's patch; the pinned Bun it needs; the broker, Wheelhouse's go-between for every GitHub call the engine makes; and a local copy of each project's history that the engine's git reads from, refreshed by Wheelhouse's helper, so the engine never holds a key. For a product that builds with Copilot, it also holds Copilot's pinned command-line tool and its clean home: Wheelhouse's guards, Wheelhouse's skills and your Copilot sign-in, and nothing else of your Copilot settings.
- `~/.wheelhouse-engine`, Archon's own records: a database of its runs, and each run's transcript, which hold the prompts and code of that run.

Its usage reporting is always off. Now and then it asks GitHub for its own release list; it has no switch for that, and the request carries nothing of yours. If you switch on **Engine room**, Archon's console downloads its files from Archon's GitHub release the first time, and it listens on your computer only.

A GitHub project with no CI has its tests run on your computer, from v0.2.1. Each change's copy, its build output and its own test home sit in `~/.wheelhouse/engine/checks/<project>/`. A change's go when its work has ended, a main-line check's when it is done. Each result is a signed record in the project's private state, and a line of its output may be in that record, after a scan for secrets. GitHub gets only a pass or fail for the commit.

So that the engine's steps keep Wheelhouse's guards, setup also adds the Wheelhouse plugin to Claude Code for your account, not just this project (an older Wheelhouse already there is brought up to date instead), and a sign-in start that starts Wheelhouse's helper when you sign in to the Mac. In the project, setup's commit adds Archon's project settings (`.archon/config.yaml`) and the merge queue's policy (`.archon/sdlc/policy/maintainers.json`). A project set up before v0.2.0 gets these two files by a pull request you approve.

A product on GitLab, and a computer other than a Mac, gets none of this, and keeps Wheelhouse's own Crew for now.

## Optional channels

ntfy and Telegram stay off unless you switch them on in your settings. They carry a link only, never what a card says, because anyone who guesses a public ntfy topic's name can read it.

## When you remove Wheelhouse

Typing `/wheelhouse:uninstall` in a session on the project shows a card listing everything it will put back. Nothing happens until you click **Remove it**.

**What it puts back or removes:**

- The build engine's runs for the project are cancelled first. If they don't stop, uninstall stops there and removes nothing else.
- Its jobs for the project stop: the Bosun and its watcher.
- Locked, if you chose it, is taken off. It asks for your computer password.
- A project kept on this computer first brings its folder up to the main version, with every line its private copy holds; uninstall stops there, with nothing of the folder touched, if the folder has changes of its own or is on another line.
- Its settings, its configuration, its part of `CLAUDE.md`, the pinned kits and the engine's two `.archon` files come out of the project's files, by a pull request you merge (for a project kept on this computer, by a last change merged at once, into the folder too; its `wheelhouse` git setting and its check folder go after it) (or straight from the folder, if setup's own commit never reached the host). Engine files that came by the switch's pull request, rather than setup's commit, stay for now.
- The changes setup made to this computer (the 30 days for transcripts, the usage counts, Claude Code's update channel and phone notifications) are put back, but only with the last project on this computer that uses Wheelhouse, since the others still need them. While another project here still uses the GitHub app, the app stays, and you get its installation page to untick this project's repository there.
- With a project other than the last, its own copy of the project's history in the engine folder goes; the engine stays for the others.
- With the last project, the engine goes: its folder, with Archon, Bun, the broker, the copies of history and Copilot's tool and clean home; the Wheelhouse plugin setup added for your account (one setup only brought up to date stays); and the sign-in start.
- With that last project, the keys it made are deleted or withdrawn (for the GitHub app you get its page, to remove it there), the usage receiver and the host helper stop, and Wheelhouse's own folders and files in `~/.wheelhouse` are removed: the tools it fetched, its records of setup's clicks and answers, and last of all this computer's own signing key and its id.
- A setting you changed yourself after setup is left as you set it, and the card names it. A settings file or section setup made for its own keys goes with them once nothing else is in it.

**A project your other computers use too** (one this computer joined): uninstall takes Wheelhouse off this computer only. The project's files stay as committed, nothing on GitHub or GitLab is offered for deletion, and the GitHub app stays installed with nothing to untick. Your other computers keep Wheelhouse's checks for the project.

**What it keeps:**

- Your product's repository stays, unless you choose **Delete it** on its own card. It gets a card only if setup made it: one you already had is kept, with no card. **Keep it** is recommended, since it can't be brought back. Its settings page on GitHub or GitLab opens, and you click Delete there yourself.
- A project kept on this computer's private copy, `~/.wheelhouse/projects/<project>/home.git`, stays, unless you choose **Delete it** on its own card. Your folder's git holds the whole history by then, so nothing depends on the copy.
- The project's private record on this computer stays, unless you choose **Delete it** on its own card. **Keep it** is recommended, since a deleted record can't be brought back.
- The build engine's run history, `~/.wheelhouse-engine`, stays, unless you choose **Delete it** on its own card with the last project. **Keep it** is recommended, since it can't be brought back.
- A `wheelhouse-state` branch or `wheelhouse-profile` repository left from an earlier Wheelhouse stays where it is; uninstall offers no card for either.
- Branch protection on the host stays on.
- Setup's journal stays in `~/.wheelhouse`, so what setup did stays on record, and so does uninstall's own record of how it went. So do the usage counts already gathered, which hold counts only; delete that folder yourself if you want them gone.
- Your git history stays, setup's commit included.
- The project's `.wheelhouse` folder stays, with the First Mate's and the Bosun's files in it, which uninstall never touches. So does the line setup added to keep that folder out of git, so its files don't show up as changes. If the folder isn't there when you remove Wheelhouse, that line comes out with setup's other changes.
- git, and anything else setup installed with its official installer, stays on your computer.
- Transcripts already removed by the 30 days can't come back.

Last of all, you remove the Wheelhouse plugin from the project in Claude Desktop yourself.
