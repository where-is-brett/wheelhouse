// adapters/claude-code/hooks.js
// How Claude Code is told which hooks to run: the registration held in hooks/hooks.json, which the
// plugin loader reads. The object is held here as well, and tests/scripts/agents/claude-registration.test.js
// fails when the two differ, so a change to either must change both. Each call gives a copy.
const REGISTRATION = {
  "modules": [
    "./register.ts"
  ],
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|compact|clear|fork",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/session-start.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/stop-word.js\"",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/context-gauge.js\"",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/board-context.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/stop-guard.js\"",
            "timeout": 10,
            "onFailure": "block"
          },
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/lineage-hold.js\"",
            "timeout": 10,
            "onFailure": "block"
          }
        ]
      },
      {
        "matcher": "Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob|Bash|PowerShell|Monitor|WebFetch|ListMcpResourcesTool|ReadMcpResourceTool|mcp__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/tool-guard.js\"",
            "timeout": 10,
            "onFailure": "block"
          }
        ]
      },
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/card-check.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/prompt-record.js\"",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/feature-status.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "^wheelhouse:(builder|reviewer)$",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/report-check.js\"",
            "timeout": 10
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/feature-status.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/feature-status.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/precompact-guard.js\"",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/node-floor.cjs\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/stop-guard.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
};

const HOOKS_FILE = 'hooks/hooks.json';

export default Object.freeze({
  registration: () => structuredClone(REGISTRATION),
  file: () => HOOKS_FILE,
});
