#!/bin/sh
# probes/69-guards-without-node/guard.sh
# A preToolUse guard written for /bin/sh with no Node.js: it sends the hook input to a local answer server
# with curl and does what the answer says. If curl gets no answer (the server is down, too slow, or answers
# with an error), it refuses the call. That is the point of the check: a guard that fails closed.
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
  case "$answer" in
    *'"permissionDecision":"allow"'*) decision=allow ;;
    *'"permissionDecision":"deny"'*) decision=deny; reason='The answer server said deny.' ;;
    *) decision=deny; reason='The answer was not one the guard understands, so it refuses.' ;;
  esac
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
  # Only Copilot's own variables are kept, and a value that looks like a secret is not.
  env | sed -n '/^COPILOT_/p' | sed -E 's/^(COPILOT_[A-Za-z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)[A-Za-z0-9_]*)=.*/\1=[set]/' | tr '\n' ' ' | sed 's/^/copilot_env=/'
  printf '\n--\n'
} >>"$log" 2>/dev/null

if [ "$decision" = deny ]; then
  printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\n' "$reason"
fi
exit 0
