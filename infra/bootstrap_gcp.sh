#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-gen-lang-client-0866395749}"
REGION="${2:-asia-southeast1}"

export CLOUDSDK_CORE_DISABLE_PROMPTS=1
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
BUCKET="${PROJECT_ID}-classall-docs"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "Enabling GCP APIs for project $PROJECT_ID..."
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    aiplatform.googleapis.com \
    firestore.googleapis.com \
    secretmanager.googleapis.com \
    pubsub.googleapis.com \
    cloudscheduler.googleapis.com \
    storage.googleapis.com \
    gmail.googleapis.com \
    firebase.googleapis.com \
    identitytoolkit.googleapis.com \
    iamcredentials.googleapis.com \
    docs.googleapis.com \
    drive.googleapis.com \
    --project "$PROJECT_ID"

if ! gcloud artifacts repositories describe classall --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating Artifact Registry repository..."
    gcloud artifacts repositories create classall --repository-format docker --location "$REGION" --project "$PROJECT_ID"
fi

if ! gcloud firestore databases describe --database="(default)" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating Firestore default database..."
    gcloud firestore databases create --database="(default)" --location="$REGION" --type=firestore-native --project "$PROJECT_ID"
fi

if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
    echo "Creating Cloud Storage bucket gs://$BUCKET..."
    gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --project="$PROJECT_ID"
fi
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="infra/bucket-lifecycle.json"

SERVICE_ACCOUNTS=(
    "classall-api:ClassAll public API"
    "classall-worker:ClassAll private worker"
    "classall-pubsub-invoker:ClassAll PubSub invoker"
    "classall-scheduler:ClassAll Scheduler invoker"
)

for entry in "${SERVICE_ACCOUNTS[@]}"; do
    SA_NAME="${entry%%:*}"
    SA_DISPLAY="${entry#*:}"
    SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
    if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
        echo "Creating service account $SA_NAME..."
        gcloud iam service-accounts create "$SA_NAME" --display-name="$SA_DISPLAY" --project "$PROJECT_ID"
    else
        gcloud iam service-accounts update "$SA_EMAIL" --display-name="$SA_DISPLAY" --project "$PROJECT_ID" >/dev/null
    fi
done

SECRETS=(
    "telegram-bot-token"
    "telegram-webhook-secret"
    "grader-ingest-key"
    "app-signing-secret"
    "gmail-oauth-client-json"
    "gmail-oauth-refresh-token"
    "gmail-address"
    "telegram-admin-chat-id"
)

for secret in "${SECRETS[@]}"; do
    if ! gcloud secrets describe "$secret" --project "$PROJECT_ID" >/dev/null 2>&1; then
        echo "Creating secret $secret..."
        gcloud secrets create "$secret" --replication-policy=automatic --project "$PROJECT_ID"
    fi
done

TOPICS=("doc-tasks" "gmail-events" "doc-dead-letter")
for topic in "${TOPICS[@]}"; do
    if ! gcloud pubsub topics describe "$topic" --project "$PROJECT_ID" >/dev/null 2>&1; then
        echo "Creating Pub/Sub topic $topic..."
        gcloud pubsub topics create "$topic" --project "$PROJECT_ID"
    fi
done

if ! gcloud pubsub subscriptions describe doc-dead-letter-hold --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Creating dead-letter subscription..."
    gcloud pubsub subscriptions create doc-dead-letter-hold --topic=doc-dead-letter --message-retention-duration=7d --expiration-period=never --project "$PROJECT_ID"
fi

gcloud pubsub topics add-iam-policy-binding gmail-events --project "$PROJECT_ID" \
    --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" --role="roles/pubsub.publisher" >/dev/null

# API Roles
for role in "roles/datastore.user" "roles/pubsub.publisher" "roles/storage.objectAdmin"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:classall-api@${PROJECT_ID}.iam.gserviceaccount.com" --role="$role" --condition=None >/dev/null
done

# Worker Roles
for role in "roles/datastore.user" "roles/aiplatform.user" "roles/storage.objectAdmin" "roles/pubsub.publisher"; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:classall-worker@${PROJECT_ID}.iam.gserviceaccount.com" --role="$role" --condition=None >/dev/null
done

# Secret Accessor Roles
for sa in "classall-api" "classall-worker"; do
    for secret in "${SECRETS[@]}"; do
        gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" \
            --member="serviceAccount:${sa}@${PROJECT_ID}.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" >/dev/null
    done
done

gcloud secrets add-iam-policy-binding gmail-oauth-refresh-token --project "$PROJECT_ID" \
    --member="serviceAccount:classall-api@${PROJECT_ID}.iam.gserviceaccount.com" --role="roles/secretmanager.secretVersionAdder" >/dev/null

PUBSUB_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "classall-pubsub-invoker@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project "$PROJECT_ID" --member="serviceAccount:$PUBSUB_SERVICE_AGENT" --role="roles/iam.serviceAccountTokenCreator" >/dev/null

if ! firebase projects:list --json 2>/dev/null | grep -q "\"$PROJECT_ID\""; then
    echo "Adding Firebase to project $PROJECT_ID..."
    firebase projects:addfirebase "$PROJECT_ID"
fi

if ! firebase hosting:sites:list --project "$PROJECT_ID" --json 2>/dev/null | grep -q "shipverify-0866395749"; then
    echo "Creating Firebase Hosting site..."
    firebase hosting:sites:create shipverify-0866395749 --project "$PROJECT_ID"
fi

if ! firebase apps:list WEB --project "$PROJECT_ID" --json 2>/dev/null | grep -q "ClassAll Reviewer"; then
    echo "Creating Firebase Web App..."
    firebase apps:create WEB "ClassAll Reviewer" --project "$PROJECT_ID"
fi

echo "Bootstrap complete. Add external credential versions before running infra/deploy.sh."
echo "The Gmail refresh-token version is created later by the OAuth callback."
