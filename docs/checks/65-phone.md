<!-- docs/checks/65-phone.md -->

# Check 65: the phone, on the Mac

**Answer:** Partly. A message sent from GitHub Mobile reaches a Copilot CLI session shared with `/remote`, its hooks run on it (`userPromptSubmitted`), and the question tool's card can be answered from the phone. No notification came while the phone was locked and a question was waiting. STOP sent from the phone reached the session, and the chat followed Wheelhouse's STOP skill, but Wheelhouse's own STOP was not set: Wheelhouse's hook took the session for a harness it doesn't run in (see below).

## Question

Whether a phone message can reach a Copilot session (Copilot CLI's remote sessions) and set STOP, and how a needs-you push reaches the phone (Copilot design C12).

## Tested on

4 November 2026, on macOS, with Copilot CLI 1.0.105 installed by the director (`npm install -g @github/copilot`) and signed in, and GitHub Mobile on the director's phone, signed in to the same account. The session ran in a terminal in the scratch project from checks 59 and 70. The model was Auto, which resolved to `gpt-5.6-luna`. The director sent the messages from the phone; the agent read the hook logs and the session's saved events.

## Method

1. The agent started `copilot` in the scratch project. The director shared it with `/remote` and opened it in GitHub Mobile.
2. From the phone: `Ask me with your question tool: Approve or Not now`, answered **Approve**.
3. From the phone: `Run the shell command sleep 45, then ask me with your question tool: Go or Not now`. The director allowed `sleep` and locked the phone, and watched for a notification while the question waited.
4. From the phone: `STOP`.

## Evidence

- **The phone's messages reach the session.** Each message from the phone came to the session's hooks as `userPromptSubmitted` with the text as typed, and the chat acted on it.
- **Cards from the phone.** The question tool (`ask_user`) came back `User responded: approve` and, later, `User responded: go`.
- **No notification.** The second question waited 43 seconds with the phone locked, and no notification came. The director answered it in the terminal.
- **STOP.** The chat loaded the `wheelhouse-stop` and `wheelhouse-lean` skills, ran a read-only command to check the project, said all stop was in effect for the chat, and asked a card. Wheelhouse's STOP was not set.
- **Why STOP was not set.** The session's saved events hold Wheelhouse's session-start line "Wheelhouse doesn't run in this kind of chat". Wheelhouse's hook tells Copilot from other harnesses by `COPILOT_CLI_BINARY_VERSION` (`adapters/copilot/translate.js`, `harnessOf`). A one-off `copilot -p` run at the same time did have it (1.0.105), so why this session lacked it was not found. Check 72 found the same line in VS Code's Copilot session target, which doesn't set the variable at all.

### What was not tested

- GitHub Mobile's notification settings: they were left as they were.
- STOP from the phone with Wheelhouse's hook running in the session.
- Windows.

## What it means for the design

- **The phone can reach a Copilot CLI session,** so phone STOP has a route: a message from GitHub Mobile reaches `userPromptSubmitted`, where Wheelhouse's STOP word is read.
- **A needs-you push doesn't come from Copilot,** at least with the app's settings as they were. The optional channels (ntfy, Telegram) stay the way a needs-you push reaches the phone.
- **The harness check must not depend on `COPILOT_CLI_BINARY_VERSION` alone** (check 72 has the detail). Until it reads what these sessions do set, STOP from the phone is followed only by the chat.

## Needs the director

- The harness check is changed (pull request #318) and works in VS Code's chat (check 72's re-test of 5 November). What is left needs the phone: the director starts `copilot` in a Lean project folder on the Mac, types `/remote`, sends STOP from GitHub Mobile to that session, and tells the agent so it reads the STOP state. Not done on 5 November because it needs the phone.
