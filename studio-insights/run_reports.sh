#!/usr/bin/env bash
# Called by cron. Usage: run_reports.sh daily|weekly
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
exec ${PYTHON:-python3} -m insights "$1" --send
