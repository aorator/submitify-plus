#!/usr/bin/env bash
# Builds loadable extension folders and zips for each browser.
#
#   ./build.sh            -> dist/firefox, dist/chromium and their zips
#
# The two builds share everything in src/; only manifest.json differs.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
for target in firefox chromium; do
  out="dist/$target"
  mkdir -p "$out"
  cp -R src/. "$out/"
  cp "manifests/$target.json" "$out/manifest.json"
  version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$out/manifest.json")
  (cd "$out" && zip -qr "../submitify-cf-$target-v$version.zip" .)
  echo "built dist/$target  ->  dist/submitify-cf-$target-v$version.zip"
done
