#!/usr/bin/env bash
# Build a Chrome Web Store-ready ZIP from extension/.
# Output: dist/clipboard-<version>.zip
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
EXT_DIR="$ROOT/extension"
DIST_DIR="$ROOT/dist"

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "error: $EXT_DIR/manifest.json not found" >&2
  exit 1
fi

# Pull version straight out of manifest.json so the ZIP filename matches.
VERSION=$(node -e "console.log(require('$EXT_DIR/manifest.json').version)")
if [[ -z "$VERSION" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
ZIP="$DIST_DIR/clipboard-${VERSION}.zip"
rm -f "$ZIP"

# Validate manifest JSON once before zipping.
node -e "JSON.parse(require('fs').readFileSync('$EXT_DIR/manifest.json','utf8'))" \
  || { echo "error: manifest.json is not valid JSON" >&2; exit 1; }

# Lint every JS file: a syntax error here is a much better failure than a
# rejected upload.
while IFS= read -r -d '' js; do
  node --check "$js" >/dev/null
done < <(find "$EXT_DIR" -name '*.js' -type f -print0)

cd "$EXT_DIR"

# Exclude dev-only files. Order matters — zip evaluates patterns in order.
zip -r "$ZIP" . \
  -x "*.DS_Store" \
  -x "**/.*" \
  -x "icons/generate.py" \
  -x "icons/__pycache__/*" \
  -x "**/*.map" \
  -x "**/*.bak" \
  -x "**/*.swp" \
  > /dev/null

cd "$ROOT"

echo
echo "Built: $ZIP"
echo "Size: $(du -h "$ZIP" | cut -f1)"
echo
echo "Contents:"
unzip -l "$ZIP"
