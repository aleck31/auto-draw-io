#!/usr/bin/env bash
# Builds the release image natively on ARM with AWS CodeBuild and pushes <version> and latest to ECR.
#
#   scripts/codebuild-release.sh            # build and push
#   scripts/codebuild-release.sh --deploy   # then restart the Kubernetes deployment and check it runs the new image
#
# Builds the committed HEAD (git archive), so uncommitted changes are refused. The version is package.json's.
# Creates the CodeBuild project and its IAM role on first use and keeps them in sync on later runs.
# Settings come from the environment, or from .dev/release.env (RELEASE_ENV) when present:
#   SOURCE_BUCKET    (required) S3 bucket for the source zip; it is deleted after the build
#   AWS_PROFILE, AWS_REGION, ECR_REPO (default: auto-draw-io), SOURCE_PREFIX, CODEBUILD_PROJECT, CODEBUILD_ROLE
#   K8S_NAMESPACE, K8S_DEPLOYMENT   (required for --deploy)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
RELEASE_ENV="${RELEASE_ENV:-.dev/release.env}"
# shellcheck disable=SC1090
[ -f "$RELEASE_ENV" ] && source "$RELEASE_ENV"

DEPLOY=false
for arg in "$@"; do
    case "$arg" in
        --deploy) DEPLOY=true ;;
        -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown argument: $arg" >&2; exit 2 ;;
    esac
done

: "${SOURCE_BUCKET:?Set SOURCE_BUCKET (or put it in $RELEASE_ENV)}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ECR_REPO="${ECR_REPO:-auto-draw-io}"
SOURCE_PREFIX="${SOURCE_PREFIX:-codebuild/$ECR_REPO}"
PROJECT="${CODEBUILD_PROJECT:-$ECR_REPO-build-arm64}"
ROLE="${CODEBUILD_ROLE:-$ECR_REPO-codebuild-role}"
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
[ -n "${AWS_PROFILE:-}" ] && export AWS_PROFILE

log() { echo "[release] $*"; }

if [ -n "$(git status --porcelain)" ]; then
    echo "Uncommitted changes: commit them first (the build uses HEAD)." >&2
    git status --short >&2
    exit 1
fi
VERSION=$(node -p "require('./package.json').version")
COMMIT=$(git rev-parse --short HEAD)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
log "Version $VERSION ($COMMIT) -> $REGISTRY/$ECR_REPO, account $ACCOUNT, region $AWS_REGION"

aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null

# --- IAM role: least privilege for this project ------------------------------
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"codebuild.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
POLICY=$(cat <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"],
  "Resource":"arn:aws:logs:$AWS_REGION:$ACCOUNT:log-group:/aws/codebuild/$PROJECT*"},
 {"Effect":"Allow","Action":["s3:GetObject","s3:GetObjectVersion"],
  "Resource":"arn:aws:s3:::$SOURCE_BUCKET/$SOURCE_PREFIX/*"},
 {"Effect":"Allow","Action":"ecr:GetAuthorizationToken","Resource":"*"},
 {"Effect":"Allow","Action":["ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart",
  "ecr:CompleteLayerUpload","ecr:PutImage","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"],
  "Resource":"arn:aws:ecr:$AWS_REGION:$ACCOUNT:repository/$ECR_REPO"}
]}
EOF
)
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
    log "Creating IAM role $ROLE"
    aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" \
        --description "CodeBuild: build $ECR_REPO images and push them to ECR" >/dev/null
    NEW_ROLE=true
else
    NEW_ROLE=false
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name "$ECR_REPO-build" --policy-document "$POLICY"
ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)

# --- CodeBuild project ------------------------------------------------------
ENVIRONMENT='{"type":"ARM_CONTAINER","image":"aws/codebuild/amazonlinux-aarch64-standard:4.0","computeType":"BUILD_GENERAL1_LARGE","privilegedMode":true}'
SOURCE="{\"type\":\"S3\",\"location\":\"$SOURCE_BUCKET/$SOURCE_PREFIX/source.zip\",\"buildspec\":\"deploy/codebuild/buildspec.yml\"}"
PROJECT_ARGS=(--name "$PROJECT" --source "$SOURCE" --artifacts type=NO_ARTIFACTS
    --environment "$ENVIRONMENT" --service-role "$ROLE_ARN" --timeout-in-minutes 30
    --description "Build $ECR_REPO for arm64 and push to ECR (scripts/codebuild-release.sh)")
if [ "$(aws codebuild batch-get-projects --names "$PROJECT" --query 'length(projects)' --output text)" = "0" ]; then
    log "Creating CodeBuild project $PROJECT"
    # A new role takes a few seconds before CodeBuild accepts it
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if aws codebuild create-project "${PROJECT_ARGS[@]}" >/dev/null 2>/tmp/codebuild-create.err; then break; fi
        if [ "$NEW_ROLE" = true ] && grep -q "not authorized to perform\|InvalidInputException" /tmp/codebuild-create.err && [ "$attempt" -lt 10 ]; then
            sleep 6
            continue
        fi
        cat /tmp/codebuild-create.err >&2
        exit 1
    done
else
    aws codebuild update-project "${PROJECT_ARGS[@]}" >/dev/null
fi

# --- Source and build -------------------------------------------------------
KEY="$SOURCE_PREFIX/$VERSION-$COMMIT-$(date +%s).zip"
ZIP=$(mktemp --suffix=.zip)
cleanup() {
    rm -f "$ZIP"
    aws s3 rm "s3://$SOURCE_BUCKET/$KEY" --only-show-errors || true
}
trap cleanup EXIT
git archive --format=zip -o "$ZIP" HEAD
aws s3 cp "$ZIP" "s3://$SOURCE_BUCKET/$KEY" --only-show-errors
log "Source uploaded ($(du -h "$ZIP" | cut -f1))"

BUILD_ID=$(aws codebuild start-build --project-name "$PROJECT" \
    --source-type-override S3 --source-location-override "$SOURCE_BUCKET/$KEY" \
    --environment-variables-override \
        "name=IMAGE_TAG,value=$VERSION" "name=ECR_REGISTRY,value=$REGISTRY" "name=ECR_REPO,value=$ECR_REPO" \
    --query build.id --output text)
log "Build $BUILD_ID started"

START=$(date +%s)
LAST_PHASE=""
while :; do
    read -r STATUS PHASE <<<"$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].[buildStatus,currentPhase]' --output text)"
    if [ "$PHASE" != "$LAST_PHASE" ]; then
        log "$(($(date +%s) - START))s: $PHASE"
        LAST_PHASE="$PHASE"
    fi
    [ "$STATUS" != "IN_PROGRESS" ] && break
    sleep 10
done

if [ "$STATUS" != "SUCCEEDED" ]; then
    log "Build $STATUS. Last log lines:"
    read -r GROUP STREAM <<<"$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].logs.[groupName,streamName]' --output text)"
    aws logs get-log-events --log-group-name "$GROUP" --log-stream-name "$STREAM" --limit 40 \
        --query 'events[].message' --output text | tr '\t' '\n' | sed 's/^/  /'
    exit 1
fi

DIGEST=$(aws ecr describe-images --repository-name "$ECR_REPO" --image-ids imageTag="$VERSION" \
    --query 'imageDetails[0].imageDigest' --output text)
LATEST=$(aws ecr describe-images --repository-name "$ECR_REPO" --image-ids imageTag=latest \
    --query 'imageDetails[0].imageDigest' --output text)
[ "$DIGEST" = "$LATEST" ] || { echo "latest ($LATEST) is not $VERSION ($DIGEST)" >&2; exit 1; }
log "Pushed $ECR_REPO:$VERSION and :latest ($DIGEST) in $(($(date +%s) - START))s"

# --- Deploy ------------------------------------------------------------------
if [ "$DEPLOY" = true ]; then
    : "${K8S_NAMESPACE:?Set K8S_NAMESPACE for --deploy}"
    : "${K8S_DEPLOYMENT:?Set K8S_DEPLOYMENT for --deploy}"
    kubectl rollout restart "deployment/$K8S_DEPLOYMENT" -n "$K8S_NAMESPACE"
    kubectl rollout status "deployment/$K8S_DEPLOYMENT" -n "$K8S_NAMESPACE" --timeout=300s
    SELECTOR=$(kubectl get deployment "$K8S_DEPLOYMENT" -n "$K8S_NAMESPACE" \
        -o go-template='{{range $k,$v := .spec.selector.matchLabels}}{{$k}}={{$v}},{{end}}')
    RUNNING=$(kubectl get pods -n "$K8S_NAMESPACE" -l "${SELECTOR%,}" --field-selector=status.phase=Running \
        -o jsonpath='{range .items[*]}{.status.containerStatuses[0].imageID}{"\n"}{end}' | sort -u)
    if ! grep -q "$DIGEST" <<<"$RUNNING"; then
        echo "Running pods are not on $DIGEST:" >&2
        echo "$RUNNING" >&2
        exit 1
    fi
    log "Deployed: $K8S_NAMESPACE/$K8S_DEPLOYMENT runs $DIGEST"
fi
