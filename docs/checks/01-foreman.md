<!-- docs/checks/01-foreman.md -->

# Check 1: a background foreman session

**Answer:** Partly — on the Mac, both a second Desktop session and a headless background session receive cross-session messages, wake on them and reply within seconds. On Windows the second Desktop session does the same; the headless session wasn't tried there, because the command-line Claude couldn't sign in. A long idle is still to try.

## Question

How a background foreman session runs and shows in Claude Desktop on macOS and Windows, and that cross-session messages reach it.

## Tested on

macOS, Claude Desktop (Claude Code 2.1.299) and the command line (Claude Code 2.1.278), 17 October 2026.

Windows 11, Claude Desktop (Claude Code 2.1.299), 17 October 2026.

## Method

Two probe sessions, each told only to answer a message "ping N" with "pong N" to its sender:

1. **A second Desktop session,** started from this one with the app's own session starter. It appears as a linked session row in Desktop; the director never opened it.
2. **A headless background session,** started with `claude --bg` in a scratch project. `claude agents` and `ListAgents` list it with kind `bg`.

This session sent each a ping with `SendMessage` and waited.

## Evidence

- **Second Desktop session:** "ping 1" sent at 10:18:34; the app reported "its turn has started on it"; "pong 1" arrived back by 10:18:43, about 9 seconds.
- **Headless background session:** "ping 2" sent at 10:19:07 into its inbox; it woke, answered, and "pong 2" arrived about 15 seconds later. Its log shows the reply going to this session's local socket.
- The background session started in manual permission mode, because auto mode wasn't available for the model it was given. It still took the message. Its reply arrived marked `from-mode="prompting"`.
- The app tells a starting session when another session's turn ends, so the director's session gets a one-line note without polling.
- **Windows, second Desktop session:** "ping 1" sent at 21:57:02 arrived at 21:57:08; "ping 2" sent at 21:57:36 arrived at 21:57:40; "ping 3", sent later while the probe was idle, was answered at once. Each "pong" came back. While the sending session was busy, its replies were held and delivered when its turn ended.
- **Windows, headless session:** not tried. `claude auth login` on that computer failed with "Request failed with status code 403", and `claude -p` reported "Not logged in". Desktop was signed in throughout.

## What it means for the design

- Section 8, "Where the foreman runs": option 1 works on the Mac, and so does option 2. Option 1 stays first: it shows as a row the director can open, and the app reports its turns.
- Section 8, permission mode: a background session's mode depends on its model, so the foreman's start script must set both explicitly.
- Section 4: a one-line message wakes an idle foreman within seconds, so the design's file-plus-one-line handoff works as written.
- Section 8: on Windows option 1 is confirmed and option 2 isn't. Since the command line's own sign-in can fail where Desktop's works, option 1 (a Desktop session) should stay the default on both systems, and setup shouldn't depend on the command line being signed in.

## Needs the director

No, for Windows option 1 (done). Option 2 on Windows needs a computer where `claude auth login` works. A longer idle (10 minutes) can be checked during the pilot.
