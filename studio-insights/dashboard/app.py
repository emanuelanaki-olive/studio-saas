"""Studio Insights dashboard.  Run:  streamlit run dashboard/app.py"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from insights import metrics as m  # noqa: E402
from insights.calendar import reminders  # noqa: E402
from insights.config import load_config  # noqa: E402
from insights.data import StudioData  # noqa: E402
from insights.ingest.excel import load_from_config, read_bookings, read_holds  # noqa: E402
from insights.reports import daily_report, weekly_report  # noqa: E402

# categorical slots 1-2 and a single-hue sequential ramp (validated reference palette)
AREA_COLORS = {"pilates": "#2a78d6", "strength": "#eb6834"}
SEQ = ["#eaf2fc", "#b9d3f3", "#7fb0e8", "#2a78d6", "#1a4f91"]

st.set_page_config(page_title="Studio Insights", page_icon="📊", layout="wide")
st.markdown("""<style>
  .stApp, .stMarkdown, [data-testid="stMetric"], [data-testid="stSidebar"] { direction: rtl; text-align: right; }
  [data-testid="stMetricValue"] { font-variant-numeric: tabular-nums; }
  .js-plotly-plot { direction: ltr; }
</style>""", unsafe_allow_html=True)

cfg = load_config()


@st.cache_data(show_spinner=False)
def _load(uploads: tuple) -> StudioData:
    if uploads:
        b = [f for name, f in uploads if "hold" not in name]
        h = [f for name, f in uploads if "hold" in name]
        return StudioData(bookings=read_bookings(b, cfg), holds=read_holds(h))
    return load_from_config(cfg)


with st.sidebar:
    st.header("נתונים")
    files = st.file_uploader("דוחות Arbox (הרשמות + הקפאות)", type="xlsx", accept_multiple_files=True)
    try:
        data = _load(tuple((f.name, f) for f in files) if files else ())
    except FileNotFoundError:
        st.info("העלו את דוח ההרשמות (shift-summary) ואת דוח ההקפאות מ-Arbox")
        st.stop()
    as_of = pd.Timestamp(st.date_input("נכון לתאריך", data.last_date.date(),
                                       min_value=data.bookings["date"].min().date(),
                                       max_value=data.last_date.date()))
    st.caption(f"נתונים: {data.bookings['date'].min():%d/%m/%Y}–{data.last_date:%d/%m/%Y} · "
               f"{len(data.bookings):,} הרשמות · {len(data.holds)} הקפאות")

sess = m.sessions(data.bookings, cfg)


def _dates(df: pd.DataFrame) -> pd.DataFrame:
    """Display copy: dd/mm/yyyy dates, whole-number plans."""
    df = df.copy()
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]):
            df[c] = df[c].dt.strftime("%d/%m/%Y")
    if "plan" in df.columns:
        df["plan"] = df["plan"].astype("Int64")
    return df


status = m.member_status(data.bookings, data.holds, cfg, as_of)
risk = m.at_risk(status, cfg)
last_month = as_of.to_period("M") - 1
pnl = m.monthly_pnl(data.bookings, sess, cfg, last_month)
week = m.occupancy_summary(sess, cfg, as_of - pd.Timedelta(days=6), as_of)

st.title(f"{cfg.studio_name} · תמונת מצב")

tabs = st.tabs(["סקירה", "תפוסה", "כספים", "מתאמנות", "הקפאות", "דוחות"])

with tabs[0]:
    cols = st.columns(len(cfg.areas) + 3)
    for col, (_, r) in zip(cols, week.iterrows()):
        col.metric(f"תפוסת {r['label']} (7 ימים)", f"{r['occupancy'] * 100:.0f}%")
    cols[-3].metric("מנויות פעילות (30 יום)", int((status["days_since"] < 30).sum()) if len(status) else 0)
    cols[-2].metric("בסיכון נטישה", len(risk))
    cols[-1].metric(f"רווח {last_month.strftime('%m/%Y')}", f"{pnl['profit']:,.0f} ₪")

    weekly = sess.assign(week=sess["date"].dt.to_period("W-SAT").dt.start_time)
    weekly = weekly.groupby(["week", "area"]).agg(occ=("occupancy", "mean")).reset_index()
    weekly["label"] = weekly["area"].map(lambda a: cfg.areas[a].label)
    fig = px.line(weekly, x="week", y="occ", color="label", markers=True,
                  color_discrete_map={cfg.areas[k].label: c for k, c in AREA_COLORS.items()},
                  labels={"week": "", "occ": "תפוסה ממוצעת", "label": "מתחם"},
                  title="תפוסה שבועית לפי מתחם")
    fig.update_traces(line_width=2, marker_size=8)
    fig.update_yaxes(tickformat=".0%", range=[0, 1], gridcolor="rgba(128,128,128,0.15)")
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("התראות")
    for r in reminders(as_of.date(), int(cfg.alerts.get("holiday_lookahead_days", 45))):
        st.info(f"📅 {r}")
    rec = m.recruiting(data.bookings, as_of)
    target = int(cfg.alerts.get("weekly_new_clients_target", 10))
    if rec["first_classes"].iloc[-1] < target:
        st.warning(f"⚠️ גיוס: {int(rec['first_classes'].iloc[-1])} שיעורים ראשונים השבוע (יעד {target})")
    if len(risk):
        st.warning(f"⚠️ {len(risk)} מנויות לא הגיעו {cfg.alerts.get('inactive_days', 14)}+ ימים - ראו לשונית 'מתאמנות'")

with tabs[1]:
    weeks = st.slider("שבועות אחורה", 2, 16, int(cfg.alerts.get("slot_lookback_weeks", 4)))
    slots = m.slot_table(sess, cfg, as_of, weeks)
    for key, area in cfg.areas.items():
        a = slots[slots["area"] == key]
        if a.empty:
            continue
        grid = a.pivot_table(index="time", columns="weekday", values="occupancy")
        grid = grid[[d for d in m.DAY_ORDER if d in grid.columns]]
        fig = go.Figure(go.Heatmap(
            z=grid.values, x=grid.columns, y=grid.index, zmin=0, zmax=1, colorscale=SEQ, xgap=2, ygap=2,
            text=[[f"{v:.0%}" if pd.notna(v) else "" for v in row] for row in grid.values],
            texttemplate="%{text}", hovertemplate="%{x} %{y}<br>תפוסה %{z:.0%}<extra></extra>",
            colorbar=dict(tickformat=".0%", title="תפוסה")))
        fig.update_layout(title=f"{area.label} · תפוסה ממוצעת לפי יום ושעה ({weeks} שבועות)",
                          yaxis=dict(autorange="reversed"), height=480)
        st.plotly_chart(fig, use_container_width=True)
    weak, strong = m.weak_and_strong_slots(slots, cfg)
    c1, c2 = st.columns(2)
    show = {"label": "מתחם", "weekday": "יום", "time": "שעה", "sessions": "שיעורים",
            "avg": "ממוצע מתאמנות", "occupancy": "תפוסה", "trainer": "מאמנת"}
    c1.subheader("שעות חלשות")
    c1.dataframe(weak[list(show)].rename(columns=show).style.format({"תפוסה": "{:.0%}", "ממוצע מתאמנות": "{:.1f}"}),
                 hide_index=True)
    c2.subheader("שעות בעומס")
    c2.dataframe(strong[list(show)].rename(columns=show).style.format({"תפוסה": "{:.0%}", "ממוצע מתאמנות": "{:.1f}"}),
                 hide_index=True)
    st.subheader("לפי מאמנת")
    tr = (m._between(sess, as_of - pd.Timedelta(weeks=weeks), as_of)
          .groupby(["trainer", "area"]).agg(שיעורים=("n", "size"), תפוסה=("occupancy", "mean"),
                                            מלאים=("full", "mean")).reset_index())
    tr["area"] = tr["area"].map(lambda a: cfg.areas[a].label)
    st.dataframe(tr.rename(columns={"trainer": "מאמנת", "area": "מתחם"}).sort_values("שיעורים", ascending=False)
                 .style.format({"תפוסה": "{:.0%}", "מלאים": "{:.0%}"}), hide_index=True)

with tabs[2]:
    months = sorted(sess["month"].unique())
    full_months = [p for p in months if p < as_of.to_period("M")]
    rows = []
    for p in full_months:
        r = m.monthly_pnl(data.bookings, sess, cfg, p)
        for key, a in r["areas"].items():
            rows.append({"חודש": str(p), "מתחם": a["label"], "הכנסה": a["revenue"], "שכר מאמנות": a["trainer_pay"],
                         "קבועות (מיוחס)": a["fixed"], "רווח": a["profit"]})
    df = pd.DataFrame(rows)
    if len(df):
        fig = px.bar(df, x="חודש", y="רווח", color="מתחם", barmode="group",
                     color_discrete_map={cfg.areas[k].label: c for k, c in AREA_COLORS.items()},
                     title="רווח חודשי לפי מתחם (ללא מע\"מ)")
        fig.update_traces(marker_line_width=0)
        fig.update_xaxes(type="category")
        fig.update_layout(bargap=0.35, bargroupgap=0.08)
        st.plotly_chart(fig, use_container_width=True)
        st.dataframe(df.style.format({c: "{:,.0f} ₪" for c in df.columns if c not in ("חודש", "מתחם")}),
                     hide_index=True)
    st.caption("הכנסה = מחיר המנוי של כל מנויה שהתאמנה בחודש, מחולק בין המתחמים לפי מספר האימונים שלה. "
               "שכר = שיעורים עם 2+ מתאמנות (שיעור בודד בין שני שיעורים = 80 ₪). "
               "הוצאות קבועות מחולקות לפי חלק האימונים.")

with tabs[3]:
    if len(status):
        c1, c2 = st.columns([1, 2])
        cu = m.cross_usage(status)
        fig = px.bar(x=cu.values, y=cu.index, orientation="h", labels={"x": "מתאמנות", "y": ""},
                     title="דפוס הגעה (פעילות 30 יום)", color_discrete_sequence=[AREA_COLORS["pilates"]])
        fig.update_traces(texttemplate="%{x}", textposition="outside", cliponaxis=False)
        fig.update_xaxes(range=[0, cu.max() * 1.2])
        c1.plotly_chart(fig, use_container_width=True)
        util = m.utilization(data.bookings, data.holds, cfg, last_month)
        if len(util):
            u = util.groupby("plan")["utilization"].mean().reset_index()
            fig = px.bar(u, x="plan", y="utilization", title=f"ניצול מנוי {last_month.strftime('%m/%Y')} (בניכוי הקפאות)",
                         labels={"plan": "כניסות במנוי", "utilization": "ניצול"},
                         color_discrete_sequence=[AREA_COLORS["pilates"]])
            fig.update_xaxes(type="category")
            fig.update_yaxes(tickformat=".0%", range=[0, 1.1])
            c2.plotly_chart(fig, use_container_width=True)
        cols = {"client": "שם", "plan": "מנוי", "pattern": "דפוס", "last": "הגעה אחרונה",
                "days_since": "ימים", "visits": "אימונים (120 יום)"}
        st.subheader(f"בסיכון נטישה ({len(risk)}) - לא הגיעו {cfg.alerts.get('inactive_days', 14)}+ ימים, לא בהקפאה")
        st.dataframe(_dates(risk[list(cols)]).rename(columns=cols), hide_index=True)
        gone = m.churned(status, cfg)
        with st.expander(f"עזבו ({len(gone)}) - לא הגיעו {cfg.alerts.get('churn_days', 30)}+ ימים"):
            st.dataframe(_dates(gone[list(cols)]).rename(columns=cols).sort_values("ימים"), hide_index=True)
        pattern = st.selectbox("רשימת מתאמנות לפי דפוס", sorted(status["pattern"].unique()))
        sel = status[(status["pattern"] == pattern) & (status["days_since"] < 30)]
        st.dataframe(_dates(sel[list(cols)]).rename(columns=cols).sort_values("אימונים (120 יום)", ascending=False),
                     hide_index=True)
        rec = m.recruiting(data.bookings, as_of, 12).reset_index(names="week")
        rec["week"] = rec["week"].dt.start_time
        fig = px.bar(rec, x="week", y="first_classes", title="שיעורים ראשונים בשבוע",
                     labels={"week": "", "first_classes": "מתאמנות חדשות"},
                     color_discrete_sequence=[AREA_COLORS["strength"]])
        fig.add_hline(y=int(cfg.alerts.get("weekly_new_clients_target", 10)), line_dash="dot",
                      annotation_text="יעד", line_color="gray")
        st.plotly_chart(fig, use_container_width=True)

with tabs[4]:
    h = data.holds
    if len(h):
        act = m.active_holds(h, as_of)
        rep = m.repeat_freezers(h, cfg, as_of)
        c1, c2 = st.columns(2)
        c1.metric("בהקפאה כרגע", len(act))
        c2.metric("הקפאות חוזרות", len(rep))
        rows = []
        for p in pd.period_range(h["start"].min(), as_of, freq="M"):
            s = m.holds_summary(h, p.start_time, min(p.end_time.normalize(), as_of))
            rows.append({"חודש": p.strftime("%m/%Y"), "ימי הקפאה": s["days"], "מנויות": s["members"]})
        fig = px.bar(pd.DataFrame(rows), x="חודש", y="ימי הקפאה", title="ימי הקפאה בחודש",
                     color_discrete_sequence=[AREA_COLORS["pilates"]], hover_data=["מנויות"])
        st.plotly_chart(fig, use_container_width=True)
        st.subheader("בהקפאה כרגע")
        st.dataframe(_dates(act[["client", "start", "end", "reason"]]).rename(
            columns={"client": "שם", "start": "מ", "end": "עד", "reason": "סיבה"}), hide_index=True)
        st.subheader("הקפאות חוזרות")
        st.dataframe(_dates(rep).rename(columns={"client": "שם", "holds": "הקפאות", "days": "ימים", "last": "אחרונה"}),
                     hide_index=True)

with tabs[5]:
    c1, c2 = st.columns(2)
    c1.subheader("דוח יומי")
    c1.code(daily_report(data, cfg, as_of), language=None)
    c2.subheader("דוח שבועי")
    c2.code(weekly_report(data, cfg, as_of), language=None)
