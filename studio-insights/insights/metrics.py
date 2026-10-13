"""All business calculations. Pure functions over the normalized frames in insights.data."""
from __future__ import annotations

import pandas as pd

from .config import Config

HE_DAYS = {6: "ראשון", 0: "שני", 1: "שלישי", 2: "רביעי", 3: "חמישי", 4: "שישי", 5: "שבת"}
DAY_ORDER = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]


def _between(df: pd.DataFrame, start, end, col: str = "date") -> pd.DataFrame:
    return df[(df[col] >= pd.Timestamp(start)) & (df[col] <= pd.Timestamp(end))]


def area_bookings(bookings: pd.DataFrame) -> pd.DataFrame:
    return bookings[bookings["area"].notna()]


# ---------------------------------------------------------------- sessions & pay
def sessions(bookings: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """One row per class that had at least one booking."""
    b = area_bookings(bookings)
    s = (b.groupby(["date", "time", "class_name", "area", "trainer"])
           .agg(n=("client", "size"), no_show=("checked_in", lambda v: int((~v).sum())))
           .reset_index())
    s["capacity"] = s["area"].map(lambda a: cfg.areas[a].capacity)
    s["occupancy"] = s["n"] / s["capacity"]
    s["full"] = s["n"] >= s["capacity"]
    s["weekday"] = s["date"].dt.dayofweek.map(HE_DAYS)
    s["month"] = s["date"].dt.to_period("M")
    s["pay"] = _trainer_pay(s, cfg)
    return s


def _trainer_pay(s: pd.DataFrame, cfg: Config) -> pd.Series:
    min_b = int(cfg.cancellation.get("min_bookings", 2))
    sandwich = float(cfg.cancellation.get("sandwich_pay", 80))
    base = s["area"].map(lambda a: cfg.areas[a].trainer_pay)
    pay = base.where(s["n"] >= min_b, 0.0).astype(float)
    held = s[s["n"] >= min_b]
    for idx in s.index[s["n"] < min_b]:
        r = s.loc[idx]
        same = held[(held["date"] == r["date"]) & (held["trainer"] == r["trainer"])]
        if (same["time"] < r["time"]).any() and (same["time"] > r["time"]).any():
            pay[idx] = sandwich
    return pay


def occupancy_summary(sess: pd.DataFrame, cfg: Config, start, end) -> pd.DataFrame:
    s = _between(sess, start, end)
    rows = []
    for key, area in cfg.areas.items():
        a = s[s["area"] == key]
        held = a[a["n"] >= int(cfg.cancellation.get("min_bookings", 2))]
        rows.append({
            "area": key, "label": area.label, "sessions": len(held), "bookings": int(a["n"].sum()),
            "avg_per_class": round(held["n"].mean(), 2) if len(held) else 0.0,
            "occupancy": round(held["occupancy"].mean(), 3) if len(held) else 0.0,
            "full_share": round(held["full"].mean(), 3) if len(held) else 0.0,
            "low_classes": int((a["n"] <= 2).sum()),
            "no_show_rate": round(a["no_show"].sum() / a["n"].sum(), 3) if a["n"].sum() else 0.0,
            "trainer_pay": float(a["pay"].sum()),
        })
    return pd.DataFrame(rows)


def slot_table(sess: pd.DataFrame, cfg: Config, as_of, weeks: int | None = None) -> pd.DataFrame:
    """Average occupancy per area/weekday/time over the last N weeks."""
    weeks = weeks or int(cfg.alerts.get("slot_lookback_weeks", 4))
    start = pd.Timestamp(as_of) - pd.Timedelta(weeks=weeks)
    s = _between(sess, start, as_of)
    t = (s.groupby(["area", "weekday", "time"])
          .agg(sessions=("n", "size"), avg=("n", "mean"), occupancy=("occupancy", "mean"),
               full_share=("full", "mean"), trainer=("trainer", lambda v: v.mode().iloc[0]))
          .reset_index())
    t["label"] = t["area"].map(lambda a: cfg.areas[a].label)
    t["day_idx"] = t["weekday"].map(DAY_ORDER.index)
    return t.sort_values(["area", "day_idx", "time"]).reset_index(drop=True)


def weak_and_strong_slots(slots: pd.DataFrame, cfg: Config) -> tuple[pd.DataFrame, pd.DataFrame]:
    a = cfg.alerts
    ok = slots[slots["sessions"] >= int(a.get("min_slot_sessions", 3))]
    weak = ok[ok["occupancy"] < float(a.get("weak_slot_occupancy", 0.5))].sort_values("occupancy")
    strong = ok[ok["occupancy"] >= float(a.get("strong_slot_occupancy", 0.85))].sort_values(
        "occupancy", ascending=False)
    return weak, strong


# ---------------------------------------------------------------- clients & money
def member_bookings(bookings: pd.DataFrame) -> pd.DataFrame:
    b = area_bookings(bookings)
    return b[(b["user_type"] == "client") & b["plan_entries"].notna()]


def client_months(bookings: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    """One row per member per calendar month they trained in, with the plan price."""
    b = member_bookings(bookings).assign(month=lambda d: d["date"].dt.to_period("M"))
    if b.empty:
        return pd.DataFrame(columns=["month", "client", "plan", "student", "visits", "gross", "net"])
    pieces = {"visits": ("area", "size")}
    for key in cfg.areas:
        pieces[key] = ("area", lambda v, k=key: int((v == k).sum()))
    g = b.groupby(["month", "client"]).agg(
        plan=("plan_entries", lambda v: int(v.mode().iloc[0])),
        student=("student", lambda v: bool(v.mode().iloc[0])),
        **pieces,
    ).reset_index()
    g["gross"] = [cfg.price(p, s) for p, s in zip(g["plan"], g["student"])]
    g["gross"] = g["gross"].fillna(0.0)
    g["net"] = g["gross"].map(cfg.net)
    g["pattern"] = g.apply(lambda r: _pattern(r, cfg), axis=1)
    return g


def _pattern(row, cfg: Config) -> str:
    used = [cfg.areas[k].label for k in cfg.areas if row.get(k, 0) > 0]
    return "שניהם" if len(used) > 1 else f"רק {used[0]}" if used else "-"


def monthly_pnl(bookings: pd.DataFrame, sess: pd.DataFrame, cfg: Config, month: pd.Period,
                as_of=None) -> dict:
    """Revenue split by each member's visits per area; fixed costs split by booking share.

    For the running month the result is month-to-date: members who trained so far,
    trainer pay so far, and fixed costs prorated by elapsed days."""
    cm = client_months(bookings, cfg)
    cm = cm[cm["month"] == month]
    s = sess[sess["month"] == month]
    fixed_ratio = 1.0
    if as_of is not None and pd.Timestamp(as_of).to_period("M") == month:
        fixed_ratio = pd.Timestamp(as_of).day / month.days_in_month
    total_visits = sum(int(cm[k].sum()) for k in cfg.areas) or 1
    out = {"month": str(month), "members": len(cm), "partial": fixed_ratio != 1.0, "areas": {}}
    for key, area in cfg.areas.items():
        rev = float((cm["net"] * cm[key] / cm["visits"].where(cm["visits"] > 0, 1)).sum())
        pay = float(s[s["area"] == key]["pay"].sum())
        share = int(cm[key].sum()) / total_visits
        fixed = cfg.fixed_costs * fixed_ratio * share
        out["areas"][key] = {"label": area.label, "revenue": rev, "trainer_pay": pay,
                             "contribution": rev - pay, "fixed": fixed, "profit": rev - pay - fixed,
                             "visit_share": share}
    out["revenue"] = sum(a["revenue"] for a in out["areas"].values())
    out["trainer_pay"] = sum(a["trainer_pay"] for a in out["areas"].values())
    out["fixed"] = cfg.fixed_costs * fixed_ratio
    out["profit"] = out["revenue"] - out["trainer_pay"] - out["fixed"]
    out["break_even_members"] = (
        round((out["trainer_pay"] + out["fixed"]) / (out["revenue"] / len(cm)))
        if len(cm) and not out["partial"] else None)
    return out


# ---------------------------------------------------------------- holds
def hold_days(holds: pd.DataFrame, client: str, start, end) -> int:
    h = holds[holds["client"] == client]
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    total = 0
    for _, r in h.iterrows():
        a, b = max(r["start"], start), min(r["end"], end)
        if b >= a:
            total += (b - a).days + 1
    return total


def active_holds(holds: pd.DataFrame, as_of) -> pd.DataFrame:
    d = pd.Timestamp(as_of)
    return holds[(holds["start"] <= d) & (holds["end"] >= d)]


def holds_summary(holds: pd.DataFrame, start, end) -> dict:
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    h = holds[(holds["start"] <= end) & (holds["end"] >= start)]
    days = sum(hold_days(h, c, start, end) for c in h["client"].unique())
    return {"members": h["client"].nunique(), "days": days,
            "reasons": h["reason"].value_counts().to_dict()}


def repeat_freezers(holds: pd.DataFrame, cfg: Config, as_of) -> pd.DataFrame:
    window = int(cfg.alerts.get("repeat_freeze_window_days", 180))
    n = int(cfg.alerts.get("repeat_freeze_count", 3))
    h = holds[holds["start"] >= pd.Timestamp(as_of) - pd.Timedelta(days=window)]
    c = h.groupby("client").agg(holds=("start", "size"), days=("days", "sum"),
                                last=("end", "max")).reset_index()
    return c[c["holds"] >= n].sort_values("holds", ascending=False)


# ---------------------------------------------------------------- retention & risk
def member_status(bookings: pd.DataFrame, holds: pd.DataFrame, cfg: Config, as_of,
                  lookback_days: int = 120) -> pd.DataFrame:
    """Every member seen in the lookback window, with last visit and whether frozen now."""
    as_of = pd.Timestamp(as_of)
    b = member_bookings(bookings)
    b = b[(b["date"] >= as_of - pd.Timedelta(days=lookback_days)) & (b["date"] <= as_of)]
    if b.empty:
        return pd.DataFrame()
    frozen_now = set(active_holds(holds, as_of)["client"])
    upcoming = set(bookings[bookings["date"] > as_of]["client"])
    st = b.sort_values("date").groupby("client").agg(
        first=("date", "min"), last=("date", "max"), visits=("date", "size"),
        plan=("plan_entries", "last"), student=("student", "last"), membership=("membership", "last"),
        **{k: ("area", lambda v, k=k: int((v == k).sum())) for k in cfg.areas},
    ).reset_index()
    st["days_since"] = (as_of - st["last"]).dt.days
    st["frozen"] = st["client"].isin(frozen_now)
    st["has_upcoming"] = st["client"].isin(upcoming)
    st["pattern"] = st.apply(lambda r: _pattern(r, cfg), axis=1)
    return st


def at_risk(status: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    if status.empty:
        return status
    lo = int(cfg.alerts.get("inactive_days", 14))
    hi = int(cfg.alerts.get("churn_days", 30))
    r = status[(status["days_since"] >= lo) & (status["days_since"] < hi)
               & ~status["frozen"] & ~status["has_upcoming"]]
    return r.sort_values("days_since", ascending=False)


def churned(status: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    if status.empty:
        return status
    hi = int(cfg.alerts.get("churn_days", 30))
    return status[(status["days_since"] >= hi) & ~status["frozen"] & ~status["has_upcoming"]]


def utilization(bookings: pd.DataFrame, holds: pd.DataFrame, cfg: Config, month: pd.Period) -> pd.DataFrame:
    """Visits vs. plan entries for the month, with frozen days removed from the expectation."""
    cm = client_months(bookings, cfg)
    cm = cm[cm["month"] == month].copy()
    if cm.empty:
        return cm
    start, end = month.start_time, month.end_time.normalize()
    dim = month.days_in_month
    cm["hold_days"] = [hold_days(holds, c, start, end) for c in cm["client"]]
    cm["expected"] = cm["plan"] * (dim - cm["hold_days"]).clip(lower=0) / dim
    cm["utilization"] = (cm["visits"] / cm["expected"].where(cm["expected"] > 0)).clip(upper=1.5)
    return cm


def cross_usage(status: pd.DataFrame, active_days: int = 30) -> pd.Series:
    if status.empty:
        return pd.Series(dtype=int)
    return status[status["days_since"] < active_days]["pattern"].value_counts()


def recruiting(bookings: pd.DataFrame, as_of, weeks: int = 8) -> pd.DataFrame:
    """First-ever classes and trial-pass clients per week."""
    as_of = pd.Timestamp(as_of)
    b = bookings[(bookings["user_type"] != "staff") & (bookings["date"] <= as_of)]
    first = b[b["first_class"]].copy()
    first["week"] = first["date"].dt.to_period("W-SAT")
    trials = b[b["trial"]].groupby("client")["date"].min().dt.to_period("W-SAT")
    weeks_idx = pd.period_range(end=as_of.to_period("W-SAT"), periods=weeks, freq="W-SAT")
    out = pd.DataFrame(index=weeks_idx)
    out["first_classes"] = first.groupby("week").size().reindex(weeks_idx, fill_value=0)
    out["new_trials"] = trials.value_counts().reindex(weeks_idx, fill_value=0)
    return out


def trial_conversion(bookings: pd.DataFrame) -> tuple[int, int]:
    trial_start = bookings[bookings["trial"]].groupby("client")["date"].min()
    member_start = member_bookings(bookings).groupby("client")["date"].min()
    converted = [c for c, d in trial_start.items() if c in member_start and member_start[c] >= d]
    return len(trial_start), len(converted)
