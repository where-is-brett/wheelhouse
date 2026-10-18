<!-- docs/checks/16-secret-box.md -->

# Check 16: the password-style box

**Answer:** Yes — on the Mac and Windows, the system's own hidden-entry box works from Desktop and the text never reaches the chat. On Windows the box's process must not be started hidden. Storing the key in the keychain does not keep it from agents (see check 11).

## Question

That setup can open the operating system's own dialog for the token from Desktop, on macOS and Windows, so the token never enters the chat.

## Tested on

macOS, Claude Desktop, Claude Code 2.1.278, Node.js 22.22.1, 17 October 2026.

Windows 11, Claude Desktop, Claude Code 2.1.299, Node.js 24.21.0, Windows PowerShell, 17 October 2026.

## Method

From this Desktop session, `scripts/secrets/secret-box.js` opened the hidden-entry box (`askSecret`), stored what the director typed under `wheelhouse-probe` (`storeSecret`, which gives the text to `security -i` on stdin), read it back (`readSecret`) and printed only its length. The director typed made-up text. The item was then deleted (`deleteSecret`) and checked gone.

On Windows the same functions use a Windows Forms box with a password field, and Credential Manager (`PasswordVault`) for storing.

## Evidence

- The box appeared on the director's screen from a command the session ran, with its text hidden as it was typed.
- The session saw only "received 4 characters, stored, read back: yes". The text appeared in no output, log or transcript.
- Unit tests confirm that the secret is never in a process's arguments, and that quotes in the box's wording can't break the script.
- After deletion, `readSecret` returned nothing and `security find-generic-password` found no item.
- **Windows, first try:** no box appeared, and the command waited until it was stopped. The script started PowerShell with `windowsHide: true`, and Windows applies a hidden start to the first window a process shows, which was the box itself.
- **Windows, with the box's process started visibly:** the box appeared on its own, with no console window beside it. The session saw only "received 4 characters, stored, read back: yes" and, after deletion, "read back: nothing". `secret-box.js` now starts only the box's process visibly; storing, reading and deleting stay hidden.

## What it means for the design

- Section 15, step 3 stands on both systems: the token is typed into the system's own box, never the chat.
- Sections 11 and 12.6: the keychain is the wrong place for the key (check 11). The box stays; where the key is kept changes.

## Needs the director

No.
