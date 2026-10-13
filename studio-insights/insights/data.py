"""Normalized data model shared by every source (Excel exports now, Arbox API later).

bookings columns:
    date (Timestamp, normalized), time (str HH:MM), class_name, area, trainer,
    client, user_type ('client'|'staff'|'lead'), membership, plan_entries (int|None),
    student (bool), checked_in (bool), first_class (bool)

holds columns:
    client, membership, start (Timestamp), end (Timestamp), days (int), reason
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import pandas as pd

from .config import Config

PLAN_RE = re.compile(r"מנוי\s*(\d+)\s*כניסות")
STUDENT_MARKERS = ("חיילות", "סטודנט")
TRIAL_MARKERS = ("היכרות", "ניסיון")


def parse_plan(membership: str) -> int | None:
    m = PLAN_RE.search(str(membership or ""))
    return int(m.group(1)) if m else None


def is_student(membership: str) -> bool:
    return any(s in str(membership or "") for s in STUDENT_MARKERS)


def is_trial(membership: str) -> bool:
    return any(s in str(membership or "") for s in TRIAL_MARKERS)


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip()


@dataclass
class StudioData:
    bookings: pd.DataFrame
    holds: pd.DataFrame

    @property
    def last_date(self) -> pd.Timestamp:
        return self.bookings["date"].max()


def enrich_bookings(df: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    df = df.copy()
    df["client"] = df["client"].map(normalize_name)
    df["trainer"] = df["trainer"].map(normalize_name)
    df["area"] = df["class_name"].map(cfg.area_of)
    df["plan_entries"] = df["membership"].map(parse_plan)
    df["student"] = df["membership"].map(is_student)
    df["trial"] = df["membership"].map(is_trial)
    return df


def empty_holds() -> pd.DataFrame:
    return pd.DataFrame(columns=["client", "membership", "start", "end", "days", "reason"])
