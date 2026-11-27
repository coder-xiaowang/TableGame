#!/bin/sh
# Run as the private reporting user, with the same GAME*_DB_PATH values as the services.
set -eu
umask 077
cd "$(dirname "$0")/.."
: "${TABLEGAME_REPORT_DIR:?Set TABLEGAME_REPORT_DIR to a private directory outside all web roots}"
log="${TABLEGAME_VISIT_LOG:-/var/log/nginx/tablegame-visits.log}"
mkdir -p "$TABLEGAME_REPORT_DIR"
set -- "$log"
for previous in "$log.1" "$log.1.gz"; do
    if [ -f "$previous" ]; then set -- "$@" "$previous"; fi
done
node scripts/import-visits.cjs "$TABLEGAME_REPORT_DIR/visits.sqlite" "$@"
node scripts/analytics-report.cjs "$TABLEGAME_REPORT_DIR/visits.sqlite" "$TABLEGAME_REPORT_DIR/report.html"
