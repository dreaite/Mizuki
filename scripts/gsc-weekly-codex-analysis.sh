#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/output/gsc"
PROMPT_FILE="$ROOT_DIR/scripts/prompts/gsc-weekly-analysis.md"
LOCK_DIR="$OUTPUT_DIR/.weekly-analysis.lock"

PNPM_BIN="${PNPM_BIN:-pnpm}"
CODEX_BIN="${CODEX_BIN:-codex}"

mkdir -p "$OUTPUT_DIR/logs" "$OUTPUT_DIR/analysis"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
	echo "GSC weekly Codex analysis is already running."
	exit 0
fi

cleanup() {
	rmdir "$LOCK_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

if [ "${DRY_RUN:-}" = "1" ]; then
	echo "Would run: $PNPM_BIN gsc:weekly"
	echo "Would run: $CODEX_BIN exec -C $ROOT_DIR -s read-only -a never -o <analysis-file> - < $PROMPT_FILE"
	exit 0
fi

RUN_LOG="$OUTPUT_DIR/logs/run-$(date -u +%Y%m%dT%H%M%SZ).log"
exec >> "$RUN_LOG" 2>&1

echo "[$(date -Is)] Starting GSC weekly report refresh"
"$PNPM_BIN" gsc:weekly

WEEK_LABEL="$(
	sed -n 's/^# GSC Weekly Report - //p' "$OUTPUT_DIR/latest.md" | head -n 1
)"
if [ -z "$WEEK_LABEL" ]; then
	WEEK_LABEL="$(date -u +%G-W%V)"
fi

ANALYSIS_FILE="$OUTPUT_DIR/analysis/$WEEK_LABEL.md"
LATEST_ANALYSIS_FILE="$OUTPUT_DIR/analysis/latest.md"

echo "[$(date -Is)] Starting Codex analysis for $WEEK_LABEL"
"$CODEX_BIN" exec \
	-C "$ROOT_DIR" \
	-s read-only \
	-a never \
	-o "$ANALYSIS_FILE" \
	- < "$PROMPT_FILE"
cp "$ANALYSIS_FILE" "$LATEST_ANALYSIS_FILE"
echo "[$(date -Is)] Wrote $ANALYSIS_FILE"
echo "[$(date -Is)] Full log: $RUN_LOG"
