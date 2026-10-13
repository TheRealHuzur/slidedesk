#!/usr/bin/env bash
# Kopiert PDF.js und die Inter-Schrift aus node_modules nach vendor/, damit die App offline ohne CDN laeuft.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf vendor && mkdir -p vendor/pdfjs vendor/inter
P=node_modules/pdfjs-dist
# Legacy-Build: enthaelt Polyfills fuer neue JavaScript-Funktionen, laeuft dadurch auch in etwas aelteren Edge/Chrome-Versionen.
cp $P/legacy/build/pdf.min.mjs $P/legacy/build/pdf.worker.min.mjs vendor/pdfjs/
cp -r $P/cmaps $P/standard_fonts $P/iccs vendor/pdfjs/
mkdir -p vendor/pdfjs/wasm && cp $P/wasm/*.wasm $P/wasm/*_fallback.js $P/wasm/LICENSE* vendor/pdfjs/wasm/
cp $P/LICENSE vendor/pdfjs/LICENSE
for w in 400 500 600 700; do cp node_modules/@fontsource/inter/files/inter-latin-$w-normal.woff2 vendor/inter/; done
cp node_modules/@fontsource/inter/LICENSE vendor/inter/LICENSE 2>/dev/null || true
echo "vendor ok: $(du -sh vendor | cut -f1)"
