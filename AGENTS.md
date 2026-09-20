# Project Guidelines & Deployment Reference

## Security Best Practices
> [!IMPORTANT]
> **Never commit secrets, raw tokens, project IDs, or live service hashes into public files or git-tracked documentation.**
> Use environment variables or retrieve them dynamically from Google Cloud CLI / Secret Manager.

---

## Deployment Procedures

### Option 1: Deploy Everything with 1 Command (Recommended)
Deploy Backend + Frontend + Telegram Bot all at once:

```bash
bash infra/deploy.sh [PROJECT_ID] [REGION]
```

---

### Option 2: Deploy Step-by-Step

#### Step 1: Deploy Backend (Cloud Run)
Build and deploy the API and Worker containers:

```powershell
# Set configuration variables dynamically
$PROJECT_ID = (gcloud config get-value project)
$REGION = "asia-southeast1"

# 1. Build images in Cloud Build
gcloud builds submit --config=infra/cloudbuild.yaml "--substitutions=_REGION=$REGION,_TAG=latest" .

# 2. Deploy API service
gcloud run deploy classall-api `
    --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/classall/classall-api:latest" `
    --region=$REGION

# 3. Deploy Worker service
gcloud run deploy classall-worker `
    --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/classall/classall-worker:latest" `
    --region=$REGION
```

#### Step 2: Deploy Frontend (Website)
Build the Next.js app and publish to Firebase Hosting:

```powershell
cd frontend
npm ci
npm run build
cd ..
firebase deploy --only hosting
```

- Access your frontend at the Firebase Hosting URL output in the CLI.

#### Step 3: Connect the Telegram Bot AI
Link Telegram to your backend webhook dynamically:

```powershell
$PROJECT_ID = (gcloud config get-value project)
$REGION = "asia-southeast1"

# Dynamically query API service URL and Secret Manager values
$API_URL = (gcloud run services describe classall-api --region $REGION --format="value(status.url)")
$token = (gcloud secrets versions access latest --secret=telegram-bot-token --project=$PROJECT_ID).Trim()
$secret = (gcloud secrets versions access latest --secret=telegram-webhook-secret --project=$PROJECT_ID).Trim()

# Set the webhook URL
Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setWebhook" -Method Post -Body (@{
    url = "$API_URL/api/telegram-webhook"
    secret_token = $secret
} | ConvertTo-Json) -ContentType "application/json"
```

- **Telegram Bot**: Open Telegram and chat with your configured bot.
- **Webhook Endpoint**: `$API_URL/api/telegram-webhook`
