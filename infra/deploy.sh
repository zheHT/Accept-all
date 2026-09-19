#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-gen-lang-client-0866395749}"
REGION="${2:-asia-southeast1}"
GMAIL_RECONCILE_SCHEDULE="${GMAIL_RECONCILE_SCHEDULE:-0 * * * *}"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

REQUIRED_SECRETS=(
    "grader-ingest-key"
    "app-signing-secret"
)

echo "Checking required secrets..."
for secret in "${REQUIRED_SECRETS[@]}"; do
    VERSION=$(gcloud secrets versions list "$secret" --project "$PROJECT_ID" --filter="state=ENABLED" --limit=1 --format="value(name)" 2>/dev/null)
    if [ -z "$VERSION" ]; then
        echo "Error: Secret $secret has no enabled version in project $PROJECT_ID" >&2
        exit 1
    fi
done

COMMIT=$(git rev-parse --short HEAD)
echo "Submitting Cloud Build with tag $COMMIT..."
gcloud builds submit --project "$PROJECT_ID" --config infra/cloudbuild.yaml --substitutions="_TAG=$COMMIT,_REGION=$REGION" .

API_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/classall/classall-api:${COMMIT}"
WORKER_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/classall/classall-worker:${COMMIT}"

COMMON_ENV="APP_ENV=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,REGION=${REGION},FIRESTORE_DATABASE=(default),GCS_BUCKET=${PROJECT_ID}-classall-docs,DOC_TASKS_TOPIC=doc-tasks,GMAIL_EVENTS_TOPIC=gmail-events,GMAIL_RECONCILE_SCHEDULE=${GMAIL_RECONCILE_SCHEDULE},DASHBOARD_BASE_URL=https://classall-review-0866395749.web.app"
SECRETS_CONFIG="GRADER_INGEST_KEY=grader-ingest-key:latest,APP_SIGNING_SECRET=app-signing-secret:latest"
for optional_secret in telegram-bot-token telegram-webhook-secret telegram-admin-chat-id gmail-oauth-client-json gmail-address; do
    VERSION=$(gcloud secrets versions list "$optional_secret" --project "$PROJECT_ID" --filter="state=ENABLED" --limit=1 --format="value(name)" 2>/dev/null)
    if [ -n "$VERSION" ]; then
        ENV_NAME=$(echo "$optional_secret" | tr '[:lower:]-' '[:upper:]_')
        SECRETS_CONFIG="${SECRETS_CONFIG},${ENV_NAME}=${optional_secret}:latest"
    fi
done

echo "Ensuring Secret Accessor permissions for Cloud Run service accounts..."
for sa in "classall-api" "classall-worker"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor" --condition=None >/dev/null 2>&1 || true
done

echo "Deploying classall-worker..."
gcloud run deploy classall-worker \
    --image "$WORKER_IMAGE" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --service-account="classall-worker@${PROJECT_ID}.iam.gserviceaccount.com" \
    --no-allow-unauthenticated \
    --memory=1Gi \
    --timeout=600 \
    --concurrency=4 \
    --max-instances=10 \
    --set-env-vars="$COMMON_ENV" \
    --set-secrets="$SECRETS_CONFIG"

echo "Deploying classall-api..."
gcloud run deploy classall-api \
    --image "$API_IMAGE" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --service-account="classall-api@${PROJECT_ID}.iam.gserviceaccount.com" \
    --allow-unauthenticated \
    --memory=1Gi \
    --timeout=300 \
    --concurrency=40 \
    --max-instances=5 \
    --set-env-vars="$COMMON_ENV" \
    --set-secrets="$SECRETS_CONFIG"

API_URL=$(gcloud run services describe classall-api --region "$REGION" --project "$PROJECT_ID" --format="value(status.url)")
WORKER_URL=$(gcloud run services describe classall-worker --region "$REGION" --project "$PROJECT_ID" --format="value(status.url)")

gcloud run services update classall-api --region "$REGION" --project "$PROJECT_ID" \
    --update-env-vars="GMAIL_OAUTH_REDIRECT_URI=${API_URL}/api/integrations/gmail/oauth/callback,API_BASE_URL=${API_URL}" >/dev/null

gcloud run services add-iam-policy-binding classall-worker --region "$REGION" --project "$PROJECT_ID" \
    --member="serviceAccount:classall-pubsub-invoker@${PROJECT_ID}.iam.gserviceaccount.com" --role="roles/run.invoker" >/dev/null

gcloud run services add-iam-policy-binding classall-worker --region "$REGION" --project "$PROJECT_ID" \
    --member="serviceAccount:classall-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" --role="roles/run.invoker" >/dev/null

if ! gcloud pubsub subscriptions describe doc-tasks-worker --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating subscription doc-tasks-worker..."
    gcloud pubsub subscriptions create doc-tasks-worker --project "$PROJECT_ID" \
        --topic=doc-tasks \
        --push-endpoint="${WORKER_URL}/internal/pubsub/doc-task" \
        --push-auth-service-account="classall-pubsub-invoker@${PROJECT_ID}.iam.gserviceaccount.com" \
        --ack-deadline=600 \
        --dead-letter-topic=doc-dead-letter \
        --max-delivery-attempts=5
fi

if ! gcloud pubsub subscriptions describe gmail-events-worker --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating subscription gmail-events-worker..."
    gcloud pubsub subscriptions create gmail-events-worker --project "$PROJECT_ID" \
        --topic=gmail-events \
        --push-endpoint="${WORKER_URL}/internal/pubsub/gmail-event" \
        --push-auth-service-account="classall-pubsub-invoker@${PROJECT_ID}.iam.gserviceaccount.com" \
        --ack-deadline=600 \
        --dead-letter-topic=doc-dead-letter \
        --max-delivery-attempts=5
fi

PUBSUB_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
gcloud pubsub topics add-iam-policy-binding doc-dead-letter --project "$PROJECT_ID" \
    --member="serviceAccount:$PUBSUB_SERVICE_AGENT" --role="roles/pubsub.publisher" >/dev/null

for sub in "doc-tasks-worker" "gmail-events-worker"; do
    gcloud pubsub subscriptions add-iam-policy-binding "$sub" --project "$PROJECT_ID" \
        --member="serviceAccount:$PUBSUB_SERVICE_AGENT" --role="roles/pubsub.subscriber" >/dev/null
done

echo "Configuring Cloud Scheduler jobs..."
if gcloud scheduler jobs describe gmail-hourly-reconciliation --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http gmail-hourly-reconciliation --location "$REGION" --project "$PROJECT_ID" \
        --schedule="$GMAIL_RECONCILE_SCHEDULE" --time-zone="Asia/Kuala_Lumpur" --uri="${WORKER_URL}/internal/cron/gmail-reconcile" \
        --http-method=POST --oidc-service-account-email="classall-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
else
    gcloud scheduler jobs create http gmail-hourly-reconciliation --location "$REGION" --project "$PROJECT_ID" \
        --schedule="$GMAIL_RECONCILE_SCHEDULE" --time-zone="Asia/Kuala_Lumpur" --uri="${WORKER_URL}/internal/cron/gmail-reconcile" \
        --http-method=POST --oidc-service-account-email="classall-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
fi

if gcloud scheduler jobs describe gmail-watch-renewal --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http gmail-watch-renewal --location "$REGION" --project "$PROJECT_ID" \
        --schedule="0 3 * * *" --time-zone="Asia/Kuala_Lumpur" --uri="${WORKER_URL}/internal/cron/gmail-watch" \
        --http-method=POST --oidc-service-account-email="classall-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
else
    gcloud scheduler jobs create http gmail-watch-renewal --location "$REGION" --project "$PROJECT_ID" \
        --schedule="0 3 * * *" --time-zone="Asia/Kuala_Lumpur" --uri="${WORKER_URL}/internal/cron/gmail-watch" \
        --http-method=POST --oidc-service-account-email="classall-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
fi

if gcloud scheduler jobs describe weekly-case-summary --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud scheduler jobs update http weekly-case-summary --location "$REGION" --project "$PROJECT_ID" \
        --schedule="0 9 * * 1" --time-zone="Asia/Kuala_Lumpur" --uri="${WORKER_URL}/api/cron/summary" \
        --http-method=GET --oidc-service-account-email="classall-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
else
    gcloud scheduler jobs create http weekly-case-summary --location "$REGION" --project "$PROJECT_ID" \
        --schedule="0 9 * * 1" --time-zone="Asia/Kuala_Lumpur" --uri="${WORKER_URL}/api/cron/summary" \
        --http-method=GET --oidc-service-account-email="classall-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
fi

if gcloud secrets versions list telegram-bot-token --project "$PROJECT_ID" --filter="state=ENABLED" --limit=1 --format="value(name)" | grep -q .; then
    echo "Registering Telegram webhook and updating bot profile..."
    TOKEN=$(gcloud secrets versions access latest --secret=telegram-bot-token --project="$PROJECT_ID")
    WEBHOOK_SECRET=$(gcloud secrets versions access latest --secret=telegram-webhook-secret --project="$PROJECT_ID")

    curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
        -d "url=${API_URL}/api/telegram-webhook" \
        -d "secret_token=${WEBHOOK_SECRET}" \
        -d 'allowed_updates=["message","callback_query"]' \
        -d "drop_pending_updates=true" >/dev/null

    curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setMyCommands" \
        -H "Content-Type: application/json" \
        -d '{"commands":[{"command":"start","description":"Welcome & agent overview"},{"command":"newcase","description":"Create new document triage case"},{"command":"submit","description":"Submit case token for verification"},{"command":"help","description":"Show 7-field verification guide"}]}' >/dev/null

    curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setMyDescription" \
        -H "Content-Type: application/json" \
        -d '{"description":"ClassAll is an intelligent maritime shipping document triage and reconciliation agent. Upload Shipping Instructions (SI) and draft Bills of Lading (BL) to automatically detect discrepancies across 7 verified fields, review alerts, and coordinate email responses."}' >/dev/null

    curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setMyShortDescription" \
        -H "Content-Type: application/json" \
        -d '{"short_description":"ClassAll Maritime Shipping Document Triage & SI/BL Discrepancy Verification Agent."}' >/dev/null
fi

echo "Configuring and deploying Firebase..."
APP_ID=$(firebase apps:list WEB --project "$PROJECT_ID" --json | grep -B 2 -A 5 '"displayName": "ClassAll Reviewer"' | grep '"appId"' | head -n 1 | sed -E 's/.*"appId": "([^"]+)".*/\1/')
SDK_CONFIG=$(firebase apps:sdkconfig WEB "$APP_ID" --project "$PROJECT_ID" --json)

export NEXT_PUBLIC_API_URL="$API_URL"
export NEXT_PUBLIC_FIREBASE_API_KEY=$(echo "$SDK_CONFIG" | grep '"apiKey"' | head -n 1 | sed -E 's/.*"apiKey": "([^"]+)".*/\1/')
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$(echo "$SDK_CONFIG" | grep '"authDomain"' | head -n 1 | sed -E 's/.*"authDomain": "([^"]+)".*/\1/')
export NEXT_PUBLIC_FIREBASE_PROJECT_ID=$(echo "$SDK_CONFIG" | grep '"projectId"' | head -n 1 | sed -E 's/.*"projectId": "([^"]+)".*/\1/')
export NEXT_PUBLIC_FIREBASE_APP_ID="$APP_ID"

npm ci --prefix frontend
npm run build --prefix frontend
firebase deploy --project "$PROJECT_ID" --only hosting,firestore:rules,firestore:indexes

echo "Deployment finished successfully!"
echo "API_URL=$API_URL"
echo "WORKER_URL=$WORKER_URL"
echo "Run the Gmail OAuth connection from the reviewer dashboard, then execute:"
echo "gcloud scheduler jobs run gmail-watch-renewal --location=$REGION --project=$PROJECT_ID"
