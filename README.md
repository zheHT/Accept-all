# monash-averis-hackathon
# Class All

> Autonomous shipping document classification, multimodal extraction, and deterministic verification for digital logistics operations.
> 
> 

Developed for the **Monash-Averis Hackathon**, **Class All** streamlines logistics triage by processing incoming shipping emails, classifying intent, extracting key document fields via multimodal LLMs, and performing strict, rule-based cross-checks between Shipping Instructions (SI) and Bills of Lading (BL).

---

## Key Features

* **Semantic Triage & Categorization**: Filters and classifies incoming emails into 5 locked categories (`DOCUMENT_COMPARISON`, `NEW_SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM`) using Gemini 1.5 Flash.
* **Multimodal Data Extraction**: Extracts 7 core logistics fields (`shipper`, `consignee`, `notify_party`, `port_of_loading`, `port_of_discharge`, `container_count`, `gross_weight_kg`) from PDFs, scanned documents, and plain text with automatic normalization.
* **Deterministic Validation Engine**: Zero-hallucination, pure Python logic for field-by-field verification with strict tolerance handling.
* **Human-in-the-Loop Review**: Real-time discrepancy alerts pushed to Telegram with interactive inline buttons (`[ APPROVE ]` / `[ MANUAL CHECK ]`), coupled with a side-by-side comparison dashboard built in React.
* **Automated Grading Pipeline**: Direct integration with hackathon grading and evaluation endpoints.

---

## System Architecture

The solution uses a decoupled architecture deployed on Google Cloud Platform:

```
[ Email Feed / Grading API ] ──> Ingest Script
                                      │
                                      ▼
[ React TS Dashboard ] ◄───► [ Cloud Run (FastAPI) ] ◄───► [ Telegram Bot ]
(Firebase Hosting)                    │
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
           [ Vertex AI / Gemini ]            [ Cloud Firestore ]
         - Classifier Agent                  - shipping_cases
         - Extractor Agent                   - audit_logs
         - Deterministic Validator

```

---

## Repository Structure

```text
monash-averis-hackathon/
├── frontend/                     # React + TypeScript + Tailwind CSS UI
│   ├── src/
│   │   ├── api.ts                # API client connecting to Cloud Run backend
│   │   ├── components/           # Side-by-side inspector & badge components
│   │   └── pages/                # Inbox and Case Detail routes
│   └── package.json
│
├── backend/                      # FastAPI Backend & AI Pipeline
│   ├── api/
│   │   ├── routes_processing.py  # POST /api/process (Pipeline entrypoint)
│   │   ├── routes_cases.py       # GET /api/cases, POST /api/resolve
│   │   └── routes_telegram.py    # POST /api/telegram-webhook, GET /api/cron/summary
│   ├── models/
│   │   ├── ai_schemas.py         # Pydantic schemas (EmailClassification, ExtractedDocument)
│   │   └── api_schemas.py        # Dashboard & grading request/response schemas
│   ├── agents/
│   │   ├── classifier.py         # Gemini prompt & semantic routing
│   │   └── extractor.py          # Multimodal SI/BL extraction logic
│   ├── engine/
│   │   └── validator.py          # Deterministic Python comparison engine
│   ├── services/
│   │   ├── db_service.py         # Firestore CRUD operations
│   │   └── telegram_service.py   # Telegram webhook & alerting dispatch
│   ├── Dockerfile
│   ├── requirements.txt
│   └── main.py
│
├── docs/
│   └── skills.md                 # Agent skill definitions and schemas
└── ingest.py                     # Local grading and evaluation loop

```

---

## Core Pipeline & Validation Logic

1. **Classification**: Ingests raw email text and headers, executing a few-shot Gemini prompt constrained by `EmailClassification`.
2. **Extraction**: If classified as `DOCUMENT_COMPARISON`, the multimodal extractor maps SI and BL documents to `ExtractedDocument`:
* Normalizes non-standard values (e.g., `"3 x 40HC"` $\rightarrow$ `3`, `"22 MT"` $\rightarrow$ `22000.0`).


3. **Deterministic Comparison**:
* Compares all 7 normalized fields between SI and BL.
* If values match: `has_defect = False`, `defect_fields = []`.
* If values mismatch: `has_defect = True`, logs fields to `defect_fields`.
* If attachments are illegible or mandatory fields are null: bypasses comparison and marks status as `NEEDS_REVIEW` with an explicit `review_reason`.


4. **Resolution**: Discrepancies fire webhooks to Telegram and mark records in Firestore for manual review via the frontend dashboard.

---

## Getting Started

### Prerequisites

* Python 3.11+
* Node.js 18+ & npm
* Google Cloud SDK (`gcloud`)
* Firebase CLI (`firebase-tools`)

### Backend Setup

1. **Navigate to the backend directory and set up a virtual environment**:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

```


2. **Environment Variables**:
Create a `.env` file in `/backend`:
```env
PROJECT_ID=your-gcp-project-id
REGION=asia-southeast1
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id
GOOGLE_APPLICATION_CREDENTIALS=gcp-credentials.json

```


3. **Run Backend Locally**:
```bash
uvicorn main:app --host 0.0.0.0 --port 8080 --reload

```



### Frontend Setup

1. **Navigate to the frontend directory**:
```bash
cd frontend
npm install

```


2. **Configure Environment**:
Create a `.env` file in `/frontend`:
```env
VITE_API_BASE_URL=http://localhost:8080

```


3. **Run Frontend Locally**:
```bash
npm run dev

```



---

## Deployment

### Cloud Run (Backend)

```bash
cd backend
gcloud run deploy sdoc-backend \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated

```

### Firebase Hosting (Frontend)

```bash
cd frontend
npm run build
firebase deploy --only hosting

```

### Telegram Webhook Registration

Register your deployed Cloud Run endpoint with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_CLOUD_RUN_URL>/api/telegram-webhook"

