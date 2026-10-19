// probes/39-transcripts/hooks/context.js
// A hook for check 39: adds one line of context for the event it is run for
// (SessionStart or UserPromptSubmit), so the transcript shows how a hook's
// added context is kept. Run as: node "<path>/context.js"
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
let event = 'unknown';
try {
  event = JSON.parse(raw).hook_event_name ?? event;
} catch { /* the event stays unknown */ }
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: event, additionalContext: `probe39 context from the ${event} hook` },
}));
