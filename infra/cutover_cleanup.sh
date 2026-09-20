#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="gen-lang-client-0866395749"
REGION="asia-southeast1"
CONFIRM_CUTOVER=false
LEGACY_RUN_SERVICES=()
LEGACY_SQL_INSTANCES=()
LEGACY_REPOSITORY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --confirm-cutover)
            CONFIRM_CUTOVER=true
            shift
            ;;
        --project-id)
            PROJECT_ID="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --legacy-run-services)
            IFS=',' read -r -a LEGACY_RUN_SERVICES <<< "$2"
            shift 2
            ;;
        --legacy-sql-instances)
            IFS=',' read -r -a LEGACY_SQL_INSTANCES <<< "$2"
            shift 2
            ;;
        --legacy-repository)
            LEGACY_REPOSITORY="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [ "$CONFIRM_CUTOVER" != "true" ]; then
    echo "Error: Pass --confirm-cutover only after every ShipVerify release gate passes" >&2
    exit 1
fi

export CLOUDSDK_CORE_DISABLE_PROMPTS=1

echo "Verifying replacement services..."
for service in "classall-api" "classall-worker"; do
    READY=$(gcloud run services describe "$service" --region "$REGION" --project "$PROJECT_ID" --format="value(status.conditions[0].status)")
    if [ "$READY" != "True" ]; then
        echo "Error: $service is not ready; refusing legacy cleanup" >&2
        exit 1
    fi
done

BACKUP_BUCKET="${PROJECT_ID}-legacy-sql-backup"
if ! gcloud storage buckets describe "gs://$BACKUP_BUCKET" >/dev/null 2>&1; then
    echo "Creating backup bucket gs://$BACKUP_BUCKET..."
    gcloud storage buckets create "gs://$BACKUP_BUCKET" --location=us-central1 --uniform-bucket-level-access --project="$PROJECT_ID"
fi
gcloud storage buckets update "gs://$BACKUP_BUCKET" --lifecycle-file="infra/legacy-backup-lifecycle.json"

for instance in "${LEGACY_SQL_INSTANCES[@]}"; do
    if gcloud sql instances describe "$instance" --project "$PROJECT_ID" >/dev/null 2>&1; then
        SQL_SA=$(gcloud sql instances describe "$instance" --project "$PROJECT_ID" --format="value(serviceAccountEmailAddress)")
        gcloud storage buckets add-iam-policy-binding "gs://$BACKUP_BUCKET" \
            --member="serviceAccount:$SQL_SA" --role="roles/storage.objectAdmin" >/dev/null
        DATABASES=$(gcloud sql databases list --instance="$instance" --project="$PROJECT_ID" --filter="name!=postgres AND name!=template0 AND name!=template1" --format="value(name)")
        for db in $DATABASES; do
            OBJECT="gs://$BACKUP_BUCKET/${instance}-${db}.sql.gz"
            echo "Exporting SQL $instance / $db to $OBJECT..."
            gcloud sql export sql "$instance" "$OBJECT" --database="$db" --offload --project="$PROJECT_ID"
        done
    fi
done

for service in "${LEGACY_RUN_SERVICES[@]}"; do
    if [ -n "$service" ]; then
        SERVICE_REGION=$(gcloud run services describe "$service" --project="$PROJECT_ID" --format="value(metadata.labels.'cloud.googleapis.com/location')")
        echo "Deleting legacy Run service $service..."
        gcloud run services delete "$service" --region="$SERVICE_REGION" --project="$PROJECT_ID" --quiet
    fi
done

for instance in "${LEGACY_SQL_INSTANCES[@]}"; do
    if [ -n "$instance" ]; then
        echo "Deleting legacy SQL instance $instance..."
        gcloud sql instances delete "$instance" --project="$PROJECT_ID" --quiet
    fi
done

if [ -n "$LEGACY_REPOSITORY" ]; then
    echo "Archiving legacy repository $LEGACY_REPOSITORY..."
    gh repo archive "$LEGACY_REPOSITORY" --yes
fi

echo "Legacy services removed. SQL exports remain private for seven days, then expire."
