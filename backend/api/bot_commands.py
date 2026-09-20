"""Canonical public command menu consumed by the API and deployment."""

import json

COMMANDS = [
    {"command": "start", "description": "Welcome & agent capabilities"},
    {"command": "newcase", "description": "Create a new document triage case"},
    {"command": "submit", "description": "Submit case token for verification"},
    {"command": "help", "description": "Show commands & verification guide"},
    {"command": "notifications", "description": "Manage operational alerts (admin)"},
    {"command": "email_limit", "description": "Set reconciliation limit (admin)"},
    {"command": "week", "description": "Open weekly reports on the website"},
    {"command": "ask", "description": "Ask about a case"},
]


if __name__ == "__main__":
    print(json.dumps({"commands": COMMANDS}))
