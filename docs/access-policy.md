# Shared workspace access

All Telegram users may start the bot, request help, create cases, upload documents, submit cases, and use general assistance. All users with a valid Firebase sign-in for this project may use the website's shared Gmail cases, reports, and review actions. Website sign-in does not write reviewer records and is not controlled by the old reviewers allowlist.

Operational website settings and Gmail connection administration require the boolean Firebase custom claim `admin: true`. A string such as `"true"` does not grant access. Administrator status must be provisioned by an authorized project operator; the first person to sign in never receives it automatically. Claim changes take effect when a fresh ID token is obtained; sign out and back in after provisioning. Existing ID tokens can remain valid until expiration.

Telegram operations commands use the explicitly configured private administrator chat. Public `/week` requests direct users to the website's authenticated knowledge base without returning a report or direct document link. Public `/notifications` and `/email_limit` requests do not reveal or change operational settings. Normal bot use has no chat allowlist. Group membership does not grant administrative settings access.

New weekly reports use the existing blob store and authenticated website preview. Core aggregation, classification, extraction, processing, and repository code is unchanged. Previously public Google Docs require a separate permission audit and removal of their `anyone` grants; deploying code does not revoke an existing share link.

The application intentionally remains a shared operational workspace, not a tenant-isolated service. Signed-in users can see shared cases and reports. Finding 1, including the `/ask` ownerless-case behavior, is explicitly excluded from this work.

Inbox defaults exclude application-classified spam. Spam remains accessible through the Spam filter and an explicit view of all types including spam.

Production workers retain Cloud Run IAM and additionally verify Google OIDC tokens against the service audience and the route's authorized service-account email. Pub/Sub and Scheduler identities are distinct; local/test workers retain their existing behavior.
