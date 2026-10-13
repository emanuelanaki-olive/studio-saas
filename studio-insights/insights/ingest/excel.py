"""Loaders for the Arbox Excel exports ("shift-summary-report", "members-on-hold-report")."""
from __future__ import annotations

from glob import glob
from pathlib import Path

import pandas as pd

from ..config import Config, ROOT
from ..data import StudioData, empty_holds, enrich_bookings, normalize_name

BOOKING_COLS = {
    "תאריך": "date", "שעה": "time", "שיעור": "class_name", "מאמן": "trainer",
    "משתמש": "user_type", "שם": "client", "חברות": "membership",
    "שיעור ראשון": "first_class", "צ'ק אין": "checked_in",
}
USER_TYPES = {"לקוח": "client", "איש צוות": "staff", "מתעניין": "lead"}
HOLD_COLS = {
    "שם": "client", "חברות": "membership", "תחילת ההקפאה": "start",
    "סיום ההקפאה": "end", "סך ימי הקפאה": "days", "סיבת הקפאה": "reason",
}


def _yes(v) -> bool:
    return str(v).strip() == "כן"


def _fmt_time(v) -> str:
    if hasattr(v, "strftime"):
        return v.strftime("%H:%M")
    return str(v)[:5]


def read_bookings(paths: list[str | Path], cfg: Config) -> pd.DataFrame:
    frames = []
    for p in paths:
        raw = pd.read_excel(p)
        raw.columns = [str(c).strip() for c in raw.columns]
        missing = [c for c in BOOKING_COLS if c not in raw.columns]
        if missing:
            raise ValueError(f"{p}: missing columns {missing} - is this a shift-summary report?")
        frames.append(raw[list(BOOKING_COLS)].rename(columns=BOOKING_COLS))
    df = pd.concat(frames, ignore_index=True)
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    df["time"] = df["time"].map(_fmt_time)
    df["user_type"] = df["user_type"].map(USER_TYPES).fillna("client")
    df["first_class"] = df["first_class"].map(_yes)
    df["checked_in"] = df["checked_in"].map(_yes)
    df["membership"] = df["membership"].fillna("").astype(str)
    # overlapping exports -> keep one row per client per class
    df = df.drop_duplicates(subset=["date", "time", "class_name", "client"])
    return enrich_bookings(df, cfg)


def read_holds(paths: list[str | Path]) -> pd.DataFrame:
    if not paths:
        return empty_holds()
    frames = []
    for p in paths:
        raw = pd.read_excel(p)
        raw.columns = [str(c).strip() for c in raw.columns]
        frames.append(raw[[c for c in HOLD_COLS if c in raw.columns]].rename(columns=HOLD_COLS))
    df = pd.concat(frames, ignore_index=True).dropna(subset=["client", "start", "end"])
    df["client"] = df["client"].map(normalize_name)
    df["start"] = pd.to_datetime(df["start"]).dt.normalize()
    df["end"] = pd.to_datetime(df["end"]).dt.normalize()
    df["days"] = (df["end"] - df["start"]).dt.days + 1
    df["reason"] = df.get("reason", pd.Series(dtype=str)).fillna("")
    return df.drop_duplicates(subset=["client", "start", "end"]).reset_index(drop=True)


def load_from_config(cfg: Config) -> StudioData:
    src = cfg.raw.get("source", {})
    b = sorted(glob(str(ROOT / src.get("bookings_glob", "data/*shift-summary*.xlsx"))))
    h = sorted(glob(str(ROOT / src.get("holds_glob", "data/*on-hold*.xlsx"))))
    if not b:
        raise FileNotFoundError("No bookings export found - put the Arbox shift-summary report in data/")
    return StudioData(bookings=read_bookings(b, cfg), holds=read_holds(h))
