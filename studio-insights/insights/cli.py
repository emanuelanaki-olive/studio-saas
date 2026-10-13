"""Command line entry point.

    python -m insights daily  [--date YYYY-MM-DD] [--send] [--dry-run]
    python -m insights weekly [--date YYYY-MM-DD] [--send] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import reports, whatsapp
from .config import ROOT, load_config
from .ingest.excel import load_from_config


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="insights")
    ap.add_argument("report", choices=["daily", "weekly"])
    ap.add_argument("--date", help="report date (default: last date in the data)")
    ap.add_argument("--config", help="path to config.yaml")
    ap.add_argument("--send", action="store_true", help="push to WhatsApp")
    ap.add_argument("--dry-run", action="store_true", help="print the WhatsApp payloads instead of sending")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    data = load_from_config(cfg)
    build = reports.daily_report if args.report == "daily" else reports.weekly_report
    text = build(data, cfg, args.date)

    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    day = args.date or f"{data.last_date:%Y-%m-%d}"
    (out / f"{args.report}-{day}.txt").write_text(text, encoding="utf-8")
    sys.stdout.write(text + "\n")

    if args.send or args.dry_run:
        result = whatsapp.send(text, cfg, dry_run=args.dry_run)
        if args.dry_run:
            sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=1)[:2000] + "\n")
