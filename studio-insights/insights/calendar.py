"""Israeli holiday calendar (via pyluach) and business-season reminders."""
from __future__ import annotations

from datetime import date, timedelta

from pyluach import dates

# Holidays worth a business reminder even though the studio may stay open
NOTABLE = {"חנוכה", "פורים", "ל״ג בעומר", "ט׳ באב"}


def holidays_between(start: date, end: date) -> list[dict]:
    """Holiday days in range. closed=True for Yom Tov days (studio normally closed)."""
    out = []
    d = dates.GregorianDate(start.year, start.month, start.day)
    for i in range((end - start).days + 1):
        x = d + i
        name = x.holiday(israel=True, hebrew=True)
        if not name:
            continue
        closed = bool(x.festival(israel=True, hebrew=True, include_working_days=False))
        out.append({"date": x.to_pydate(), "name": name, "closed": closed,
                    "notable": closed or name in NOTABLE or name in {"סוכות", "פסח"}})
    return [h for h in out if h["notable"]]


def holiday_periods(start: date, end: date) -> list[dict]:
    """Collapse consecutive holiday days with the same name into periods."""
    periods: list[dict] = []
    for h in holidays_between(start, end):
        last = periods[-1] if periods else None
        if last and last["name"] == h["name"] and h["date"] - last["end"] <= timedelta(days=1):
            last["end"] = h["date"]
            last["closed_days"] += int(h["closed"])
        else:
            periods.append({"name": h["name"], "start": h["date"], "end": h["date"],
                            "closed_days": int(h["closed"])})
    return periods


def reminders(as_of: date, lookahead_days: int = 45) -> list[str]:
    msgs = []
    for p in holiday_periods(as_of, as_of + timedelta(days=lookahead_days)):
        days = (p["start"] - as_of).days
        when = "היום" if days == 0 else "מחר" if days == 1 else f"בעוד {days} ימים"
        span = p["start"].strftime("%d/%m") if p["start"] == p["end"] else \
            f"{p['start']:%d/%m}–{p['end']:%d/%m}"
        tip = ""
        if p["name"] in {"ראש השנה", "יום כיפור", "סוכות", "שמיני עצרת"}:
            tip = " · בשנה שעברה הקפאות בחגי תשרי היו פי 2–4 מהרגיל - כדאי להגדיר מדיניות הקפאה מראש"
        elif p["name"] == "פסח":
            tip = " · תכננו מערכת שעות מצומצמת ומבצע 'חוזרים אחרי החג'"
        elif p["closed_days"]:
            tip = " · לעדכן את מערכת השעות ולהודיע למתאמנות"
        msgs.append(f"{p['name']} {when} ({span}){tip}")
    # season reminders
    if as_of.month == 6 and as_of.day <= 15:
        msgs.append("הקיץ מתקרב: חופשות = הקפאות. כדאי לתכנן קמפיין גיוס לסוף אוגוסט")
    if as_of.month == 12 and as_of.day >= 1 and as_of.day <= 15:
        msgs.append("ינואר מתקרב - חודש הצטרפויות חזק. להגדיל תקציב ממומן ולהכין הצעת היכרות")
    return msgs


def closed_days_between(start: date, end: date) -> list[date]:
    return [h["date"] for h in holidays_between(start, end) if h["closed"]]
