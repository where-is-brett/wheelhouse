<!-- docs/checks/65-phone.md -->

# Check 65: the phone

**Answer:** Deferred. The check was not run in sitting S6. It needs the director's phone in hand, the pinned Copilot CLI signed in, and a remote session that may use premium requests, and none of these was set up during the sitting.

## Question

Whether a Copilot CLI remote session reaches the person's phone, and whether STOP sent from the phone stops the session (Copilot design C12).

## Tested on

Not run. The account shows remote sessions turned on (`cli_remote_control_enabled: true`). The pinned CLI under the scratch probes folder is not signed in.

## Method

Planned: start a remote session from the pinned CLI, lock the phone, wait for the test notification, send STOP from the phone, and read the session and STOP state.

## Evidence

- None yet.

### What was not tested

- All of it.

## What it means for the design

- Nothing changes yet: the phone route stays as the plan has it until this check runs.

## Needs the director

- A short sitting with the phone in hand: signing the pinned CLI in (a password step), then the phone steps. It may use a few premium requests.
