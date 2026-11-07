// tests/fixtures/pane-states/models.js
// The pane models of this folder's JSON files as one module, for the mod's tests, which can import only code files and read none.
// tests/vscode/states.test.js holds this equal to the files; regenerate it from them when a fixture changes.
// Generated: do not edit by hand.

export const MODELS = {
  'first-reading': {
    "v": 1,
    "project": "owner__name",
    "at": null,
    "glance": "Wheelhouse",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [],
    "held": null,
    "verdict": "Nothing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": null,
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [
      "The host helper isn't running, so nothing can be pushed or merged",
      "Nothing has been synced to this computer yet, so nothing below is current"
    ],
    "view": "main",
    "open": null
  },
  'calm': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "Wheelhouse",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [],
    "held": null,
    "verdict": "Nothing needs you. Nothing is broken.",
    "since": null,
    "launch": {
      "resolved": 3,
      "total": 5,
      "gained": 1,
      "next": [
        {
          "text": "Connect the payments account",
          "yours": true
        },
        {
          "text": "Write the privacy page",
          "yours": false
        }
      ]
    },
    "building": [
      {
        "text": "Building the banner, slice 1 of 3",
        "see": "You'll see it tomorrow"
      }
    ],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'card-of-parts': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'why-open': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": "why"
  },
  'feature-question': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-answer",
        "n": 1,
        "header": "Question",
        "kind": "answer",
        "text": "The export needs to know which separator to use.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nAnswer question q-export-csv-1\nReply code: 67HJ",
        "hash": "2aa9b6286e6d",
        "buttons": [
          {
            "label": "Comma",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Tab",
            "does": "record",
            "shape": "outlined"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "answer",
          "header": "Question",
          "ask": "The export needs to know which separator to use.",
          "what": "The export needs to know which separator to use.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Comma, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Comma",
              "says": "Commas between values.",
              "recommended": true
            },
            {
              "label": "Tab",
              "says": "Tabs between values.",
              "recommended": false
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Answer question q-export-csv-1",
          "code": "67HJ"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'suggest-open': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": "suggest"
  },
  'steered': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": "21:00",
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'revised': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": true,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'recording': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null,
    "recording": "card-approval"
  },
  'answered-elsewhere': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [],
        "note": "Approved in the chat at 10:34",
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'several-cards': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "3 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      },
      {
        "id": "card-answer",
        "n": 2,
        "header": "Question",
        "kind": "answer",
        "text": "The export needs to know which separator to use.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nAnswer question q-export-csv-1\nReply code: 67HJ",
        "hash": "2aa9b6286e6d",
        "buttons": [
          {
            "label": "Comma",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Tab",
            "does": "record",
            "shape": "outlined"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "answer",
          "header": "Question",
          "ask": "The export needs to know which separator to use.",
          "what": "The export needs to know which separator to use.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Comma, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Comma",
              "says": "Commas between values.",
              "recommended": true
            },
            {
              "label": "Tab",
              "says": "Tabs between values.",
              "recommended": false
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Answer question q-export-csv-1",
          "code": "67HJ"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      },
      {
        "id": "card-footer",
        "n": 3,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #14 live?\nPull request #14 adds a footer to the shop page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #14 at commit bbcdef123456\nReply code: NPYY",
        "hash": "c4b5481fe872",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #14 live?",
          "what": "Pull request #14 adds a footer to the shop page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #14 at commit bbcdef123456",
          "code": "NPYY"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "Three things need you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'all-stop': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": true,
      "since": "2026-11-04T00:30:00.000Z"
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "main",
    "open": null
  },
  'to-watch': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "Wheelhouse",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [],
    "held": null,
    "verdict": "Nothing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [
      {
        "level": "watch",
        "text": "CI is failing on main",
        "of": null
      },
      {
        "level": "stop",
        "text": "The shop page is down",
        "of": null
      }
    ],
    "healthNote": {
      "allWell": false,
      "protection": "Standard",
      "week": "This week: 34% of the allowance"
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": "This week: 34% of the allowance",
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "board",
    "open": null
  },
  'out-of-date': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "1 waiting",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [
      {
        "id": "card-approval",
        "n": 1,
        "header": "Approval",
        "kind": "approval",
        "text": "Put pull request #13 live?\nPull request #13 changes the wording on the sign-in page.\nIt changes what users see, which is yours to decide at level 3.\nNothing is released and the agents carry on with other work.\nTo know more, just ask.\nApprove pull request #13 at commit abcdef123456\nReply code: J66Y",
        "hash": "f78c290f9af6",
        "buttons": [
          {
            "label": "Approve",
            "does": "record",
            "shape": "filled"
          },
          {
            "label": "Suggest a change…",
            "does": "suggest",
            "shape": "outlined"
          },
          {
            "label": "Not now",
            "does": "record",
            "shape": "small",
            "corner": true
          },
          {
            "label": "Why?",
            "does": "why",
            "shape": "small"
          },
          {
            "label": "Show me",
            "does": "turn",
            "shape": "small"
          }
        ],
        "note": null,
        "blocking": false,
        "asked": false,
        "heldBack": false,
        "parts": {
          "kind": "approval",
          "header": "Approval",
          "ask": "Put pull request #13 live?",
          "what": "Pull request #13 changes the wording on the sign-in page.",
          "small": "It changes what users see, which is yours to decide at level 3.",
          "recommendation": "Approve, because the checks passed and the change is small.",
          "options": [
            {
              "label": "Approve",
              "says": "It approve and goes ahead.",
              "recommended": true
            },
            {
              "label": "Suggest a change…",
              "says": "Tell me what you'd change; I'll come back with a new proposal.",
              "recommended": false
            },
            {
              "label": "Show me",
              "says": "I show you what it looks like, then ask again.",
              "recommended": false
            },
            {
              "label": "Not now",
              "says": "Leave this waiting; nothing changes yet.",
              "recommended": false
            }
          ],
          "why": "It changes what users see, which is yours to decide at level 3.",
          "meanwhile": "Nothing is released and the agents carry on with other work.",
          "line": "Approve pull request #13 at commit abcdef123456",
          "code": "J66Y"
        },
        "steered": null,
        "waited": "asked 16 hours ago",
        "revised": false,
        "openInChat": false
      }
    ],
    "held": null,
    "verdict": "One thing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [
      "The host helper isn't running, so nothing can be pushed or merged",
      "Nothing has been synced to this computer yet, so nothing below is current"
    ],
    "view": "main",
    "open": null
  },
  'settings': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "Wheelhouse",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [],
    "held": null,
    "verdict": "Nothing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "settings",
    "open": null,
    "settings": {
      "groups": [
        {
          "id": "stop",
          "title": "All stop",
          "note": "All stop halts the whole Crew at once. Only you can lift it.",
          "rows": [
            {
              "key": "builders",
              "label": "Crew",
              "value": "Working",
              "kind": "value"
            }
          ]
        },
        {
          "id": "project",
          "title": "This project",
          "note": "Only for this project. A pick changes it at once and counts as your confirmation; Undo stays for a minute. Protection and build commands need your password or a careful yes, so the First Mate asks for them.",
          "rows": [
            {
              "key": "autonomy",
              "label": "Autonomy",
              "value": "balanced",
              "kind": "select",
              "options": [
                {
                  "value": "cautious",
                  "label": "Cautious"
                },
                {
                  "value": "balanced",
                  "label": "Balanced"
                },
                {
                  "value": "trusting",
                  "label": "Trusting"
                }
              ]
            },
            {
              "key": "showFirst",
              "label": "Show before building",
              "value": "visual",
              "kind": "select",
              "options": [
                {
                  "value": "always",
                  "label": "Always"
                },
                {
                  "value": "visual",
                  "label": "Visual changes"
                },
                {
                  "value": "asked",
                  "label": "Only when asked"
                }
              ]
            },
            {
              "key": "milestones",
              "label": "Feature milestones",
              "value": "ask",
              "kind": "select",
              "options": [
                {
                  "value": "demos",
                  "label": "Midpoint demos"
                },
                {
                  "value": "to-the-end",
                  "label": "Run to the end"
                },
                {
                  "value": "ask",
                  "label": "Ask per feature"
                }
              ]
            },
            {
              "key": "pace",
              "label": "Crew at once",
              "value": "3",
              "kind": "select",
              "options": [
                {
                  "value": "1",
                  "label": "1"
                },
                {
                  "value": "2",
                  "label": "2"
                },
                {
                  "value": "3",
                  "label": "3"
                }
              ]
            },
            {
              "key": "efficiency",
              "label": "Thoroughness",
              "value": "balanced",
              "kind": "select",
              "options": [
                {
                  "value": "lightest",
                  "label": "Lightest: not ready yet"
                },
                {
                  "value": "lean",
                  "label": "Lean: not ready yet"
                },
                {
                  "value": "balanced",
                  "label": "Balanced"
                },
                {
                  "value": "thorough",
                  "label": "Thorough"
                }
              ]
            },
            {
              "key": "phase",
              "label": "Product phase",
              "value": "before-launch",
              "kind": "select",
              "options": [
                {
                  "value": "before-launch",
                  "label": "Before launch"
                },
                {
                  "value": "launched",
                  "label": "Launched"
                }
              ]
            },
            {
              "key": "cardsPerDay",
              "label": "Cards a day",
              "value": "3 cards a day",
              "kind": "value"
            },
            {
              "key": "windowsBuildCommands",
              "label": "Build commands on Windows",
              "value": "Ask",
              "kind": "change"
            },
            {
              "key": "budget",
              "label": "Budget",
              "value": "Report only",
              "kind": "value"
            },
            {
              "key": "protection",
              "label": "Protection",
              "value": "Ask the First Mate",
              "kind": "change"
            }
          ]
        },
        {
          "id": "you",
          "title": "You, in every project",
          "note": "These follow you to every project. Notifications and working hours are changed with the First Mate, which checks them with you.",
          "rows": [
            {
              "key": "presence",
              "label": "Availability",
              "value": "here",
              "kind": "select",
              "options": [
                {
                  "value": "here",
                  "label": "Here"
                },
                {
                  "value": "away-hours",
                  "label": "Away for 2 hours"
                },
                {
                  "value": "away-evening",
                  "label": "Away until 18:00"
                },
                {
                  "value": "away-morning",
                  "label": "Away until 09:00 tomorrow"
                },
                {
                  "value": "dnd-morning",
                  "label": "Do not disturb until 09:00 tomorrow"
                },
                {
                  "value": "dnd-open",
                  "label": "Do not disturb until I change it"
                }
              ]
            },
            {
              "key": "briefing",
              "label": "Briefing length",
              "value": "standard",
              "kind": "select",
              "options": [
                {
                  "value": "short",
                  "label": "Short"
                },
                {
                  "value": "standard",
                  "label": "Standard"
                },
                {
                  "value": "detailed",
                  "label": "Detailed"
                }
              ]
            },
            {
              "key": "briefingGapHours",
              "label": "Hours before a new briefing",
              "value": "2 hours",
              "kind": "change"
            },
            {
              "key": "explanations",
              "label": "Explanations",
              "value": "plain",
              "kind": "select",
              "options": [
                {
                  "value": "plain",
                  "label": "Plain"
                },
                {
                  "value": "some-terms",
                  "label": "Some technical terms"
                }
              ]
            },
            {
              "key": "usageMark",
              "label": "Usage nudge",
              "value": "75",
              "kind": "select",
              "options": [
                {
                  "value": "off",
                  "label": "Off"
                },
                {
                  "value": "50",
                  "label": "At 50%"
                },
                {
                  "value": "65",
                  "label": "At 65%"
                },
                {
                  "value": "75",
                  "label": "At 75%"
                },
                {
                  "value": "90",
                  "label": "At 90%"
                }
              ]
            },
            {
              "key": "boardTab",
              "label": "Logbook opens on",
              "value": "director",
              "kind": "select",
              "options": [
                {
                  "value": "director",
                  "label": "Captain"
                },
                {
                  "value": "build",
                  "label": "Build"
                }
              ]
            },
            {
              "key": "notifications",
              "label": "Notifications",
              "value": "claude",
              "kind": "change"
            },
            {
              "key": "hours",
              "label": "Working hours",
              "value": "no set hours",
              "kind": "change"
            }
          ]
        },
        {
          "id": "advanced",
          "title": "Advanced settings",
          "note": "",
          "rows": [
            {
              "key": "advanced",
              "label": "Advanced settings",
              "value": "",
              "kind": "change"
            }
          ]
        }
      ]
    }
  },
  'settings-changed': {
    "v": 1,
    "project": "owner__name",
    "at": "2026-11-04T01:30:00.000Z",
    "glance": "Wheelhouse",
    "stop": {
      "on": false,
      "since": null
    },
    "cards": [],
    "held": null,
    "verdict": "Nothing needs you. Nothing is broken.",
    "since": null,
    "launch": null,
    "building": [],
    "health": [],
    "healthNote": {
      "allWell": true,
      "protection": "Standard",
      "week": null
    },
    "safekeeping": null,
    "ideas": {
      "count": 0,
      "fresh": 0
    },
    "updated": "12:30",
    "usage": null,
    "finished": [],
    "incidents": [],
    "watcher": null,
    "missing": [],
    "view": "settings",
    "open": null,
    "settings": {
      "groups": [
        {
          "id": "stop",
          "title": "All stop",
          "note": "All stop halts the whole Crew at once. Only you can lift it.",
          "rows": [
            {
              "key": "builders",
              "label": "Crew",
              "value": "Working",
              "kind": "value"
            }
          ]
        },
        {
          "id": "project",
          "title": "This project",
          "note": "Only for this project. A pick changes it at once and counts as your confirmation; Undo stays for a minute. Protection and build commands need your password or a careful yes, so the First Mate asks for them.",
          "rows": [
            {
              "key": "autonomy",
              "label": "Autonomy",
              "value": "balanced",
              "kind": "select",
              "options": [
                {
                  "value": "cautious",
                  "label": "Cautious"
                },
                {
                  "value": "balanced",
                  "label": "Balanced"
                },
                {
                  "value": "trusting",
                  "label": "Trusting"
                }
              ]
            },
            {
              "key": "showFirst",
              "label": "Show before building",
              "value": "visual",
              "kind": "select",
              "options": [
                {
                  "value": "always",
                  "label": "Always"
                },
                {
                  "value": "visual",
                  "label": "Visual changes"
                },
                {
                  "value": "asked",
                  "label": "Only when asked"
                }
              ]
            },
            {
              "key": "milestones",
              "label": "Feature milestones",
              "value": "ask",
              "kind": "select",
              "options": [
                {
                  "value": "demos",
                  "label": "Midpoint demos"
                },
                {
                  "value": "to-the-end",
                  "label": "Run to the end"
                },
                {
                  "value": "ask",
                  "label": "Ask per feature"
                }
              ]
            },
            {
              "key": "pace",
              "label": "Crew at once",
              "value": "2",
              "kind": "select",
              "options": [
                {
                  "value": "1",
                  "label": "1"
                },
                {
                  "value": "2",
                  "label": "2"
                },
                {
                  "value": "3",
                  "label": "3"
                }
              ],
              "changed": {
                "at": "2026-11-04T01:29:30.000Z",
                "undo": true
              }
            },
            {
              "key": "efficiency",
              "label": "Thoroughness",
              "value": "balanced",
              "kind": "select",
              "options": [
                {
                  "value": "lightest",
                  "label": "Lightest: not ready yet"
                },
                {
                  "value": "lean",
                  "label": "Lean: not ready yet"
                },
                {
                  "value": "balanced",
                  "label": "Balanced"
                },
                {
                  "value": "thorough",
                  "label": "Thorough"
                }
              ]
            },
            {
              "key": "phase",
              "label": "Product phase",
              "value": "before-launch",
              "kind": "select",
              "options": [
                {
                  "value": "before-launch",
                  "label": "Before launch"
                },
                {
                  "value": "launched",
                  "label": "Launched"
                }
              ]
            },
            {
              "key": "cardsPerDay",
              "label": "Cards a day",
              "value": "3 cards a day",
              "kind": "value"
            },
            {
              "key": "windowsBuildCommands",
              "label": "Build commands on Windows",
              "value": "Ask",
              "kind": "change"
            },
            {
              "key": "budget",
              "label": "Budget",
              "value": "Report only",
              "kind": "value"
            },
            {
              "key": "protection",
              "label": "Protection",
              "value": "Ask the First Mate",
              "kind": "change"
            }
          ]
        },
        {
          "id": "you",
          "title": "You, in every project",
          "note": "These follow you to every project. Notifications and working hours are changed with the First Mate, which checks them with you.",
          "rows": [
            {
              "key": "presence",
              "label": "Availability",
              "value": "here",
              "kind": "select",
              "options": [
                {
                  "value": "here",
                  "label": "Here"
                },
                {
                  "value": "away-hours",
                  "label": "Away for 2 hours"
                },
                {
                  "value": "away-evening",
                  "label": "Away until 18:00"
                },
                {
                  "value": "away-morning",
                  "label": "Away until 09:00 tomorrow"
                },
                {
                  "value": "dnd-morning",
                  "label": "Do not disturb until 09:00 tomorrow"
                },
                {
                  "value": "dnd-open",
                  "label": "Do not disturb until I change it"
                }
              ]
            },
            {
              "key": "briefing",
              "label": "Briefing length",
              "value": "standard",
              "kind": "select",
              "options": [
                {
                  "value": "short",
                  "label": "Short"
                },
                {
                  "value": "standard",
                  "label": "Standard"
                },
                {
                  "value": "detailed",
                  "label": "Detailed"
                }
              ]
            },
            {
              "key": "briefingGapHours",
              "label": "Hours before a new briefing",
              "value": "2 hours",
              "kind": "change"
            },
            {
              "key": "explanations",
              "label": "Explanations",
              "value": "plain",
              "kind": "select",
              "options": [
                {
                  "value": "plain",
                  "label": "Plain"
                },
                {
                  "value": "some-terms",
                  "label": "Some technical terms"
                }
              ]
            },
            {
              "key": "usageMark",
              "label": "Usage nudge",
              "value": "75",
              "kind": "select",
              "options": [
                {
                  "value": "off",
                  "label": "Off"
                },
                {
                  "value": "50",
                  "label": "At 50%"
                },
                {
                  "value": "65",
                  "label": "At 65%"
                },
                {
                  "value": "75",
                  "label": "At 75%"
                },
                {
                  "value": "90",
                  "label": "At 90%"
                }
              ]
            },
            {
              "key": "boardTab",
              "label": "Logbook opens on",
              "value": "director",
              "kind": "select",
              "options": [
                {
                  "value": "director",
                  "label": "Captain"
                },
                {
                  "value": "build",
                  "label": "Build"
                }
              ]
            },
            {
              "key": "notifications",
              "label": "Notifications",
              "value": "claude",
              "kind": "change"
            },
            {
              "key": "hours",
              "label": "Working hours",
              "value": "no set hours",
              "kind": "change"
            }
          ]
        },
        {
          "id": "advanced",
          "title": "Advanced settings",
          "note": "",
          "rows": [
            {
              "key": "advanced",
              "label": "Advanced settings",
              "value": "",
              "kind": "change"
            }
          ]
        }
      ]
    }
  },
};
