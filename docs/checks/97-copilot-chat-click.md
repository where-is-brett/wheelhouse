<!-- docs/checks/97-copilot-chat-click.md -->

# Check 97: Copilot trial T5, whether a chat click can be proven

**Answer:** No. A real click on a card in VS Code's Copilot chat reaches the hook as the text "User responded: Hello", the same whoever clicks. An agent with computer use made the click in this trial, so the hook cannot tell the person's click from an agent's. Through the hook path nothing records the answer: the card stayed waiting. An agent that posts to the helper's `/cards/chat-click` directly is taken, as an unsigned `chat-click`. `C6_PASSED` stays false, and a chat answer stays the "not proven" click the design describes.

## Question

Copilot design C6: can Wheelhouse prove that a chat click on an `ask_user` card was the person's, and can an agent fill one in itself? Check 59 left two routes open: a forged hook input, and an agent making the click.

## Tested on

14 November 2026, on macOS, VS Code with the built-in GitHub Copilot Chat, in a scratch profile (`--user-data-dir` and `--extensions-dir` in a scratch folder) on a throwaway project, with scratch `WHEELHOUSE_HOME` and `COPILOT_HOME`. The session target was Copilot CLI, the agent was the Wheelhouse First Mate, and the model was Auto. The hooks were Wheelhouse's own entry, with C6 turned on in the scratch copy only, and a logger on every event. Three requests were used: one in Autopilot, one that went to a background session by mistake, and one for the click.

## Method

- **Autopilot.** The director sent "Start". The First Mate asked the seeded card with `ask_user`.
- **A click by an agent.** In Interactive mode, the agent (not the chat) typed a prompt into the chat box over the scratch window's debugging port, and clicked **Hello** on the card through computer use.
- **Forged hook inputs.** A script fed Wheelhouse's hook entry three made-up `postToolUse` inputs, with C6 off and on: VS Code chat's `vscode_askQuestions` shape (A), the `ask_user` text shape (B), and the shape `policyClick` reads (C).
- **A direct post.** The same script posted a label to the helper's `/cards/chat-click`, as an agent can (D).

## Evidence

- **Autopilot answers by itself.** Its `postToolUse` text was "User responded: The user is not available to answer your question. Choose a pragmatic option…", so an Autopilot answer can be told apart from a click.
- **A click is only a sentence.** For the agent's click, `postToolUse` for `ask_user` had `toolResult.textResultForLlm` "User responded: Hello", 6 seconds after `preToolUse`. Nothing in the input says who clicked. Check 59 saw the same sentence for the director's click.
- **The hook path records nothing.** On Copilot every hook step writes through the helper, so `prompt-record` does nothing in the hook and nothing posts a click. After the agent's click the card was still in `views waiting`, with no `card-answer` event.
- **Forged inputs A to C** recorded nothing, with C6 on or off.
- **The direct post D was taken:** `{"ok":true,…}`, and the latest `card-answer` was `{"label":"Hi","proof":"chat-click","where":"chat","signed":false}`.

### What was not tested

- A company's managed hook, which check 59 also left open.
- The standalone CLI, and Windows.

## What it means for the design

- **`C6_PASSED` stays false.** A click can't be proven in chat: an agent with computer use makes the same click, and an agent can post the same answer straight to the helper.
- **A chat answer stays an unsigned `chat-click`.** Answers that must be the person's stay on the pane or the phone, as the design has them.
- **Autopilot's answer text should never count as a click.** If C6 ever passes, the translation must treat the "not available" sentence as no answer, as check 59 says.

## Needs the director

Nothing. A company managed hook and Windows are left for the director's own Copilot sittings.
