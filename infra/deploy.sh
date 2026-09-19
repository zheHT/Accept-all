#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-gen-lang-client-0866395749}"
REGION="${2:-asia-southeast1}"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

REQUIRED_SECRETS=(
    "telegram-bot-token"
    "telegram-webhook-secret"
    "grader-ingest-key"
    "gmail-oauth-client-json"
    "gmail-address"
    "telegram-admin-chat-id"
)

echo "Checking required secrets..."
for secret in "${REQUIRED_SECRETS[@]}"; do
    VERSION=$(gcloud secrets versions list "$secret" --project "$PROJECT_ID" --filter="state=ENABLED" --limit=1 --format="value(name)")
    if [ -z "$VERSION" ]; then
        echo "Error: Secret $secret has no enabled version" >&2
        exit 1
    fi
done

COMMIT=$(git rev-parse --short HEAD)
echo "Submitting Cloud Build with tag $COMMIT..."
gcloud builds submit --project "$PROJECT_ID" --config infra/cloudbuild.yaml --substitutions="_TAG=$COMMIT,_REGION=$REGION" .

API_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/classall/classall-api:${COMMIT}"
WORKER_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/classall/classall-worker:${COMMIT}"

COMMON_ENV="APP_ENV=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,REGION=${REGION},FIRESTORE_DATABASE=(default),GCS_BUCKET=${PROJECT_ID}-classall-docs,DOC_TASKS_TOPIC=doc-tasks,GMAIL_EVENTS_TOPIC=gmail-events,DASHBOARD_BASE_URL=https://classall-review-0866395749.web.app"
SECRETS_CONFIG="TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_WEBHOOK_SECRET=telegram-webhook-secret:latest,TELEGRAM_ADMIN_CHAT_ID=telegram-admin-chat-id:latest,GRADER_INGEST_KEY=grader-ingest-key:latest,GMAIL_OAUTH_CLIENT_JSON=gmail-oauth-client-json:latest,GMAIL_ADDRESS=gmail-address:latest"

echo "Deploying classall-worker..."
gcloud run deploy classall-worker \
    --image "$WORKER_IMAGE" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --service-account="classall-worker@${PROJECT_ID}.iam.gserviceaccount.com" \
    --no-allow-unauthenticated \
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

echo "Registering Telegram webhook..."
TOKEN=$(gcloud secrets versions access latest --secret=telegram-bot-token --project="$PROJECT_ID")
WEBHOOK_SECRET=$(gcloud secrets versions access latest --secret=telegram-webhook-secret --project="$PROJECT_ID")

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
    -d "url=${API_URL}/api/telegram-webhook" \
    -d "secret_token=${WEBHOOK_SECRET}" \
    -d 'allowed_updates=["message","callback_query"]' \
    -d "drop_pending_updates=true" >/dev/null

echo "Configuring and deploying Firebase..."
APP_ID=$(firebase apps:list WEB --project "$PROJECT_ID" --json | grep -B 2 -A 5 '"displayName": "ClassAll Reviewer"' | grep '"appId"' | head -n 1 | sed -E 's/.*"appId": "([^"]+)".*/\1/')
SDK_CONFIG=$(firebase apps:sdkconfig WEB "$APP_ID" --project "$PROJECT_ID" --json)

export VITE_API_BASE_URL="$API_URL"
export VITE_FIREBASE_API_KEY=$(echo "$SDK_CONFIG" | grep '"apiKey"' | head -n 1 | sed -E 's/.*"apiKey": "([^"]+)".*/\1/')
export VITE_FIREBASE_AUTH_DOMAIN=$(echo "$SDK_CONFIG" | grep '"authDomain"' | head -n 1 | sed -E 's/.*"authDomain": "([^"]+)".*/\1/')
export VITE_FIREBASE_PROJECT_ID=$(echo "$SDK_CONFIG" | grep '"projectId"' | head -n 1 | sed -E 's/.*"projectId": "([^"]+)".*/\1/')
export VITE_FIREBASE_APP_ID="$APP_ID"

npm ci --prefix frontend
npm run build --prefix frontend
firebase deploy --project "$PROJECT_ID" --only hosting,firestore:rules,firestore:indexes

echo "Deployment finished successfully!"
echo "API_URL=$API_URL"
echo "WORKER_URL=$WORKER_URL"
echo "Run the Gmail OAuth connection from the reviewer dashboard, then execute:"
echo "gcloud scheduler jobs run gmail-watch-renewal --location=$REGION --project=$PROJECT_ID"
