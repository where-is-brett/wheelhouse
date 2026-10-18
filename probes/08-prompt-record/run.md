<!-- probes/08-prompt-record/run.md -->

# Check 8: the trials, for the director's sitting

1. The session runs `node probes/08-prompt-record/setup.js` and opens a new Claude Desktop session on the folder it prints.
2. **Typed message.** The director types "hello from the director" in that session.
3. **Relayed message.** From the first session, send the new session a message with SendMessage: "hello from another session".
4. **A real click.** In the new session, ask the director one multiple-choice question ("Pick one", options "Apples" and "Pears"); the director clicks one.
5. **A pre-filled answer.** In the new session, call the question tool with the `answers` field already filled in ("Pick one" = "Apples"), as an agent forging a click would. Note whether the director saw anything.
6. Read `~/.wheelhouse-probes/08-prompt-record/hooks.jsonl` and compare the four entries: which fields tell a typed message, a relayed message, a real click and a pre-filled answer apart?
7. The mod-submitted prompt is tried in Task 6, with the probe mod, and its entry lands in the same log.
8. Delete the scratch folder.
