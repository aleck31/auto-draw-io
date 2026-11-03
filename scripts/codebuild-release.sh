#!/usr/bin/env bash
# Builds the release image natively on ARM with AWS CodeBuild and pushes <version> and latest to ECR.
#
#   scripts/codebuild-release.sh            # build and push
#   scripts/codebuild-release.sh --deploy        # then sync the runtime config, restart the deployment, check the new image runs
#   scripts/codebuild-release.sh --config-only   # only sync the runtime config and restart if it changed; no build
#   scripts/codebuild-release.sh --config-diff   # only list the config keys that would change
#
# Builds the committed HEAD (git archive), so uncommitted changes are refused. The version is package.json's.
# Creates the CodeBuild project and its IAM role on first use and keeps them in sync on later runs.
# Settings come from the environment, or from .dev/release.env (RELEASE_ENV) when present:
#   SOURCE_BUCKET    (required for a build) S3 bucket for the source zip; it is deleted after the build
#   AWS_PROFILE, AWS_REGION, ECR_REPO (default: auto-draw-io), SOURCE_PREFIX, CODEBUILD_PROJECT, CODEBUILD_ROLE
#   K8S_NAMESPACE, K8S_DEPLOYMENT   (required to deploy), K8S_CONFIGMAP, K8S_SECRET (default <deployment>-config/-secret)
# Runtime config: DEPLOY_ENV (default .env.deploy) is the only source of the pod's environment. Keys whose name
# contains KEY, TOKEN, SECRET, PASSWORD or ACCESS_CODE go to the Secret, the rest to the ConfigMap; keys absent
# from the file are removed from the cluster. Secret values are compared by hash and never printed.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
RELEASE_ENV="${RELEASE_ENV:-.dev/release.env}"
# shellcheck disable=SC1090
[ -f "$RELEASE_ENV" ] && source "$RELEASE_ENV"

DEPLOY=false
CONFIG_MODE=""
for arg in "$@"; do
    case "$arg" in
        --deploy) DEPLOY=true ;;
        --config-only) CONFIG_MODE=apply ;;
        --config-diff) CONFIG_MODE=diff ;;
        -h | --help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown argument: $arg" >&2; exit 2 ;;
    esac
done

DEPLOY_ENV="${DEPLOY_ENV:-.env.deploy}"
log() { echo "[release] $*"; }
# Temporary files of the run (the split config holds secrets in plain text), removed on any exit
RUN_TMP=$(mktemp -d)
chmod 700 "$RUN_TMP"
trap 'rm -rf "$RUN_TMP"' EXIT

# --- Runtime config: DEPLOY_ENV -> ConfigMap + Secret ------------------------
SECRET_NAME_RE='KEY|TOKEN|SECRET|PASSWORD|ACCESS_CODE'
# Inlined by `next build`, so setting them on the pod does nothing
BUILD_TIME_RE='^(AUTO_BASE_PATH|DRAWIO_WAR_PATH|NEXT_PUBLIC_[A-Z0-9_]*)$'

# "KEY<TAB>sha256(value)" for each key of a ConfigMap or Secret in the cluster
cluster_key_hashes() {
    kubectl get "$1" "$2" -n "$K8S_NAMESPACE" -o json 2>/dev/null | node -e '
        const o = JSON.parse(require("fs").readFileSync(0, "utf8")), c = require("crypto")
        for (const [k, v] of Object.entries(o.data || {})) {
            const value = o.kind === "Secret" ? Buffer.from(v, "base64") : v
            console.log(k + "\t" + c.createHash("sha256").update(value).digest("hex"))
        }' || true
}
# "KEY<TAB>sha256(value)" for each line of a KEY=value file
file_key_hashes() {
    node -e '
        const c = require("crypto")
        for (const line of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
            const i = line.indexOf("=")
            if (i > 0) console.log(line.slice(0, i) + "\t" + c.createHash("sha256").update(line.slice(i + 1)).digest("hex"))
        }' "$1"
}
# Lists added (+), changed (~) and removed (-) key names; returns 1 when nothing differs
report_changes() {
    local kind=$1 name=$2 file=$3 changes
    changes=$(LC_ALL=C join -t $'\t' -a1 -a2 -e '' -o 0,1.2,2.2 \
        <(cluster_key_hashes "$kind" "$name" | LC_ALL=C sort) <(file_key_hashes "$file" | LC_ALL=C sort) |
        awk -F'\t' '$2 == "" {print "  + " $1} $3 == "" {print "  - " $1} $2 != "" && $3 != "" && $2 != $3 {print "  ~ " $1}')
    [ -n "$changes" ] || return 1
    log "$kind/$name:"
    echo "$changes"
}

# $1 = diff | apply. Sets CONFIG_CHANGED=true when the cluster differed from DEPLOY_ENV.
sync_runtime_config() {
    CONFIG_CHANGED=false
    : "${K8S_NAMESPACE:?Set K8S_NAMESPACE}"
    : "${K8S_DEPLOYMENT:?Set K8S_DEPLOYMENT}"
    [ -f "$DEPLOY_ENV" ] || { echo "$DEPLOY_ENV not found: it defines the deployment's environment" >&2; exit 1; }
    local configmap="${K8S_CONFIGMAP:-$K8S_DEPLOYMENT-config}" secret="${K8S_SECRET:-$K8S_DEPLOYMENT-secret}"
    local dir="$RUN_TMP/config"
    mkdir -p "$dir"
    fail() { echo "$1" >&2; exit 1; }
    # Drop comments, blank lines, "export " and quotes around the value, as dotenv does
    sed -E -e '/^[[:space:]]*(#|$)/d' -e 's/^[[:space:]]*export[[:space:]]+//' \
        -e 's/^([A-Za-z_][A-Za-z0-9_]*)=(["'\''])(.*)\2[[:space:]]*$/\1=\3/' "$DEPLOY_ENV" >"$dir/all.env"
    if grep -vqE '^[A-Za-z_][A-Za-z0-9_]*=' "$dir/all.env"; then
        fail "$DEPLOY_ENV has lines that are not KEY=value: $(grep -vE '^[A-Za-z_][A-Za-z0-9_]*=' "$dir/all.env" | cut -c1-20 | tr '\n' ' ')"
    fi
    if cut -d= -f1 "$dir/all.env" | grep -qE "$BUILD_TIME_RE"; then
        fail "$DEPLOY_ENV sets build-time variables, which do nothing on the pod: $(cut -d= -f1 "$dir/all.env" | grep -E "$BUILD_TIME_RE" | tr '\n' ' ')"
    fi
    grep -E "^[^=]*($SECRET_NAME_RE)[^=]*=" "$dir/all.env" >"$dir/secret.env" || true
    grep -vE "^[^=]*($SECRET_NAME_RE)[^=]*=" "$dir/all.env" >"$dir/config.env" || true

    report_changes configmap "$configmap" "$dir/config.env" && CONFIG_CHANGED=true
    report_changes secret "$secret" "$dir/secret.env" && CONFIG_CHANGED=true
    if [ "$CONFIG_CHANGED" = false ]; then
        log "Runtime config matches $DEPLOY_ENV"
    elif [ "$1" = apply ]; then
        kubectl create configmap "$configmap" -n "$K8S_NAMESPACE" --from-env-file="$dir/config.env" \
            --dry-run=client -o yaml | kubectl apply -f - >/dev/null
        kubectl create secret generic "$secret" -n "$K8S_NAMESPACE" --from-env-file="$dir/secret.env" \
            --dry-run=client -o yaml | kubectl apply -f - >/dev/null
        log "Runtime config applied from $DEPLOY_ENV"
    fi
}

restart_deployment() {
    kubectl rollout restart "deployment/$K8S_DEPLOYMENT" -n "$K8S_NAMESPACE"
    kubectl rollout status "deployment/$K8S_DEPLOYMENT" -n "$K8S_NAMESPACE" --timeout=300s
}

if [ -n "$CONFIG_MODE" ]; then
    sync_runtime_config "$CONFIG_MODE"
    if [ "$CONFIG_MODE" = apply ] && [ "$CONFIG_CHANGED" = true ]; then restart_deployment; fi
    exit 0
fi
# Fail before the build, not after it
if [ "$DEPLOY" = true ]; then sync_runtime_config diff; fi

: "${SOURCE_BUCKET:?Set SOURCE_BUCKET (or put it in $RELEASE_ENV)}"
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
ECR_REPO="${ECR_REPO:-auto-draw-io}"
SOURCE_PREFIX="${SOURCE_PREFIX:-codebuild/$ECR_REPO}"
PROJECT="${CODEBUILD_PROJECT:-$ECR_REPO-build-arm64}"
ROLE="${CODEBUILD_ROLE:-$ECR_REPO-codebuild-role}"
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION"
[ -n "${AWS_PROFILE:-}" ] && export AWS_PROFILE

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
ZIP="$RUN_TMP/source.zip"
cleanup() {
    rm -rf "$RUN_TMP"
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
    sync_runtime_config apply
    restart_deployment
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
