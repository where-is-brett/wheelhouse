#!/bin/sh
# probes/69-guards-without-node/guard.sh
# A preToolUse guard written for /bin/sh with no Node.js: it sends the hook input to a local answer server
# with curl and does what the answer says. If curl gets no answer (the server is down, too slow, or answers
# with an error) or with anything other than exactly the allow answer, it refuses the call. That is the point of the check: a guard that fails closed.
# Run as: /bin/sh guard.sh <answer URL> <log file>
# Each run appends one record to the log: lines of key=value, then a line holding only "--".
url=$1
log=$2

input=$(cat)
tool=$(printf '%s' "$input" | sed -n 's/.*"toolName":"\([^"]*\)".*/\1/p' | tr '\n' ' ')
node_found=$(command -v node 2>/dev/null)
curl_found=$(command -v curl 2>/dev/null)
answer=$(printf '%s' "$input" | curl -sS -f -m 3 -X POST -H 'content-type: application/json' --data-binary @- "$url" 2>/dev/null)
curl_exit=$?

reason=''
decision=''
if [ "$curl_exit" -ne 0 ]; then
  decision=deny
  reason="No answer from the answer server (curl exit $curl_exit), so the guard refuses."
else
  # Allow only when the whole answer, with its whitespace removed, is exactly the allow answer.
  compact=$(printf '%s' "$answer" | tr -d ' \t\r\n')
  if [ "$compact" = '{"permissionDecision":"allow"}' ]; then
    decision=allow
  else
    decision=deny
    reason='The answer was not exactly allow, so the guard refuses.'
  fi
fi

{
  printf 'at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'tool=%s\n' "$tool"
  printf 'node=%s\n' "$node_found"
  printf 'curl=%s\n' "$curl_found"
  printf 'path=%s\n' "$PATH"
  printf 'curl_exit=%s\n' "$curl_exit"
  printf 'answer=%s\n' "$(printf '%s' "$answer" | tr '\n' ' ')"
  printf 'decision=%s\n' "$decision"
  # Only Copilot's own variables are kept, and only the names listed here show their values; any other
  # COPILOT_ variable is logged by name with [set] in place of its value.
  env | sed -n '/^COPILOT_/p' | sed -E '/^(COPILOT_HOME|COPILOT_HOOK_DIR|COPILOT_CLI_RESOLVED_DIST_DIR|COPILOT_CLI_BINARY_VERSION|COPILOT_PROJECT_DIR|COPILOT_CLI|COPILOT_HOOK_ALLOW_LOCALHOST)=/!s/^([A-Za-z0-9_]*)=.*/\1=[set]/' | tr '\n' ' ' | sed 's/^/copilot_env=/'
  printf '\n--\n'
} >>"$log" 2>/dev/null

if [ "$decision" = deny ]; then
  printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$reason"
fi
exit 0
