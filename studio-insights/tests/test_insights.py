from datetime import date, time

import pandas as pd
import pytest

from insights import metrics as m
from insights import reports, whatsapp
from insights.calendar import holiday_periods
from insights.config import ROOT, load_config
from insights.data import StudioData, enrich_bookings, is_student, parse_plan
from insights.ingest.excel import read_bookings, read_holds


@pytest.fixture
def cfg():
    return load_config(ROOT / "config.example.yaml")


def booking(day, t, cls, trainer, client, membership="מנוי 9 כניסות - O-LIVE", checked=True, first=False,
            user="client"):
    return {"date": pd.Timestamp(day), "time": t, "class_name": cls, "trainer": trainer, "client": client,
            "user_type": user, "membership": membership, "checked_in": checked, "first_class": first}


def frame(rows, cfg):
    return enrich_bookings(pd.DataFrame(rows), cfg)


def test_plan_parsing():
    assert parse_plan("מנוי 13 כניסות -  חיילות/סטודנט") == 13
    assert parse_plan("כרטיסיית היכרות - 3 כניסות o-live") is None
    assert is_student("מנוי 5 כניסות O-LIVE - חיילות/סטודנט - דיירקט/מזומן")


def test_student_price_falls_back_to_regular(cfg):
    assert cfg.price(9, True) == 399
    assert cfg.price(17, True) == 700  # no student tier for 17


def test_trainer_pay_sandwich_rule(cfg):
    rows = []
    for t in ("08:00", "10:00"):
        rows += [booking("2026-06-01", t, "אימון כוח", "נויה", f"c{t}{i}") for i in range(3)]
    rows.append(booking("2026-06-01", "09:00", "אימון כוח", "נויה", "solo"))         # between two -> 80
    rows.append(booking("2026-06-01", "19:00", "פילאטיס מכשירים", "עמית", "alone"))  # cancelled -> 0
    s = m.sessions(frame(rows, cfg), cfg).set_index("time")
    assert s.loc["08:00", "pay"] == 110
    assert s.loc["09:00", "pay"] == 80
    assert s.loc["19:00", "pay"] == 0


def test_pnl_splits_revenue_by_visits(cfg):
    rows = [booking("2026-06-02", "08:00", "אימון כוח", "a", "dana"),
            booking("2026-06-03", "08:00", "פילאטיס מכשירים", "b", "dana"),
            booking("2026-06-03", "08:00", "פילאטיס מכשירים", "b", "noa", "מנוי 5 כניסות - O-LIVE")]
    b = frame(rows, cfg)
    p = m.monthly_pnl(b, m.sessions(b, cfg), cfg, pd.Period("2026-06", "M"))
    assert p["members"] == 2
    assert p["revenue"] == pytest.approx((480 + 280) / 1.18)
    assert p["areas"]["strength"]["revenue"] == pytest.approx(240 / 1.18)
    assert p["fixed"] == cfg.fixed_costs


def test_at_risk_skips_frozen_members(cfg):
    rows = [booking("2026-06-01", "08:00", "אימון כוח", "a", "frozen"),
            booking("2026-06-01", "08:00", "אימון כוח", "a", "quiet"),
            booking("2026-06-20", "08:00", "אימון כוח", "a", "active")]
    holds = pd.DataFrame([{"client": "frozen", "membership": "", "start": pd.Timestamp("2026-06-10"),
                           "end": pd.Timestamp("2026-06-30"), "days": 21, "reason": "Vacation"}])
    st = m.member_status(frame(rows, cfg), holds, cfg, "2026-06-20")
    assert list(m.at_risk(st, cfg)["client"]) == ["quiet"]


def test_utilization_removes_hold_days(cfg):
    rows = [booking(f"2026-06-{d:02d}", "08:00", "אימון כוח", "a", "dana") for d in (16, 18, 20, 22)]
    holds = pd.DataFrame([{"client": "dana", "membership": "", "start": pd.Timestamp("2026-06-01"),
                           "end": pd.Timestamp("2026-06-15"), "days": 15, "reason": ""}])
    u = m.utilization(frame(rows, cfg), holds, cfg, pd.Period("2026-06", "M"))
    assert u.iloc[0]["expected"] == pytest.approx(4.5)
    assert u.iloc[0]["utilization"] == pytest.approx(4 / 4.5)


def test_holiday_periods_tishrei_2026():
    p = {x["name"]: x for x in holiday_periods(date(2026, 9, 1), date(2026, 10, 5))}
    assert p["ראש השנה"]["start"] == date(2026, 9, 12)
    assert p["יום כיפור"]["start"] == date(2026, 9, 21)
    assert p["סוכות"]["closed_days"] == 1


def test_whatsapp_payloads_split_and_flatten(cfg):
    text = "\n".join(f"שורה {i} " + "x" * 50 for i in range(200))
    msgs = whatsapp.build_payloads(text, "972500000000", cfg)
    assert len(msgs) > 1 and all(len(p["text"]["body"]) <= whatsapp.MAX_TEXT for p in msgs)
    cfg.raw["whatsapp"]["mode"] = "template"
    t = whatsapp.build_payloads("a\nb", "972500000000", cfg)
    assert t[0]["template"]["components"][0]["parameters"][0]["text"] == "a | b"


def test_excel_roundtrip_and_reports(cfg, tmp_path):
    rows = []
    for d in pd.date_range("2026-06-01", "2026-07-20"):
        if d.dayofweek == 5:
            continue
        for i in range(6):
            rows.append({"תאריך": d, "יום": "", "שעה": time(8, 0), "שיעור": "אימון כוח", "מאמן": "נויה",
                         "משתמש": "לקוח", "שם": f"לקוחה {i}", "חברות": "מנוי 9 כניסות - O-LIVE",
                         "שיעור ראשון": "לא", "צ'ק אין": "כן"})
        rows.append({"תאריך": d, "יום": "", "שעה": time(18, 0), "שיעור": "פילאטיס מכשירים", "מאמן": "עמית",
                     "משתמש": "לקוח", "שם": "נועה", "חברות": "מנוי 5 כניסות -  חיילות/סטודנט",
                     "שיעור ראשון": "לא", "צ'ק אין": "לא"})
    pd.DataFrame(rows).to_excel(tmp_path / "shift-summary-report.xlsx", index=False)
    pd.DataFrame([{"שם": "נועה", "חברות": "x", "תחילת ההקפאה": "2026-07-01", "סיום ההקפאה": "2026-07-05",
                   "סך ימי הקפאה": 5, "סיבת הקפאה": "Vacation"}]).to_excel(tmp_path / "on-hold.xlsx", index=False)
    b = read_bookings([tmp_path / "shift-summary-report.xlsx"], cfg)
    h = read_holds([tmp_path / "on-hold.xlsx"])
    assert set(b["area"]) == {"strength", "pilates"} and h.iloc[0]["days"] == 5
    data = StudioData(bookings=b, holds=h)
    daily = reports.daily_report(data, cfg)
    weekly = reports.weekly_report(data, cfg)
    assert "סיכום יום" in daily and "דוח שבועי" in weekly and "כספים" in weekly
