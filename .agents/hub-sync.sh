#!/usr/bin/env bash
# sync hub skills/agents into this repo, locally (shallow clone; needs GITHUB_TOKEN for private hub)
set -euo pipefail
REF="https://github.com/peakora/Peakora-Cortex.git"
TOK="${GITHUB_TOKEN:-}"
if [ -n "$TOK" ]; then REF="https://${TOK}@github.com/peakora/Peakora-Cortex.git"; fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$HERE/.agents}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
git clone --depth 1 --branch master "$REF" "$STAGE/hub"
mkdir -p "$DEST/skills" "$DEST/agents"
for d in skills agents; do
  if [ -d "$STAGE/hub/$d" ]; then
    for t in "$STAGE/hub/$d"/*; do
      rm -rf "$DEST/$d/$(basename "$t")"
      cp -R "$t" "$DEST/$d/"
    done
  fi
done
if [ -d "$STAGE/hub/.agents/agents" ]; then
  for t in "$STAGE/hub/.agents/agents"/*; do
    cp -f "$t" "$DEST/agents/"
  done
fi
echo "hub skills/agents mirrored into $DEST"
