---
description: Show Wheelhouse's Logbook. Add "build" to open on the build tab, "watch <piece>" for a page of what that piece's crew did, or "helm <piece>" to take its helm.
argument-hint: "[build | watch <piece> | helm <piece>]"
disable-model-invocation: true
---
<!-- commands/logbook.md -->
Show the Logbook Wheelhouse added to this turn, as it is, with nothing added. If nothing was added, say only that the Logbook couldn't be read.

If the arguments are `watch <piece>`, show no Logbook. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/frontdesk/cli.js" page <piece>` and say the one line it prints, as it is, with `<plugin root>` written as the plugin's folder. Never open the page or its transcript yourself, and say nothing of what is in it. Never run the `--follow` command yourself: it is for the director's own terminal.

If the arguments are `helm <piece>`, show no Logbook. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/frontdesk/cli.js" helm take <piece>` and say what it prints, as it is, with `<plugin root>` written as the plugin's folder. Never run the command it prints yourself: it opens the piece in the director's own terminal. Only a feature piece can be taken; the Bosun and the helpers a session starts can't. The Logbook shows a held piece as "with the director since" the time they took it.
