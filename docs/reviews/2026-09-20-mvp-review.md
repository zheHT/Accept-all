# MVP code review and improvement plan

Reviewed 20 September 2026. Scope: production API, ingestion, worker, extraction, Gmail/Telegram workflows, frontend data loading and review UI, deployment configuration, and existing tests. This is a review, not an implementation change or a live deployment audit.

The working tree changed during inspection. Findings below describe the inspected code; concurrent API/Telegram approval changes were rechecked and are not reported as outstanding approval bugs. The shared signed-in workspace is intentional per `docs/access-policy.md`, not an accidental missing tenant boundary.

## Priority findings

### 1. P1 — Publishing before marking a case queued can lose its processing task

Location: `backend/core/ingestion.py:127`; the Telegram `/submit` path in `backend/api/main.py` has the same ordering.

The task is published while the case is still `DRAFT`. A fast worker declines its lease, returns normally, and the HTTP endpoint acknowledges the message. Ingestion then marks the case `QUEUED`, although its delivery has already completed.

Reproduced with an immediate in-memory publisher: worker observed `DRAFT`; final case state was `QUEUED`, with no processing performed. [Pub/Sub documents that a successful HTTP response acknowledges delivery](https://docs.cloud.google.com/pubsub/docs/push).

Minimum fix: persist a processable state after all documents are stored and before publishing; make publication retryable without resetting a worker's newer state. Cover both ingestion and Telegram submission.

### 2. P1 — Processing failures retain a lease and the next retry can acknowledge unfinished work

Locations: `backend/core/processing.py:55`, `backend/core/repository.py` lease methods, `backend/worker/main.py` document-task route.

Downloads occur outside the processing exception handler. Extraction service failures can also escape because only `ModelRoutingError` is caught. The lease remains active. A retry during that lease returns the `PROCESSING` case normally, producing HTTP 200 and potentially ending redelivery.

Reproduced: injected a storage error; the second attempt returned `PROCESSING` without a second download attempt.

Minimum fix: distinguish completed work from a busy lease, release/requeue failed attempts, and return a retryable response while unfinished work lacks a durable recovery path. Use an attempt token/version so an expired worker cannot overwrite a newer attempt. Expose exhausted/stuck jobs and an effective retry action.

### 3. P1 — Extraction client configuration does not match the deployment

Locations: `backend/extraction/extractor_flow.py:32`, `backend/core/inference.py`, `infra/deploy.sh:37`.

Classification explicitly configures Vertex AI. Document extraction uses bare `genai.Client()`. The deployment supplies project/location but neither an API key nor the SDK backend-selection flag. A fresh deployment using this configuration can classify successfully and fail when extraction begins. This failure also reaches finding 2.

Reproduced the bare-client construction with a cleared environment: `ValueError: No API key was provided`. Live Cloud Run environment was not inspected.

Minimum fix: initialize extraction with the same explicit backend/project/location settings as classification. Test client construction under the deployment environment without relying on a developer's `.env`.

### 4. P1 — Saving a Gmail draft removes attachments and reply headers

Location: `backend/core/gmail.py:311`; called by the API draft-update endpoint.

Creation constructs a MIME message with attachments and `In-Reply-To`/`References`. Updating builds a new message containing only recipient, subject, and body. The application still retains attachment names, so the UI can claim documents are attached after they have been removed.

Reproduced by inspecting both outgoing MIME payloads: attachment count changed from 1 to 0; `In-Reply-To` changed from the original message ID to absent.

Minimum fix: preserve the existing MIME parts and threading headers when editing text. Test the serialized MIME, not only a fake client's subject/body fields. [Gmail's draft update API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/update) accepts the replacement draft message.

### 5. P1 — Email can be sent successfully but remain READY in the application

Location: API draft-send endpoint in `backend/api/main.py`; Telegram send has the same external-side-effect ordering.

The case version is checked, Gmail sends the message, then a version-checked database update records `SENT`. A concurrent mutation or database failure after sending can leave the application reporting failure even though the recipient received the email.

Reproduced a concurrent case update during the fake Gmail send: HTTP 500, one send invocation, stored draft state still `READY`.

Minimum fix: claim a send operation atomically before delivery, block conflicting edits, and record/reconcile ambiguous delivery outcomes. Do not blindly resend after an uncertain response. Include recipient and attachment identity in the reviewed snapshot; the current hash covers only subject/body.

### 6. P1 — Send correction can send older text than the editor displays

Locations: `frontend/src/components/review/review-detail.tsx:876`, `frontend/src/components/review/review-view.tsx` delivery handler.

The editor keeps unsaved subject/body in local state. Send remains enabled and uses the saved case's hash; it never saves or checks those local edits. Editing a message and immediately pressing Send therefore sends the previous saved version. Save/send also lack mutual in-flight exclusion.

Minimum fix: require saving before sending, show an unsaved indicator, and disable conflicting actions while a mutation is pending. The sent content must match the content the reviewer sees.

### 7. P1 — Inbox and Review silently stop at 50 cases

Locations: `frontend/src/lib/api.ts` `getInbox`/`getReviews`, their corresponding view components.

Both helpers request only the first page and discard the opportunity to follow `next_cursor`. Show more only expands the locally loaded array. Search, oldest-first sorting, counts, and deep links therefore omit older cases. New incoming cases can keep old unresolved cases outside the visible review queue.

Reproduced the API boundary with 51 unresolved cases: 50 items and a non-empty next cursor. The frontend has no caller that consumes that cursor for these views.

Minimum fix: wire the existing cursor into list loading. Fetch a linked case independently of the first page. Ensure search/filter scope is clear; for a growing inbox, perform those operations before server pagination.

### 8. P2 — Live views do not poll, and refresh failures can be hidden

Locations: `frontend/src/lib/use-live-query.ts:19`, Inbox/Review/Cases/Dashboard and workspace-count consumers.

The hook defaults to no polling and callers omit an interval. Dashboard cards, queue rows, and persistent sidebar counters remain stale until remount/manual refresh. In addition, the refresh callback closes over the initial `data` value because it depends only on caller-provided dependencies. With `[]`, a later failure still sees `data === null`, so the stale-data banner is not enabled. Inbox refresh can then show a success toast because the hook swallows errors.

Minimum fix: enable bounded visible-tab polling for operational views, refresh shared counters after actions, and track current data/request state without a stale closure. Report refresh success only after a successful request.

### 9. P2 — Displayed AI confidence is invented or defaults to 100%

Locations: `backend/api/views.py:129`, `backend/core/processing.py:235`, `backend/core/schemas.py` extracted-field defaults.

The summary invents values such as 0.96 for OK cases and 0.88 for a single mismatch. Hybrid extraction produces no field confidence but converts values into fields whose confidence defaults to 1.0. Detail averaging can consequently show 100% confidence without such evidence from the model. This can mislead reviewers and makes the threshold control's meaning unclear.

Reproduced: an OK result without any score produces summary confidence 0.96.

Minimum fix: retain actual classification confidence separately and display unavailable extraction confidence honestly. Do not label a status-derived heuristic as model confidence or create artificial per-field scores.

### 10. P2 — Multiple candidate SI/BL documents are silently reduced to the first pair

Location: `backend/core/processing.py:215`.

`selected.setdefault` chooses the first SI and first BL. Additional conflicting revisions are ignored, unlike the older validation path that rejects ambiguous counts. An arbitrary pair can yield OK while another supplied revision disagrees. Routing and persistence also key by filename, which is not unique across attachments.

Minimum fix: require one unambiguous pair or route the case for explicit selection. Use the existing document IDs for identity; do not invent automatic revision selection for the MVP.

### 11. P2 — Blank required values can pass deterministic validation

Location: `backend/extraction/validator.py:45` and `backend/extraction/schemas.py`.

Missing-value detection checks only `None`. Pydantic accepts empty strings. Two documents with blank shipper values therefore compare equal and return OK, even though the prompt asks the model to return null for missing values.

Reproduced an otherwise complete SI/BL pair with `shipper=''`: status was `OK`.

Minimum fix: normalize empty/whitespace and defined missing markers at the extraction boundary. Validate numeric domains as well. Prompt instructions alone are insufficient for a required-field guarantee.

### 12. P2 — Late detail responses can replace the currently selected item

Locations: `frontend/src/components/inbox/inbox-view.tsx:101`, `frontend/src/components/review/review-view.tsx:104`.

Detail requests are neither aborted nor guarded against a changed selection. Open case A, return to the list, open B, then let A's slow request finish: Review can hold B as the selected row with A as `activeDetail`. Some actions use `activeDetail` directly. Inbox can similarly reopen a closed drawer when its outstanding request completes.

Minimum fix: abort obsolete detail loads or check the requested ID before applying the response. Key the review editor by case ID so local field/editor state does not carry into another case.

### 13. P2 — The newest 5,000 cases are treated as the whole database

Locations: `backend/api/main.py` case cache, `backend/core/knowledge_publisher.py:63`.

Lists, dashboard totals, unresolved work, and historical weekly reports are computed after fetching only the latest 5,000 records. Older unresolved cases and older report periods disappear once enough newer cases exist. Fetching full case documents also moves growing email bodies/history through list queries.

Minimum fix: use bounded Firestore queries by period/status with database cursors and compact list records. Until implemented, make the cap explicit instead of presenting partial totals as complete. This can follow correctness fixes if MVP volume remains below the cap.

## Concurrent working-tree observations

During concurrent edits, `frontend/src/lib/api.ts` temporarily lacked a closing brace around error handling and the API temporarily failed to import. Both were subsequently fixed: the final Node TypeScript transform-mode syntax check passed, and the later API import succeeded. These transient observations are not counted as outstanding findings. Full frontend typechecking/build verification remains unavailable with the missing local dependencies.

## Product decisions and useful MVP enhancements

- **Define what the seven fields verify.** README promises party addresses/contact details, while `backend/skills/extractor.md` explicitly extracts company names only and excludes addresses. Choose the operational contract and align the UI, prompt, documentation, and fixtures. An address-only mismatch is currently outside extraction scope.
- **Decide the weight precision contract.** Extraction currently requires integer kilograms; 1,234.5 kg is rejected. This matches the existing extraction design but is narrower than many operational inputs. Preserve the evaluator contract if required and explicitly decide the production policy.
- **Make recovery visible.** Show processing error, attempt count, last progress time, and a safe retry control. Add a small operational view for stuck jobs, expired Gmail authorization/watch, and unsent correction drafts.
- **Improve review efficiency.** Provide next unresolved field/case, clear saved/unsaved feedback, and keyboard-friendly actions. Keep source evidence, human corrections, and final case disposition visibly distinct.
- **Unify deployment configuration and terminology.** Remove hardcoded project/hosting identifiers from tracked defaults; fix outdated reviewer-allowlist, polling, test-count, and local-path claims in README. Choose one product name across ClassAll and ShipVerify.
- **Keep known access work explicit.** `/ask` still permits a case without an owner to be addressed by any chat that knows its ID. The access-policy document expressly deferred this behavior. Decide it before exposing ownerless case identifiers beyond the shared website; do not silently change the intended shared website policy.

## Implementation sequence

| Step | Scope | Completion checks |
| --- | --- | --- |
| 1. Establish a buildable baseline | Finish current edits; restore frontend dependencies; repair outdated evaluator test paths/expectations; generate test corpus explicitly | API/worker import, frontend tests/typecheck/lint/build, cleanly classified backend test failures |
| 2. Make processing reliable | Findings 1–3; distinguish terminal success, retryable failures, and busy leases | Immediate delivery during ingest; transient download/extraction failure; retry during lease; stale worker completion; production-style SDK initialization |
| 3. Make email delivery safe | Findings 4–6; shared send rules for website and Telegram | Attachments/thread headers survive edits; unsaved edits cannot be sent; concurrent save/send; post-send persistence failure; changed recipient |
| 4. Make operational views complete and current | Findings 7, 8, 12 | More than 50 cases; old-case deep link; search across pages; visible/hidden-tab polling; failed refresh; slow A/fast B selection; counters after resolution |
| 5. Make verification claims trustworthy | Findings 9–11; decide address and weight scope | Unknown confidence stays unknown; blank fields require review; duplicate document roles require selection; representative domain fixtures |
| 6. Extend retention and operational visibility | Finding 13, stuck-work view, deployment/documentation cleanup | Old unresolved case remains findable beyond 5,000 records; historical report counts are complete; operator can diagnose/retry a failed job |

No new framework or broad architectural rewrite is needed for the first five steps. Reuse the existing repositories, cursor protocol, API client, and shared document viewer.

## Verification performed and limits

- Existing Python suite, using the available bundled Python and existing local dependency directories: **209 passed, 12 failed, 4 errors**. This run preceded some concurrent edits and is not a final certification of the subsequently changed tree.
- Four setup errors reference removed `backend.agents.classifier_flow` instead of the evaluation adapter. Two failures require absent generated `data/ground_truth.json`. Other failures involve evaluator attachment/classifier contracts and lifecycle expectations; they need triage, not blanket suppression.
- Offline targeted checks reproduced publication ordering, retained-lease retry, lost draft attachments/reply headers, post-send version conflict, pagination, blank-field validation, invented confidence, and bare extraction-client initialization. No live email was sent.
- Frontend test/typecheck/lint commands could not start because the local Vitest, TypeScript, and ESLint modules were missing. A separate final Node TypeScript transform-mode syntax check passed for `api.ts`; this is not a full typecheck or build.
- No live cloud configuration, production data, browser layout/accessibility session, deployment, or end-to-end Gmail/Telegram delivery was tested. Repository source files were not changed by this review; only this report and ignored test-temporary files were created.
