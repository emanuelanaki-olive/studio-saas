"""Arbox API source - placeholder until API access is granted.

Arbox publishes an official API (https://arboxserver.arboxapp.com/docs/api) that
requires an API key issued by Arbox support. The endpoint paths and payloads have
NOT been verified yet, so this module intentionally does not guess them.

To finish the integration once a key is available:
  1. Set ARBOX_API_KEY (and ARBOX_BASE_URL if Arbox gives one) in the environment.
  2. Implement fetch_bookings() / fetch_holds() to return frames with the columns
     documented in insights/data.py, then call enrich_bookings() on the bookings.
  3. Set `source.type: arbox_api` in config.yaml.
Everything downstream (metrics, reports, dashboard, WhatsApp) stays unchanged.
"""
from __future__ import annotations

import os
from datetime import date

import pandas as pd

from ..config import Config
from ..data import StudioData, enrich_bookings


class ArboxClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.environ.get("ARBOX_API_KEY")
        self.base_url = base_url or os.environ.get("ARBOX_BASE_URL")
        if not self.api_key:
            raise RuntimeError("ARBOX_API_KEY is not set - request an API key from Arbox support")

    def fetch_bookings(self, start: date, end: date) -> pd.DataFrame:
        raise NotImplementedError("Map the Arbox schedule/bookings endpoint here once docs are confirmed")

    def fetch_holds(self, start: date, end: date) -> pd.DataFrame:
        raise NotImplementedError("Map the Arbox membership-holds endpoint here once docs are confirmed")


def load_from_api(cfg: Config, start: date, end: date) -> StudioData:
    client = ArboxClient()
    return StudioData(bookings=enrich_bookings(client.fetch_bookings(start, end), cfg),
                      holds=client.fetch_holds(start, end))
