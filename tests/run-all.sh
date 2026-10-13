#!/usr/bin/env bash
# Alle Browsertests nacheinander (headless Chromium). Aufruf: tests/run-all.sh
set -u
cd "$(dirname "$0")/.."
python3 tests/make_pdfs.py >/dev/null
node scripts/build-assets.mjs >/dev/null
rc=0
for t in e2e-admin e2e-mirror e2e-dual e2e-robust; do
  echo "=== $t"
  out=$(timeout 240 node tests/$t.mjs 2>&1); echo "$out" | grep -E "✗|FEHLER|ALLES OK|FEHLGESCHLAGEN|Gespeichert"
  echo "$out" | grep -q "FEHLGESCHLAGEN\|FEHLER" && rc=1
done
exit $rc
