// Alerts — Master-Detail Split Triage Workspace (V2.2: Zero screen bouncing, inline search, ✦ Investigation Agent).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { alertsApi, type AlertItem, type AlertSummary } from "../api/alerts";
import { investigationApi, type EventDetail } from "../api/investigation";
import { FlowFilter } from "../components/FlowFilter";
import { Icon } from "../components/Icon";
import { Empty, ListSkeleton, LoadError, useNow, useToast } from "../components/ui";
import { ago, dayTime } from "../format";
import {
  ACTION_MEANS, alertOrder, checkMove, count, eventTitle, impactText, LEVEL_LABEL, LEVEL_TONE, sizeTiming, sourceInfo,
} from "../plain";

type Show = "new" | "acknowledged" | "resolved" | "all";
const CHANGE: Record<string, string> = {
  raised: "Raised", escalated: "More evidence", acknowledged: "Acknowledged", resolved: "Resolved", reopened: "Reopened",
  confirmed: "Confirmed by your data", withdrawn: "Withdrawn", checked: "Checked against your data",
};
const AGENT = "AMIRI Agent";
const isAgent = (by: string | null | undefined) => (by ?? "").toLowerCase() === AGENT.toLowerCase();
const changed = (a: AlertItem) => [...a.history].reverse().find(h => isAgent(h.by) && h.change !== "resolved")?.at ?? a.created_at;
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const lead = (a: AlertItem) => a.effects.find(e => e.check?.alert === a.level) ?? a.effects[0];
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const what = (a: AlertItem) => { const e = lead(a); return capFirst(e ? impactText(e.metric_name, e.direction) : a.title); };
const toneBadge = (t: string) => t === "red" ? "b-down" : t === "amber" ? "b-warn" : "b-ok";

function runs(a: AlertItem) {
  const out: { change: string; by: string; n: number; at: string }[] = [];
  for (const h of a.history) {
    const by = isAgent(h.by) ? "" : h.by ?? "", last = out[out.length - 1];
    if (last && last.change === h.change && last.by === by) { last.n++; last.at = h.at; }
    else out.push({ change: h.change, by, n: 1, at: h.at });
  }
  return out.reverse();
}

export function AlertsPage() {
  const toast = useToast();
  const now = useNow(60_000);
  const [show, setShow] = useState<Show>("new");
  const [team, setTeam] = useState("");
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [sum, setSum] = useState<AlertSummary | null>(null);
  const [events, setEvents] = useState<Record<string, EventDetail>>({});
  const [err, setErr] = useState<unknown>(null);
  const [asking, setAsking] = useState<"ack" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, xs] = await Promise.all([alertsApi.summary(), alertsApi.list({ status: show === "all" ? undefined : show, owner: team || undefined })]);
      setSum(s); setItems(xs); setErr(null);
    } catch (e) { setErr(e); }
  }, [show, team]);

  useEffect(() => setItems(null), [show, team]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const queue = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    return [...items]
      .filter(a => {
        if (show !== "all" && a.status !== show) return false;
        if (levelFilter && a.level !== levelFilter) return false;
        if (!q) return true;
        return [a.title, a.owner, a.event_title, a.top_finding ?? "", ...a.effects.map(e => `${e.product} ${e.metric_name} ${e.chain_label}`)].join(" ").toLowerCase().includes(q);
      })
      .sort((x, y) => alertOrder({ ...x, at: changed(x) }, { ...y, at: changed(y) }));
  }, [items, show, query, levelFilter]);

  const cur = queue?.find(a => a.alert_id === selId) ?? queue?.[0] ?? null;

  useEffect(() => {
    setAsking(null); setNote("");
    if (!cur || events[cur.event_id]) return;
    investigationApi.event(cur.event_id).then(ev => setEvents(m => ({ ...m, [cur.event_id]: ev }))).catch(() => {});
  }, [cur?.alert_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nAt = (k: Show, owner = team) =>
    sum?.by_team_status?.filter(r => (!owner || r.owner === owner) && (k === "all" || r.status === k)).reduce((n, r) => n + r.n, 0);

  const act = async (a: AlertItem, action: "ack" | "resolve" | "reopen") => {
    setBusy(true);
    try {
      const updated = await alertsApi.act(a.alert_id, action, note);
      setItems(xs => (xs ?? []).map(x => (x.alert_id === updated.alert_id ? updated : x)));
      alertsApi.summary().then(setSum).catch(() => {});
      window.dispatchEvent(new Event("amiri:alerts"));
      setAsking(null); setNote("");
      toast({ ack: "Acknowledged: your team can see you're on it", resolve: "Resolved", reopen: "Back on the review list" }[action]);
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };

  const ev = cur ? events[cur.event_id] : undefined;
  const evName = (a: AlertItem) => (events[a.event_id] ? eventTitle(events[a.event_id]) : a.event_title);
  const products = cur ? [...new Set(cur.effects.map(e => e.product))] : [];
  const src = cur?.sources?.[0] ? sourceInfo(cur.sources[0]) : null;
  const article = cur ? ev?.findings.flatMap(f => f.evidence?.headlines ?? []).find(h => h.url && (!cur.top_finding || h.title === cur.top_finding)) : undefined;

  return (
    <div className="eos-pad" style={{ paddingBottom: 0 }}>
      <div className="eos-hd">
        <div>
          <div className="label">Team Action Queue</div>
          <h1>
            {sum ? (sum.to_review ? <><span style={{ color: "var(--critical-ink)" }}>{count(sum.to_review, "alert")}</span> waiting across {count(sum.teams.length, "team")}</> : "All caught up") : "Alerts"}
          </h1>
        </div>
        <button className="btn btn--ghost btn--sm" type="button" onClick={load}><Icon name="refresh" />Refresh</button>
      </div>

      {err != null && <LoadError error={err} onRetry={load} what="the alerts" />}

      <div className="eos-filterbar" style={{ marginBottom: 0 }}>
        <div className="eos-search">
          <Icon name="search" />
          <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search alerts" placeholder="Search alerts, products, teams, or events…" />
        </div>
        <select className="eos-select" aria-label="Filter by severity" value={levelFilter} onChange={e => setLevelFilter(e.target.value)}>
          <option value="">All severities</option>
          <option value="adverse">Confirmed</option>
          <option value="developing">Showing early signs</option>
          <option value="warning">Early warning</option>
        </select>
        {sum && sum.all_teams.length > 1 && (
          <select className="eos-select" aria-label="Filter by team" value={team} onChange={e => setTeam(e.target.value)}>
            <option value="">All teams ({sum.all_teams.length})</option>
            {sum.all_teams.map(t => <option key={t} value={t}>{t} ({nAt(show, t)})</option>)}
          </select>
        )}
        <FlowFilter toned label="Which alerts" value={show} onChange={setShow} all={{ key: "all", label: "All", count: nAt("all") }}
          steps={([["new", "To review", "queued"], ["acknowledged", "Acknowledged", "held"], ["resolved", "Resolved", "done"]] as const)
            .map(([key, label, state]) => ({ key, label, count: nAt(key), state }))} />
      </div>

      {queue === null ? (err == null && <div className="mt12"><ListSkeleton rows={4} /></div>)
        : queue.length === 0 ? <div className="mt16"><Empty icon="check" title="No alerts in this view" actions={<Link className="btn" to="/events">View open events</Link>}>Adjust filters or check back after the next sweep.</Empty></div>
        : (
          <div className="eos-split">
            {/* Left Queue */}
            <div className="eos-list">
              {queue.map(a => (
                <button key={a.alert_id} type="button" className="eos-row" data-selected={cur?.alert_id === a.alert_id} onClick={() => setSelId(a.alert_id)}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className={`badge ${toneBadge(LEVEL_TONE[a.level])}`}>{LEVEL_LABEL[a.level]}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>{a.owner}</span>
                    <span className="mono small muted" style={{ marginLeft: "auto" }}>{ago(changed(a), now)}</span>
                  </div>
                  <strong style={{ color: "var(--ink)", fontSize: 14 }}>{what(a)}</strong>
                  <span className="small muted">{evName(a)} · {count(a.effects.length, "impact")}</span>
                </button>
              ))}
            </div>

            {/* Right Live Inspector */}
            {cur && (
              <div className="eos-insp">
                <div className="eos-hd">
                  <div>
                    <div className="label">{cur.owner} · <Link to={`/events/${cur.event_id}`}>{evName(cur)} ↗</Link></div>
                    <h2 style={{ fontSize: 21, marginTop: 2 }}>{what(cur)}</h2>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {cur.status === "acknowledged" && (
                      <span className="eos-ack-win">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><path d="m8 12.5 2.5 2.5 5.5-5.5" /></svg>
                        Acknowledged
                      </span>
                    )}
                    {cur.status === "new" && !asking && (
                      <button className="btn btn--primary" type="button" title={ACTION_MEANS.ack} onClick={() => setAsking("ack")}>Acknowledge</button>
                    )}
                    {cur.status !== "resolved" && !asking && (
                      <button className="btn" type="button" title={ACTION_MEANS.resolve} onClick={() => setAsking("resolve")}>Resolve</button>
                    )}
                    {cur.status !== "new" && !asking && (
                      <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => act(cur, "reopen")}>Reopen</button>
                    )}
                  </div>
                </div>

                {asking && (
                  <div className="eos-focal row wrap" style={{ gap: 8 }}>
                    <input className="input" style={{ flex: 1, minWidth: 220 }} autoFocus value={note} onChange={e => setNote(e.target.value)}
                      placeholder={asking === "ack" ? "Optional note for your team…" : "Optional resolution note…"}
                      onKeyDown={e => { if (e.key === "Enter") act(cur, asking); if (e.key === "Escape") { setAsking(null); setNote(""); } }} />
                    <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => act(cur, asking)}>
                      {asking === "ack" ? "Confirm acknowledge" : "Confirm resolve"}
                    </button>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setAsking(null); setNote(""); }}>Cancel</button>
                  </div>
                )}

                {/* ✦ Investigation Agent Why-It-Matters Strip */}
                <div className="eos-ai">
                  <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>Investigation Agent · Why AMIRI expects this</div>
                  <div className="eos-ai-bd">
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                      {cur.effects.map(e => {
                        const m = e.check ? checkMove(e.check.what) : null;
                        return <li key={e.hypothesis_id}><b>{e.product}</b>: {lower(impactText(e.metric_name, e.direction))} — {lower(e.chain_label)}. <span className="muted">{sizeTiming(e.size, e.timing)}.</span>{m && <> Your data: <b>{m.move}</b> {m.against}.</>}</li>;
                      })}
                    </ul>
                  </div>
                  <div className="eos-ai-meta">
                    <span>Basis: <b>{cur.basis === "data" ? "Validated against bank data" : "Expected (early warning)"}</b></span>
                    {cur.top_finding && <span>Source: {article?.url ? <a href={article.url} target="_blank" rel="noreferrer">{cur.top_finding} ↗</a> : cur.top_finding}</span>}
                    {src && <span>Via {src.label}</span>}
                  </div>
                </div>

                <div>
                  <span className="label">Impacted Products ({products.length})</span>
                  <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                    {products.map(p => <span key={p} className="chip">{p}</span>)}
                  </div>
                </div>

                <details className="eos-fold" open>
                  <summary>Audit trail ({runs(cur).length} entries)</summary>
                  <div className="eos-fold-bd col" style={{ gap: 4 }}>
                    {runs(cur).map((r, i) => (
                      <div key={i}><b>{CHANGE[r.change] ?? r.change}{r.n > 1 ? ` (${r.n}×)` : ""}</b> · <span className="mono">{dayTime(r.at)}</span>{r.by ? ` · ${r.by}` : ""}</div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
