# SDOC Hackathon Evaluation & Scoring Guide

> [!NOTE]
> **Evaluation vs. Production Architecture Separation**
> This evaluation guide and its CLI tools (`scripts/eval_inbox.py`, `loader.py`) interact strictly with the isolated `backend.evaluation_adapter` package.
> They are designed exclusively for benchmark evaluation against the hackathon test harness and ground truth datasets.
> They are **never deployed to production** and are completely decoupled from the production Cloud Run microservices (`backend.api` and `backend.worker`), Google Cloud Storage, Firestore database, and the Next.js reviewer dashboard.

This guide explains how to evaluate the Maritime Shipping Email Classifier & Triage Agent against the SDOC Hackathon reference dataset (`D:\Downloads\sdoc-hackathon-docker`) and submit predictions to the scoring engine.

---

## 1. Submission Schema & Expected Format

The evaluation server scores submissions against a private ground-truth file (`ground_truth.json`). The expected payload is a JSON dictionary keyed by `email_id`:

```json
{
  "email_001": {
    "category": "BL_COMPARISON",
    "status": "OK",
    "has_defect": false,
    "defect_fields": [],
    "review_reason": null
  },
  "email_002": {
    "category": "INVOICE_QUERY",
    "status": "OK",
    "has_defect": false,
    "defect_fields": [],
    "review_reason": null
  },
  "email_004": {
    "category": "BL_COMPARISON",
    "status": "NEEDS_REVIEW",
    "has_defect": null,
    "defect_fields": [],
    "review_reason": "missing_attachment"
  }
}
```

### Schema Rules & Category Mapping
| Platform Category | Server Scored Category | Description |
| :--- | :--- | :--- |
| `DOCUMENT_COMPARISON` | `BL_COMPARISON` | Emails containing or referencing SI & draft BL for cross-check |
| `NEW_SI_REQUEST` | `SI_REQUEST` | New shipping instructions for booking/filing |
| `INVOICE_QUERY` | `INVOICE_QUERY` | Freight invoices, demurrage, payment receipts, disputes |
| `GENERAL` | `GENERAL` | Operational inquiries, vessel schedules, general updates |
| `SPAM` | `SPAM` | Marketing solicitations, promotions, phishing |

### Status & Reliability Flags
- `status`: `"OK"`, `"MISMATCH"`, or `"NEEDS_REVIEW"`
- `has_defect`: `true` if `status == "MISMATCH"`, `false` if `status == "OK"`, `null` if `status == "NEEDS_REVIEW"`
- `review_reason`: `"missing_attachment"`, `"wrong_doc_type"`, `"unreadable"`, or `"missing_value"` (used on the Reliability diagnostic axis)
- `defect_fields`: List of mismatched fields (e.g. `["consignee_name", "seal_number"]`)

---

## 2. Running the Evaluation Server

The reference scoring server is located at `D:\Downloads\sdoc-hackathon-docker`.

### Option A: Using Docker (Recommended if Docker Desktop is running)
From `D:\Downloads\sdoc-hackathon-docker`:
```bash
docker compose up --build
# Serves on http://localhost:8080
```

Endpoints exposed:
- `GET  /health` - Liveness probe & email count
- `GET  /emails` - List all inbox emails (unlabeled)
- `GET  /emails/{email_id}` - Get individual email
- `GET  /attachments/{path}` - Download attachment (SI / BL / PDF / DOCX / TXT)
- `GET  /sample_submission` - Output shape specification
- `POST /submit` - Grade submission JSON and return scoreboard

### Option B: Running Without Docker (Directly via Python / Uvicorn)
In PowerShell or Terminal:
```powershell
$env:DATA_DIR = "D:\Downloads\sdoc-hackathon-docker\data_v2"
$env:GROUND_TRUTH = "D:\Downloads\sdoc-hackathon-docker\data_v2\ground_truth.json"
uv run uvicorn --app-dir "D:\Downloads\sdoc-hackathon-docker\server" app:app --port 8080
```

---

## 3. How to Submit Predictions

### Method 1: Automated End-to-End Evaluation (`eval_inbox.py`)

The repository includes an evaluation runner in [`scripts/eval_inbox.py`](file:///d:/agentic_ai_project/classall-platform/scripts/eval_inbox.py). It automatically connects to the server, runs Vertex AI live inference on GCP, maps categories, saves the output, and calls `POST /submit`:

```bash
# Evaluate all emails from the server and auto-submit:
uv run python scripts/eval_inbox.py --source http://localhost:8080 --server-compat --output submission.json

# Evaluate a small subset (e.g., first 10 emails) to test quickly:
uv run python scripts/eval_inbox.py --source http://localhost:8080 --server-compat --max 10 --output test_sub.json
```

---

### Method 2: Calling `inbox.submit` via Python

Using the [`loader.py`](file:///d:/agentic_ai_project/classall-platform/loader.py) SDK:

```python
import json
from loader import Inbox

# Connect to the HTTP scoring server
inbox = Inbox("http://localhost:8080")

# 1. Fetch email records over HTTP
all_emails = inbox.emails()
print(f"Loaded {len(all_emails)} emails from server.")

# 2. Prepare your submission dictionary
submission = {}
for email in all_emails:
    email_id = email["email_id"]
    submission[email_id] = {
        "category": "BL_COMPARISON",
        "status": "OK",
        "has_defect": False,
        "defect_fields": [],
        "review_reason": None,
    }

# 3. Submit directly to /submit endpoint and print scoreboard
scoreboard = inbox.submit(submission)
print(json.dumps(scoreboard, indent=2))
```

---

### Method 3: Direct HTTP `POST /submit` with `curl`

If you have already generated a `submission.json` file:

```bash
curl -X POST http://localhost:8080/submit \
  -H "Content-Type: application/json" \
  -d @submission.json
```

---

### Method 4: Offline CLI Scoring (`score_cli.py`)

If the HTTP server is not running, you can grade any submission directly against `ground_truth.json`:

```bash
# 1. Run classifier on local data folder:
uv run python scripts/eval_inbox.py --source "D:\Downloads\sdoc-hackathon-docker\data_v2" --server-compat --output submission.json

# 2. Score offline via score_cli.py:
uv run python "D:\Downloads\sdoc-hackathon-docker\server\score_cli.py" submission.json --ground-truth "D:\Downloads\sdoc-hackathon-docker\data_v2\ground_truth.json" --json
```

---

## 4. Scoreboard Metrics Explained

When `/submit` or `score_cli.py` is invoked, the scoring engine produces metrics across 4 axes:

```json
{
  "stage1": {
    "accuracy": 0.95,
    "macro_f1": 0.94,
    "per": { ... },
    "confusion": { ... }
  },
  "stage3": {
    "defect_precision": 0.96,
    "defect_recall": 0.92,
    "defect_f1": 0.94,
    "field_f1": 0.91,
    "exact_match_rate": 0.88
  },
  "reliability": {
    "escalation_recall": 0.90,
    "escalation_precision": 0.88,
    "per_reason": { ... }
  },
  "end_to_end": {
    "success": 42,
    "total": 46,
    "rate": 0.913
  },
  "final_score": 0.925
}
```

- **Stage 1 (Classification)** (Weight: 30%): Macro-F1 across the 5 categories.
- **Stage 3 (Defect Detection)** (Weight: 20%): Defect F1 for comparable documents.
- **Reliability (Diagnostic)**: Correct escalation of unreadable files, missing attachments, and corrupt documents to `NEEDS_REVIEW`.
- **End-to-End (Headline Metric)** (Weight: 50%): Percentage of defect emails that were correctly routed to `BL_COMPARISON` **and** had their exact discrepancy fields identified.
