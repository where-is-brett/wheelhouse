<!-- docs/data.md -->

# Where your data goes

What Wheelhouse keeps, where, and for how long, and what uninstall removes and what it leaves.

## Conversations

What you and the agents say in Claude sessions goes to Anthropic to be processed, as with any use of Claude. Wheelhouse sends nothing anywhere else.

## Transcripts

Claude keeps each session's transcript on your computer. Setup sets how long: 30 days, even if you had chosen longer, and its card at step 6 tells you so. Older transcripts are removed for good.

## Remote Control

While Remote Control is connected, the transcript is also kept on Anthropic's servers. Setup asks you to switch it on so agents can reach your phone. A notification says how many things need you and their card numbers, never what a card says.

## Usage counts

Setup switches on Claude Code's usage counts for this computer only, with your agreement, and with every option that would record what you or the agents wrote left off. The counts go to a small receiver on your computer and nowhere else.

Claude Code sends your email and account IDs with every figure. The receiver keeps none of that: only the session, the model, the kind of count, the count, its time, and one short word for where in the session it went (such as "main"). Nothing else is stored. Wheelhouse also notes each session's running cost and how much of your allowance is used. The counts are kept for 14 days and the daily summaries for 90, in `~/.wheelhouse`.

## Your project's records

The project's decisions and records live on GitHub or GitLab, on the project's own `wheelhouse-state` branch, for as long as the project does. If you ever make the repository public, that branch's history goes public with it; the card for changing the repository's visibility says so. Your profile (your settings, and backups for every project and computer) is a private repository of yours, `wheelhouse-profile`.

On your computer, Wheelhouse keeps its working files in `~/.wheelhouse`: a copy of each project's records, setup's journal of every change it made, the keys agents work with, the tools it fetched and the usage counts. Keys never appear in the chat.

## Optional channels

ntfy and Telegram stay off unless you switch them on in your profile. They carry a link only, never what a card says, because anyone who guesses a public ntfy topic's name can read it.

## When you remove Wheelhouse

Typing `/wheelhouse:uninstall` in a session on the project shows a card listing everything it will put back. Nothing happens until you click **Remove it**.

**What it puts back or removes:**

- Its jobs for the project stop: the foreman and its watcher.
- Locked, if you chose it, is taken off. It asks for your computer password.
- Its settings, its configuration, its part of `CLAUDE.md` and the pinned kits come out of the project's files, by a pull request you merge (or straight from the folder, if setup's own commit never reached the host).
- The project's records on this computer are removed.
- The changes setup made to this computer (the 30 days for transcripts, the usage counts, Claude Code's update channel and phone notifications) are put back, but only with the last project on this computer that uses Wheelhouse, since the others still need them. With that last project, the keys it made are deleted or withdrawn (for the GitHub app you get its page, to remove it there), this computer's key leaves your profile, the usage receiver and the host helper stop, and Wheelhouse's own folders in `~/.wheelhouse` are removed: the tools it fetched, the copy of your profile, and its records of your clicks and answers.
- A setting you changed yourself after setup is left as you set it, and the card names it.

**What it keeps:**

- Your product's repository, the project's `wheelhouse-state` branch and your profile repository stay, unless you choose **Delete it** on each one's own card. **Keep it** is recommended, since none of them can be brought back. Deleting the branch is done with your own sign-in; for a repository, its settings page on GitHub or GitLab opens, and you click Delete there yourself.
- Branch protection on the host stays on.
- Setup's journal stays in `~/.wheelhouse`, so what setup did stays on record. So do the usage counts already gathered, which hold counts only; delete that folder yourself if you want them gone.
- Your git history stays, setup's commit included.
- git, and anything else setup installed with its official installer, stays on your computer.
- Transcripts already removed by the 30 days can't come back.

Last of all, you remove the Wheelhouse plugin from the project in Claude Desktop yourself.
