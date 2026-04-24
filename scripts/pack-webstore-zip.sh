#!/usr/bin/env bash
# Build a Chrome Web Store–valid zip: manifest.json at the ARCHIVE ROOT (not inside a parent folder).
# Run from anywhere: bash scripts/pack-webstore-zip.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/MegaLeadsAI-webstore.zip"
cd "$ROOT"
rm -f "$OUT"
zip -r "$OUT" . \
  -x ".git/*" \
  -x ".git/**" \
  -x "*.DS_Store" \
  -x "*/.DS_Store" \
  -x "*.zip" \
  -x "Megamix_AI_source/*" \
  -x "Megamix_AI_source/**" \
  -x "server/*" \
  -x "server/**" \
  -x "docs/*" \
  -x "docs/**" \
  -x "*.plan.md" \
  -x "render.yaml" \
  -x "scripts/pack-webstore-zip.sh"
echo "Created: $OUT"
unzip -l "$OUT" | head -25
