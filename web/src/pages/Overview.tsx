// Command (Overview): Cardless Enterprise Risk Posture matching V2.2 design.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { inst, type Check, type Profile } from "../api/institutions";
import { overviewApi, type Attention, type Overview } from "../api/overview";
import { Icon } from "../components/Icon";
import { Banner, DEMOS, errText, isDown, LoadError, PageHead, PageSkeleton, useNow, useRole } from "../components/ui";
import { ago, pct, plural, price, TIME_ZONE, ZONE_LABEL } from "../format";
import { eventTitle } from "../plain";
import { ProfileMap } from "./institution/ProfileMap";
import { TAB_OF_SECTION } from "./institution/InstitutionPage";

const REFRESH_MS = 60_000;
const RANK = { bad: 0, mixed: 1, good: 2, neutral: 3 };
const SHAPE = { bad: "▲", good: "●", mixed: "◆", neutral: "■" };
const TONE_CLS = { bad: "b-down", good: "b-ok", mixed: "b-warn", neutral: "b-noeffect" };
const TONE_WORD = { bad: "Bad", good: "Good", mixed: "Mixed", neutral: "Neutral" };

const longDate = (now: Date) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE }).format(now);
const plainNote = (t: string) => t.replace(/^(.+?): No new bar since (.+?) \(.*\)\.?$/, "$1: prices haven't updated since $2");

function FirstRun({ o }: { o: Overview }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadDemo = async (kind: string) => {
    setBusy(kind); setErr(null);
    try {
      const r = await fetch("/api/v1/prototype:demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(p.detail ?? `HTTP ${r.status}`); }
      window.location.assign("/home");
    } catch (e) { setErr(String((e as Error).message ?? e)); setBusy(null); }
  };
  return (
    <div className="eos-pad">
      <div className="eos-hd">
        <div>
          <span className="label">Welcome</span>
          <h1>Set up AMIRI Agent</h1>
          <p className="sub">Load a sample institution in one click, or configure your own bank or insurer.</p>
        </div>
        <Link className="btn btn--primary" to={o.institution ? "/institution/setup" : "/institution/new"}>
          <Icon name="chat" />{o.institution ? "Continue setup" : "Start custom setup"}
        </Link>
      </div>
      {!o.institution && (
        <div className="eos-focal col" style={{ gap: 12 }}>
          <span className="label">Fastest way in</span>
          <h2>Start with a sample institution</h2>
          <div className="row wrap" style={{ gap: 10 }}>
            {DEMOS.map((d, n) => (
              <button key={d.kind} className={`btn${n === 0 ? " btn--primary" : ""}`} type="button" disabled={!!busy} onClick={() => loadDemo(d.kind)}>
                <Icon name={d.kind === "bank" ? "bank" : "health"} />
                {busy === d.kind ? "Loading…" : `Load ${d.name}`}
              </button>
            ))}
          </div>
          {err && <div className="errtext" role="alert">{err}</div>}
        </div>
      )}
    </div>
  );
}

export function OverviewPage() {
  const nav = useNavigate();
  const now = useNow(30_000);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [o, setO] = useState<Overview | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recs, setRecs] = useState<Check[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const x = await overviewApi.get(admin);
      setO(x); setErr(null); setLoadedAt(new Date());
      if (x.institution && !x.first_run) {
        inst.profile(x.institution.institution_id).then(setProfile).catch(() => {});
        if (x.attention.some(a => a.kind === "recommended")) {
          inst.readiness(x.institution.institution_id).then(r => setRecs(r.checks.filter(c => c.level === "recommended" && !c.ok))).catch(() => {});
        }
      }
    } catch (e) { setErr(e); }
  }, [admin]);

  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t); }, [load]);

  if (!o) return <div className="eos-pad">{err ? <><PageHead title="Command" /><LoadError error={err} onRetry={load} /></> : <PageSkeleton bare />}</div>;
  if (o.first_run) return <FirstRun o={o} />;

  const i = o.institution!;
  const c = o.counts;
  const s = o.services;
  const f24 = c.findings_24h.timeseries + c.findings_24h.monitor + c.findings_24h.radar;
  const sources = c.monitors_live + c.series_watched + (s.radar.connected ? 1 : 0);
  const sortedEvents = [...o.events].sort((x, y) => RANK[x.tone] - RANK[y.tone]);
  const bad = sortedEvents.filter(e => e.tone === "bad");
  const alerts = c.alerts_to_review;
  const movedMarkets = o.markets.filter(m => m.state === "moved" || m.state === "stale");
  const rest: Attention[] = o.attention.filter(a => a.kind !== "alerts");
  const sentRadar = o.radar.stories.filter(r => r.status === "sent").length;

  return (
    <div className="eos-pad">
      {err != null && <Banner kind="warn" icon="warn">Couldn't refresh: {isDown(err) ? "AMIRI Agent didn't answer" : errText(err)}. Showing data from {loadedAt ? ago(loadedAt.toISOString(), now) : "earlier"}.</Banner>}

      {/* Header */}
      <div className="eos-hd">
        <div>
          <div className="label">Executive Risk Posture · {longDate(now)} · {ZONE_LABEL}</div>
          <h1>
            {alerts > 0 ? <><span style={{ color: "var(--critical-ink)" }}>{plural(alerts, "alert")}</span> require team triage</>
              : o.events.length > 0 ? `${plural(o.events.length, "open event")} under watch`
              : "All clear — no open risks"}
          </h1>
          <p className="sub">
            {bad.length > 0
              ? <>Primary exposure: <Link to={`/events/${bad[0].event_id}`}><b>{eventTitle(bad[0])}</b></Link> ({plural(bad[0].effects, "impact")}){bad[1] ? <> and <Link to={`/events/${bad[1].event_id}`}><b>{eventTitle(bad[1])}</b></Link> ({plural(bad[1].effects, "impact")})</> : null}.</>
              : <>AMIRI Agent is continuously watching {plural(sources, "source")} for {i.name}.</>}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn--primary" to={alerts > 0 ? "/alerts" : "/events"}>
            {alerts > 0 ? `Open Alert Triage (${alerts}) →` : "View Open Events →"}
          </Link>
          <Link className="btn btn--ghost" to="/studio">Scenario Studio</Link>
          <button className="btn btn--ghost btn--icon" type="button" aria-label="Refresh" onClick={load}><Icon name="refresh" /></button>
        </div>
      </div>

      {/* ✦ Multi-Agent Synthesis Strip */}
      <div className="eos-ai">
        <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>AMIRI Multi-Agent Synthesis · Why today matters to {i.name}</div>
        <div className="eos-ai-bd">
          <b>Radar Agent</b> ({sentRadar} sent), <b>Monitor Agent</b> ({c.monitors_live} live), and <b>Market Series</b> ({c.series_watched} watched) surfaced <b>{plural(f24, "finding")}</b> in the last 24h. <b>Investigation Agent</b> traced <b>{plural(c.effects_to_watch, "product impact")}</b> across <b>{plural(c.open_events, "open event")}</b>.
        </div>
        <div className="eos-ai-meta">
          <span>✦ Monitors: {c.monitors_live} live{c.monitors_waiting_approval ? ` · ${c.monitors_waiting_approval} pending approval` : ""}</span>
          {movedMarkets.length > 0 && <span>◆ Market anomaly: <b>{movedMarkets[0].name}</b> ({price(movedMarkets[0].close)})</span>}
          {loadedAt && <span>Updated {ago(loadedAt.toISOString(), now)}</span>}
        </div>
      </div>

      {/* 4-Stage Cardless Hairline Ledger */}
      <div className="eos-ledger" role="group" aria-label="Risk intelligence pipeline">
        <Link to="/monitors" className="eos-ledger-cell">
          <span className="eos-l-step">01 · Surveillance</span>
          <span className="eos-l-val">{sources}</span>
          <span className="eos-l-meta">{c.monitors_live} monitors · {c.series_watched} series · {s.radar.connected ? "Radar" : "Radar off"}</span>
        </Link>
        <Link to="/findings" className="eos-ledger-cell">
          <span className="eos-l-step">02 · Findings (24h)</span>
          <span className="eos-l-val">{f24}</span>
          <span className="eos-l-meta">{[c.findings_24h.monitor && `${c.findings_24h.monitor} news`, c.findings_24h.timeseries && `${c.findings_24h.timeseries} prices`, c.findings_24h.radar && `${c.findings_24h.radar} Radar`].filter(Boolean).join(" · ") || "Quiet in last 24h"}</span>
        </Link>
        <Link to="/events" className="eos-ledger-cell">
          <span className="eos-l-step">03 · Open Events</span>
          <span className="eos-l-val">{c.open_events}</span>
          <span className="eos-l-meta">{bad.length} adverse · {plural(c.effects_to_watch, "impact")}</span>
        </Link>
        <Link to="/alerts" className="eos-ledger-cell">
          <span className="eos-l-step">04 · Pending Action</span>
          <span className={`eos-l-val${alerts > 0 ? " hot" : ""}`}>{alerts}</span>
          <span className="eos-l-meta">{alerts > 0 ? "Alerts waiting for teams" : "All caught up"}</span>
        </Link>
      </div>

      {/* Clean 2-Column Editorial Grid: Left = Focal Corridor Map, Right = Priority Signals Table + Governance */}
      <div className="eos-cmd-grid">
        <div className="eos-focal">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>Corridor &amp; Exposure Map</span>
            {bad.length > 0 && <span className="badge b-down">▲ {bad.length} adverse</span>}
          </div>
          {profile ? (
            <ProfileMap profile={profile} height={270} compact layers={["footprint", "flows", "risks"]}
              events={o.events.map(e => ({ event_id: e.event_id, title: eventTitle(e), tone: e.tone, places: e.places }))}
              extraPlaces={o.map.places} onEvent={id => nav(`/events/${id}`)} />
          ) : <div className="small muted" style={{ padding: "40px 0", textAlign: "center" }}>Loading footprint map…</div>}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <h2>Priority Signals</h2>
              <Link to="/events" className="small" style={{ fontWeight: 600 }}>All {c.open_events} events →</Link>
            </div>
            <table className="eos-tbl">
              <thead><tr><th>Signal / Event</th><th>Impact</th><th className="r">Status</th></tr></thead>
              <tbody>
                {sortedEvents.slice(0, 4).map(e => (
                  <tr key={e.event_id} className="click" onClick={() => nav(`/events/${e.event_id}`)}>
                    <td>
                      <span className={`badge ${TONE_CLS[e.tone]}`} style={{ marginRight: 8 }}>{SHAPE[e.tone]} {TONE_WORD[e.tone]}</span>
                      <strong style={{ color: "var(--ink)" }}>{eventTitle(e)}</strong>
                    </td>
                    <td className="mono">{e.effects > 0 ? `${e.effects} lines` : "None"}</td>
                    <td className="r small muted">{ago(e.last_finding_at, now)}</td>
                  </tr>
                ))}
                {o.markets.slice(0, 2).map(m => (
                  <tr key={m.series_id} className="click" onClick={() => nav(`/series/${m.series_id}`)}>
                    <td>
                      <span className={`badge ${m.state === "moved" ? "b-warn" : "b-noeffect"}`} style={{ marginRight: 8 }}>
                        {m.state === "moved" ? "◆ Unusual" : "FX/Mkt"}
                      </span>
                      <strong style={{ color: "var(--ink)" }}>{m.name}</strong>
                    </td>
                    <td className="mono">{price(m.close)}</td>
                    <td className="r mono small" style={{ color: (m.change_1d_pct ?? 0) < 0 ? "var(--critical-ink)" : "var(--ink-3)" }}>{pct(m.change_1d_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(rest.length > 0 || recs.length > 0) && (
            <details className="eos-fold" open>
              <summary>Pending approvals &amp; governance ({rest.length})</summary>
              <div className="eos-fold-bd col" style={{ gap: 8 }}>
                {rest.slice(0, 4).map((a, idx) => (
                  <div key={idx} className="row" style={{ gap: 10 }}>
                    <span className={`badge ${a.level === "crit" ? "b-down" : a.level === "warn" ? "b-warn" : "b-info"}`}>
                      {a.kind === "recommended" ? "Profile" : a.level === "warn" ? "Check" : "Action"}
                    </span>
                    <span style={{ color: "var(--ink)", flex: 1 }}>{plainNote(a.title)}</span>
                    {a.link && <Link className="btn btn--sm" to={a.link}>Open →</Link>}
                  </div>
                ))}
                {recs.slice(0, 2).map(r => (
                  <div key={r.id} className="row" style={{ gap: 10 }}>
                    <span className="badge b-warn">Profile</span>
                    <span className="small" style={{ flex: 1 }}>{r.message}</span>
                    <Link className="btn btn--sm" to={`/institution/${TAB_OF_SECTION[r.section] ?? "overview"}`}>Fix →</Link>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
