<!-- templates/runbook.md -->
# When something goes wrong

This is the one-page runbook. Each step is a card that the front desk puts in front of the director. Nothing here runs until the director clicks the card for that step. The only exception is the first step, which anyone may take, because a false alarm costs only a pause.

## 1. Stop

**What the director clicks:** "Turn STOP on" (or the STOP button, or types `/stop`).

**What happens:** every agent halts. Reading and reporting carry on, so the front desk can say what was in progress. Nothing more is written to the host. Only the director lifts STOP, with a click on a card.

## 2. Cut the agents' access to the host

**What the director clicks:** "Cut the agents' access to the host". Steps 2, 4 and 5 use each click once.

**What happens:**

- With the narrow GitHub connection, Wheelhouse deletes its copy of the Wheelhouse app's keys from this computer. The app is still installed on GitHub, so the card then shows the page where the director chooses Suspend or Uninstall. Only the director can do that last part.
- With the narrow GitLab connection, Wheelhouse asks GitLab to revoke the project key, and deletes its copy once GitLab has done so. If GitLab refuses, the copy is kept, and the card shows the page where the director revokes the key by hand.
- With the quick connection, the agents use the director's own sign-in. Only the director can revoke it, so the card shows the page to do it on.

The answer says plainly what was done and what is left for the director.

## 3. Put the product back to an earlier release

**What the director clicks:** the release to go back to, from the last ten merges the card lists.

**What happens:** Wheelhouse opens a pull request, from a branch called `wheelhouse-restore-` and the first twelve characters of the commit. Its files are exactly that release's files, laid on top of the current default branch. The director approves that pull request on its card, and once CI has passed the merge follows. This is the one merge STOP lets through, and only for 24 hours after the director's click. It needs no review, because the files are a release that passed one. It does need the director's approval and passing CI. If the release changes CI files on GitHub, the push and the merge need the director's own sign-in, and the answer says so.

## 4. Put the project's records back from the backup

**What the director clicks:** "Put the project's records back from the backup".

**What happens:** Wheelhouse takes the newest weekly backup, checks it, and adds back any record that the state branch has lost. It only ever adds. It leaves out any record whose signature does not check, and it never changes one that is already there.

## 5. Contain live harm

**What the director clicks:** "Contain live harm".

**What happens:** Wheelhouse runs the containment step that the project defined, from a fresh copy of the default branch. The project says in its configuration what that step does:

> {{contain.describe}}

The command is allowed ten minutes. Wheelhouse waits no longer than that for one command, so a containment step that takes longer than that must run on in the background and report back by its own means.

A project that has defined none answers "This project has defined no live harm to contain", and nothing runs.

## If the organisation manages Claude Code

If the director's organisation manages Claude Code from Anthropic's console, those settings win and Locked's computer-wide file is skipped. Standard's protection is what holds.
