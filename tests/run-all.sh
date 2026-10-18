#!/usr/bin/env bash
# Alle Browsertests nacheinander (headless Chromium). Aufruf: tests/run-all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
python3 tests/make_pdfs.py >/dev/null || exit 1
node scripts/build-assets.mjs >/dev/null || exit 1
rc=0
for t in e2e-admin e2e-mirror e2e-dual e2e-robust e2e-links e2e-update e2e-webscreen e2e-webtab; do
  echo "=== $t"
  if ! out=$(timeout 240 node tests/$t.mjs 2>&1); then
    echo "$out"
    rc=1
  else
    echo "$out" | grep -E "✗|FEHLER|ALLES OK|FEHLGESCHLAGEN|Gespeichert" || true
  fi
  if ! echo "$out" | grep -q 'ALLES OK'; then rc=1; fi
  if echo "$out" | grep -q 'FEHLGESCHLAGEN\|FEHLER'; then rc=1; fi
done
exit $rc
