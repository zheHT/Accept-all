#!/usr/bin/env python3
from __future__ import annotations

import argparse

from google.cloud import firestore


def main() -> int:
    parser = argparse.ArgumentParser(description="Grant dashboard access to a Firebase Auth UID")
    parser.add_argument("firebase_uid")
    parser.add_argument("--email", required=True)
    parser.add_argument("--project", default="gen-lang-client-0866395749")
    args = parser.parse_args()

    firestore.Client(project=args.project).collection("reviewers").document(args.firebase_uid).set(
        {"enabled": True, "email": args.email}, merge=True
    )
    print(f"Reviewer access granted for {args.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
