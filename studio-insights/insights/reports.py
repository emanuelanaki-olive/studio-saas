"""Hebrew text reports: a short daily report and a full weekly (Sunday) report."""
from __future__ import annotations

import pandas as pd

from . import metrics as m
from .calendar import reminders
from .config import Config
from .data import StudioData


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def _ils(x: float) -> str:
    return f"{x:,.0f} ₪"


def _arrow(now: float, before: float) -> str:
    if not before:
        return ""
    d = (now - before) / before
    if abs(d) < 0.03:
        return " (≈)"
    return f" ({'▲' if d > 0 else '▼'}{abs(d) * 100:.0f}%)"


def daily_report(data: StudioData, cfg: Config, day=None) -> str:
    day = pd.Timestamp(day or data.last_date).normalize()
    sess = m.sessions(data.bookings, cfg)
    today = m.occupancy_summary(sess, cfg, day, day)
    prev = m.occupancy_summary(sess, cfg, day - pd.Timedelta(days=28), day - pd.Timedelta(days=1))
    lines = [f"📊 {cfg.studio_name} · סיכום יום {m.HE_DAYS[day.dayofweek]} {day:%d/%m}"]
    if today["sessions"].sum() == 0:
        lines.append("לא התקיימו שיעורים היום.")
    for _, r in today.iterrows():
        p = prev[prev["area"] == r["area"]].iloc[0]
        lines.append(f"• {r['label']}: {r['sessions']} שיעורים, {r['bookings']} מתאמנות, "
                     f"תפוסה {_pct(r['occupancy'])} (ממוצע 4 שבועות {_pct(p['occupancy'])})")
    b_today = data.bookings[data.bookings["date"] == day]
    no_show = int((~b_today["checked_in"]).sum())
    first = b_today[b_today["first_class"]]["client"].nunique()
    lines.append(f"• אי-הגעה: {no_show} · שיעור ראשון: {first}")

    starts = data.holds[data.holds["start"] == day]
    ends = data.holds[data.holds["end"] == day]
    if len(starts) or len(ends):
        lines.append(f"• הקפאות: {len(starts)} התחילו, {len(ends)} מסתיימות היום")

    status = m.member_status(data.bookings, data.holds, cfg, day)
    risk = m.at_risk(status, cfg)
    if len(risk):
        lo = int(cfg.alerts.get("inactive_days", 14))
        new = risk[risk["days_since"] == lo]
        lines.append(f"⚠️ {len(risk)} מנויות לא הגיעו {lo}+ ימים (לא בהקפאה)"
                     + (f" · חדשות היום: {', '.join(new['client'])}" if len(new) else ""))

    tomorrow = day + pd.Timedelta(days=1)
    t = sess[sess["date"] == tomorrow]
    if len(t):
        low = t[t["n"] < int(cfg.cancellation.get("min_bookings", 2))]
        full = t[t["full"]]
        lines.append(f"🗓️ מחר: {len(t)} שיעורים עם הרשמות · {len(full)} מלאים"
                     + (f" · בסכנת ביטול: {', '.join(low['time'] + ' ' + low['class_name'])}" if len(low) else ""))
    for r in reminders(tomorrow.date(), lookahead_days=7):
        lines.append(f"📅 {r}")
    return "\n".join(lines)


def weekly_report(data: StudioData, cfg: Config, as_of=None) -> str:
    as_of = pd.Timestamp(as_of or data.last_date).normalize()
    week_start = as_of - pd.Timedelta(days=6)
    sess = m.sessions(data.bookings, cfg)
    wk = m.occupancy_summary(sess, cfg, week_start, as_of)
    base = m.occupancy_summary(sess, cfg, week_start - pd.Timedelta(days=28), week_start - pd.Timedelta(days=1))
    L = [f"📈 {cfg.studio_name} · דוח שבועי {week_start:%d/%m}–{as_of:%d/%m}", ""]

    L.append("*תפוסה השבוע* (מול ממוצע 4 השבועות הקודמים)")
    for _, r in wk.iterrows():
        b = base[base["area"] == r["area"]].iloc[0]
        L.append(f"• {r['label']}: {r['bookings']} הרשמות{_arrow(r['bookings'], b['bookings'] / 4)}, "
                 f"ממוצע {r['avg_per_class']} בשיעור, תפוסה {_pct(r['occupancy'])}{_arrow(r['occupancy'], b['occupancy'])}, "
                 f"מלאים {_pct(r['full_share'])}")
    L.append("")

    slots = m.slot_table(sess, cfg, as_of)
    weak, strong = m.weak_and_strong_slots(slots, cfg)
    if len(weak):
        L.append("*שעות חלשות* (4 שבועות)")
        for _, r in weak.head(8).iterrows():
            L.append(f"• {r['label']} {r['weekday']} {r['time']}: {_pct(r['occupancy'])} ({r['avg']:.1f} בממוצע)")
        L.append("")
    if len(strong):
        L.append("*שעות בעומס*")
        for _, r in strong.head(8).iterrows():
            L.append(f"• {r['label']} {r['weekday']} {r['time']}: {_pct(r['occupancy'])}, מלא ב-{_pct(r['full_share'])} מהפעמים")
        L.append("")

    this_month = as_of.to_period("M")
    last_month = this_month - 1
    L.append("*כספים* (ללא מע\"מ, הכנסה משוערת לפי מנויות פעילות)")
    p = m.monthly_pnl(data.bookings, sess, cfg, last_month)
    if p["members"]:
        per_area = " | ".join(f"{a['label']} {_ils(a['profit'])}" for a in p["areas"].values())
        L.append(f"• {last_month.strftime('%m/%Y')}: הכנסה {_ils(p['revenue'])}, שכר {_ils(p['trainer_pay'])}, "
                 f"קבועות {_ils(p['fixed'])} → רווח {_ils(p['profit'])}")
        L.append(f"   לפי מתחם: {per_area} · נקודת איזון ≈ {p['break_even_members']} מנויות (יש {p['members']})")
    cur = m.monthly_pnl(data.bookings, sess, cfg, this_month, as_of)
    if cur["members"]:
        # revenue arrives up front while costs accrue daily, so a month-to-date profit would mislead
        L.append(f"• החודש עד כה: {cur['members']} מנויות פעילות, הכנסה {_ils(cur['revenue'])}, "
                 f"שכר מאמנות עד כה {_ils(cur['trainer_pay'])}")
    L.append("")

    status = m.member_status(data.bookings, data.holds, cfg, as_of)
    cu = m.cross_usage(status)
    if len(cu):
        L.append("*מתאמנות פעילות (30 יום)*: " + " · ".join(f"{k} {v}" for k, v in cu.items()))
    util = m.utilization(data.bookings, data.holds, cfg, last_month)
    if len(util):
        u = util.groupby("plan")["utilization"].mean()
        low = (util["utilization"] < float(cfg.alerts.get("low_utilization", 0.6))).sum()
        L.append("*ניצול מנוי* (חודש קודם, בניכוי הקפאות): "
                 + " · ".join(f"{int(k)} כניסות {_pct(v)}" for k, v in u.items())
                 + f" · {low} מנויות מתחת ל-60%")
    L.append("")

    risk = m.at_risk(status, cfg)
    gone = m.churned(status, cfg)
    gone_week = gone[gone["days_since"] < int(cfg.alerts.get("churn_days", 30)) + 7]
    L.append(f"*שימור*: {len(risk)} בסיכון (לא הגיעו {cfg.alerts.get('inactive_days', 14)}+ ימים), "
             f"{len(gone_week)} עברו את סף ה-{cfg.alerts.get('churn_days', 30)} יום השבוע")
    for _, r in risk.head(15).iterrows():
        L.append(f"• {r['client']} · מנוי {int(r['plan'])} · {r['pattern']} · {r['days_since']} ימים")
    L.append("")

    rec = m.recruiting(data.bookings, as_of)
    target = int(cfg.alerts.get("weekly_new_clients_target", 10))
    this_wk = int(rec["first_classes"].iloc[-1])
    avg = rec["first_classes"].iloc[:-1].mean()
    tried, conv = m.trial_conversion(data.bookings)
    L.append(f"*גיוס*: {this_wk} שיעורים ראשונים השבוע (ממוצע {avg:.1f}, יעד {target})"
             + (f" · המרת היכרות למנוי {_pct(conv / tried)}" if tried else ""))
    L.append("")

    hs = m.holds_summary(data.holds, week_start, as_of)
    rep = m.repeat_freezers(data.holds, cfg, as_of)
    act = m.active_holds(data.holds, as_of)
    L.append(f"*הקפאות*: {len(act)} בהקפאה כרגע · {hs['days']} ימי הקפאה השבוע"
             + (f" · הקפאות חוזרות: {', '.join(rep['client'] + ' (' + rep['holds'].astype(str) + ')')}" if len(rep) else ""))
    L.append("")

    recs = recommendations(data, cfg, as_of, wk, weak, strong, risk, this_wk, target)
    if recs:
        L.append("*המלצות*")
        L += [f"{i}. {r}" for i, r in enumerate(recs, 1)]
        L.append("")
    cal = reminders(as_of.date(), int(cfg.alerts.get("holiday_lookahead_days", 45)))
    if cal:
        L.append("*לוח שנה*")
        L += [f"📅 {c}" for c in cal]
    return "\n".join(L).strip()


def recommendations(data, cfg, as_of, wk, weak, strong, risk, new_this_week, target) -> list[str]:
    out = []
    if len(weak):
        saving = sum(cfg.areas[a].trainer_pay for a in weak["area"]) * 4.3
        names = ", ".join(f"{r['label']} {r['weekday']} {r['time']}" for _, r in weak.head(4).iterrows())
        out.append(f"לשקול ביטול/איחוד של {len(weak)} שעות חלשות ({names}) - חיסכון של עד {_ils(saving)} בחודש")
    if len(strong):
        names = ", ".join(f"{r['label']} {r['weekday']} {r['time']}" for _, r in strong.head(4).iterrows())
        out.append(f"ביקוש עודף ב-{names}: להוסיף שיעור סמוך או להגדיל קיבולת")
    if len(risk):
        out.append(f"להתקשר ל-{len(risk)} מנויות שלא הגיעו שבועיים (רשימה למעלה) - שיחה אישית מצילה חלק מהעזיבות")
    if new_this_week < target:
        out.append(f"הגיוס מתחת ליעד ({new_this_week}/{target}): לבדוק קמפיין ממומן ולפנות ללידים פתוחים")
    if len(wk) > 1 and wk["occupancy"].max() - wk["occupancy"].min() > 0.2:
        lo = wk.loc[wk["occupancy"].idxmin()]
        out.append(f"תפוסת {lo['label']} נמוכה משמעותית - להציע אימון התנסות למתאמנות שמגיעות רק למתחם השני")
    return out
