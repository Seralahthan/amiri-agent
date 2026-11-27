// Alerts — Master-Detail Split Triage Workspace (V2.2: Zero screen bouncing, inline search, ✦ Investigation Agent).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { alertsApi, type AlertItem, type AlertSummary } from "../api/alerts";
import { investigationApi, type EventDetail, type EventRow } from "../api/investigation";
import { Fold } from "../components/blocks";
import { FlowFilter } from "../components/FlowFilter";
import { Icon } from "../components/Icon";
import { SearchInput } from "../components/SearchInput";
import { SelectMenu } from "../components/SelectMenu";
import { Empty, ListSkeleton, LoadError, useNow, useToast } from "../components/ui";
import { ago, dayTime, person } from "../format";
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
  const [sp, setSp] = useSearchParams();
  const rawShow = sp.get("status") as Show | null;
  const show: Show = rawShow && ["new", "acknowledged", "resolved", "all"].includes(rawShow) ? rawShow : "new";
  const team = sp.get("team") ?? "";
  const query = sp.get("q") ?? "";
  const levelFilter = sp.get("level") ?? "";
  const eventFilter = sp.get("event") ?? "";
  const selId = sp.get("alert") ?? null;

  const setParam = useCallback((key: string, val: string, def = "") => {
    setSp(prev => {
      const next = new URLSearchParams(prev);
      if (!val || val === def) next.delete(key); else next.set(key, val);
      return next;
    }, { replace: true });
  }, [setSp]);

  const setShow = (v: Show) => setParam("status", v, "new");
  const setTeam = (v: string) => setParam("team", v, "");
  const setQuery = (v: string) => setParam("q", v, "");
  const setLevelFilter = (v: string) => setParam("level", v, "");
  const setSelId = useCallback((id: string | null) => setParam("alert", id ?? "", ""), [setParam]);
  const clearEventFilter = () => setParam("event", "", "");

  const [mobOpen, setMobOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const hoverTimer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [sum, setSum] = useState<AlertSummary | null>(null);
  const [events, setEvents] = useState<Record<string, EventDetail>>({});
  const [eventRows, setEventRows] = useState<Record<string, EventRow>>({});
  const [err, setErr] = useState<unknown>(null);
  const [asking, setAsking] = useState<"ack" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, xs] = await Promise.all([
        alertsApi.summary(),
        alertsApi.list({
          status: show === "all" ? undefined : show,
          owner: team || undefined,
          event_id: eventFilter || undefined,
        }),
      ]);
      setSum(s); setItems(xs); setErr(null);
    } catch (e) { setErr(e); }
  }, [show, team, eventFilter]);

  useEffect(() => {
    investigationApi.events().then(rows => {
      const map: Record<string, EventRow> = {};
      rows.forEach(r => { map[r.event_id] = r; });
      setEventRows(map);
    }).catch(() => {});
  }, []);

  useEffect(() => setItems(null), [show, team, eventFilter]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const queue = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    return [...items]
      .filter(a => {
        if (show !== "all" && a.status !== show) return false;
        if (levelFilter && a.level !== levelFilter) return false;
        if (eventFilter && a.event_id !== eventFilter) return false;
        if (!q) return true;
        const canon = eventRows[a.event_id] ? eventTitle(eventRows[a.event_id]) : a.event_title;
        return [a.title, a.owner, a.event_title, canon, a.top_finding ?? "", ...a.effects.map(e => `${e.product} ${e.metric_name} ${e.chain_label}`)].join(" ").toLowerCase().includes(q);
      })
      .sort((x, y) => alertOrder({ ...x, at: changed(x) }, { ...y, at: changed(y) }));
  }, [items, show, query, levelFilter, eventFilter, eventRows]);

  const cur = queue?.find(a => a.alert_id === selId) ?? queue?.[0] ?? null;

  const groupedEffects = useMemo(() => {
    if (!cur) return [];
    const map = new Map<string, typeof cur.effects>();
    for (const e of cur.effects) {
      const list = map.get(e.product) ?? [];
      list.push(e);
      map.set(e.product, list);
    }
    return [...map.entries()];
  }, [cur]);

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
  const evName = (a: AlertItem) => {
    const srcEv = events[a.event_id] ?? eventRows[a.event_id];
    return srcEv ? eventTitle(srcEv) : eventTitle({ title: a.event_title });
  };
  const eventFilterLabel = eventFilter
    ? (events[eventFilter] ? eventTitle(events[eventFilter])
      : eventRows[eventFilter] ? eventTitle(eventRows[eventFilter])
      : items?.find(a => a.event_id === eventFilter)?.event_title ?? eventFilter)
    : "";
  const products = cur ? [...new Set(cur.effects.map(e => e.product))] : [];
  const src = cur?.sources?.[0] ? sourceInfo(cur.sources[0]) : null;
  const article = cur ? ev?.findings.flatMap(f => f.evidence?.headlines ?? []).find(h => h.url && (!cur.top_finding || h.title === cur.top_finding)) : undefined;
  const singleLevel = queue ? new Set(queue.map(a => a.level)).size <= 1 : false;
  const activeFilterCount = (show !== "new" ? 1 : 0) + (team ? 1 : 0) + (levelFilter ? 1 : 0) + (query.trim() ? 1 : 0) + (eventFilter ? 1 : 0);
  const statusLabels: Record<Show, string> = { all: "All", new: "To review", acknowledged: "Acknowledged", resolved: "Resolved" };
  const resetFilters = () => {
    setSp(prev => {
      const next = new URLSearchParams(prev);
      ["status", "team", "level", "q", "event"].forEach(k => next.delete(k));
      return next;
    }, { replace: true });
  };

  return (
    <div className="eos-pad" style={{ paddingBottom: 24 }}>
      <div className="eos-hd">
        <div>
          <div className="label">Team Action Queue</div>
          <h1>
            {sum ? (sum.to_review ? <><span style={{ color: "var(--critical-ink)" }}>{count(sum.to_review, "alert")}</span> waiting across {count(sum.teams.length, "team")}</> : "All caught up") : "Alerts"}
          </h1>
          <p className="sub">Reviewed individually — each alert keeps its own note and audit trail.</p>
        </div>
        <button className="btn btn--ghost btn--sm" type="button" onClick={load}><Icon name="refresh" />Refresh</button>
      </div>

      {err != null && <LoadError error={err} onRetry={load} what="the alerts" />}

      {/* Mobile compact filter bar (<=900px): keeps 4 alerts visible above the fold */}
      {!mobOpen && (
        <div className="eos-mob-fbar">
          <div className="eos-mob-fchips">
            <span className="chip" style={{ fontWeight: 600 }}>{statusLabels[show]} ({nAt(show) ?? 0})</span>
            {team && <span className="chip">{team}</span>}
            {levelFilter && <span className="chip">{LEVEL_LABEL[levelFilter as keyof typeof LEVEL_LABEL] ?? levelFilter}</span>}
            {eventFilter && (
              <span className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--accent-soft)", color: "var(--accent-ink)", borderColor: "var(--accent-line)", fontWeight: 600 }}>
                <span>{eventFilterLabel}</span>
                <button type="button" onClick={clearEventFilter} aria-label="Clear event filter" style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: "0 2px", fontSize: 15, lineHeight: 1 }}>×</button>
              </span>
            )}
          </div>
          <button type="button" className="btn eos-mob-fbtn" aria-expanded={filterSheetOpen} aria-controls="alerts-filter-sheet" onClick={() => setFilterSheetOpen(true)}>
            <Icon name="search" />
            <span>Filters</span>
            {activeFilterCount > 0 && <span className="eos-mob-fcnt">{activeFilterCount}</span>}
          </button>
        </div>
      )}

      {/* Desktop inline filter bar */}
      <div className={`eos-filterbar eos-alerts-fbar-desk${mobOpen ? " eos-mob-hide" : ""}`} style={{ marginBottom: 0 }}>
        <SearchInput value={query} onChange={setQuery} ariaLabel="Search alerts" placeholder="Search alerts, products, teams, or events…" count={queue?.length} />
        <SelectMenu label="Filter by severity" value={levelFilter} onChange={setLevelFilter} options={[
          { value: "", label: "All severities" },
          { value: "adverse", label: "Confirmed" },
          { value: "developing", label: "Showing early signs" },
          { value: "warning", label: "Early warning" },
        ]} />
        {sum && sum.all_teams.length > 1 && (
          <SelectMenu label="Filter by team" value={team} onChange={setTeam} options={[
            { value: "", label: `All teams (${sum.all_teams.length})` },
            ...sum.all_teams.map(t => ({ value: t, label: `${t} (${nAt(show, t)})` })),
          ]} />
        )}
        <FlowFilter toned label="Which alerts" value={show} onChange={s => { setShow(s); setMobOpen(false); }} all={{ key: "all", label: "All", count: nAt("all") }}
          steps={([["new", "To review", "queued"], ["acknowledged", "Acknowledged", "held"], ["resolved", "Resolved", "done"]] as const)
            .map(([key, label, state]) => ({ key, label, count: nAt(key), state }))} />
        {eventFilter && (
          <span className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--accent-soft)", color: "var(--accent-ink)", borderColor: "var(--accent-line)", fontWeight: 600 }}>
            <span>Filtered by event: {eventFilterLabel}</span>
            <button type="button" onClick={clearEventFilter} aria-label="Clear event filter"
              style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: "0 2px", fontSize: 15, lineHeight: 1 }}>×</button>
          </span>
        )}
      </div>

      {/* Mobile slide-up Filter Sheet (>=44x44px tap targets) */}
      {filterSheetOpen && (
        <div className="eos-sheet-bg" role="dialog" aria-modal="true" aria-label="Filter alerts" id="alerts-filter-sheet"
          onClick={e => { if (e.target === e.currentTarget) setFilterSheetOpen(false); }}>
          <div className="eos-sheet">
            <div className="eos-sheet-hd">
              <strong>Filter Alerts</strong>
              <div className="row" style={{ gap: 8 }}>
                {activeFilterCount > 0 && (
                  <button type="button" className="btn btn--ghost eos-sheet-act" onClick={resetFilters}>Reset</button>
                )}
                <button type="button" className="btn btn--primary eos-sheet-act" onClick={() => setFilterSheetOpen(false)}>Done</button>
              </div>
            </div>
            <div className="eos-sheet-sec">
              <span className="label">Search</span>
              <SearchInput value={query} onChange={setQuery} ariaLabel="Search alerts" placeholder="Search alerts, products, teams, or events…" count={queue?.length} />
            </div>
            <div className="eos-sheet-sec">
              <span className="label">Status</span>
              <div className="eos-sheet-grid">
                {(["all", "new", "acknowledged", "resolved"] as const).map(k => (
                  <button key={k} type="button" className={`eos-sheet-pill${show === k ? " is-active" : ""}`}
                    aria-pressed={show === k} onClick={() => { setShow(k); setMobOpen(false); }}>
                    <span>{statusLabels[k]}</span>
                    <span className="mono">{nAt(k) ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="eos-sheet-sec">
              <span className="label">Severity &amp; Team</span>
              <div className="eos-sheet-grid">
                <SelectMenu label="Filter by severity" value={levelFilter} onChange={setLevelFilter} options={[
                  { value: "", label: "All severities" },
                  { value: "adverse", label: "Confirmed" },
                  { value: "developing", label: "Showing early signs" },
                  { value: "warning", label: "Early warning" },
                ]} />
                {sum && sum.all_teams.length > 1 && (
                  <SelectMenu label="Filter by team" value={team} onChange={setTeam} options={[
                    { value: "", label: `All teams (${sum.all_teams.length})` },
                    ...sum.all_teams.map(t => ({ value: t, label: `${t} (${nAt(show, t)})` })),
                  ]} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {queue === null ? (err == null && <div className="mt12"><ListSkeleton rows={4} /></div>)
        : queue.length === 0 ? <div className="mt16"><Empty icon="check" title="No alerts in this view" actions={<Link className="btn" to="/events">View open events</Link>}>Adjust filters or check back after the next sweep.</Empty></div>
        : (
          <div className={`eos-split eos-alerts-split${mobOpen ? " is-mob-detail" : ""}`}>
            {/* Left Queue */}
            <div className="eos-list" onMouseLeave={() => window.clearTimeout(hoverTimer.current)}>
              {queue.map(a => (
                <button key={a.alert_id} type="button" className="eos-row" data-selected={cur?.alert_id === a.alert_id}
                  onClick={() => { window.clearTimeout(hoverTimer.current); setSelId(a.alert_id); setMobOpen(true); }}
                  onMouseEnter={() => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setSelId(a.alert_id), 90); }}>
                  <div className="row" style={{ gap: 8 }}>
                    {singleLevel ? (
                      <span className={`eos-lvl-dot tone-${LEVEL_TONE[a.level]}`} aria-label={LEVEL_LABEL[a.level]} title={LEVEL_LABEL[a.level]} />
                    ) : (
                      <span className={`badge ${toneBadge(LEVEL_TONE[a.level])}`}>{LEVEL_LABEL[a.level]}</span>
                    )}
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
                <button type="button" className="btn btn--ghost btn--sm eos-mob-back" onClick={() => setMobOpen(false)}>
                  ← All alerts
                </button>
                <div className="eos-hd">
                  <div>
                    <div className="row wrap" style={{ gap: 6, marginBottom: 4 }}>
                      <span className={`badge ${toneBadge(LEVEL_TONE[cur.level])}`}>{LEVEL_LABEL[cur.level]}</span>
                      <span className="label">{cur.owner} · <Link to={`/events/${cur.event_id}`}>{evName(cur)} ↗</Link></span>
                    </div>
                    <h2 style={{ fontSize: 21, marginTop: 2 }}>{what(cur)}</h2>
                  </div>
                  <div className="row eos-alert-actions" style={{ gap: 8 }}>
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
                    <input className="input" style={{ flex: 1, minWidth: 200 }} autoFocus value={note} onChange={e => setNote(e.target.value)}
                      placeholder={asking === "ack" ? "Optional note for your team…" : "Optional resolution note…"}
                      onKeyDown={e => { if (e.key === "Enter") act(cur, asking); if (e.key === "Escape") { setAsking(null); setNote(""); } }} />
                    <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => act(cur, asking)}>
                      {asking === "ack" ? "Confirm acknowledge" : "Confirm resolve"}
                    </button>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setAsking(null); setNote(""); }}>Cancel</button>
                  </div>
                )}

                {/* ✦ Investigation Agent Assessment Table: AI Estimate vs. Your Data */}
                <div className="eos-ai">
                  <div className="eos-ai-hd">
                    <span className="eos-spark" aria-hidden="true">✦</span>
                    <span>
                      Investigation Agent · {cur.effects.length !== products.length
                        ? `${count(cur.effects.length, "possible impact")} across ${count(products.length, "product")}`
                        : "Expected impact (AI) vs. your bank data"}
                    </span>
                  </div>
                  <div className="eos-ai-bd">
                    <table className="eos-tbl eos-alert-tbl">
                      <thead>
                        <tr><th>Product</th><th>Expected (AI estimate)</th><th>Your data says</th></tr>
                      </thead>
                      <tbody>
                        {groupedEffects.map(([product, list]) => {
                          const chains = [...new Set(list.map(e => e.chain_label).filter(Boolean))];
                          const moves = [...new Map(list.map(e => {
                            const txt = capFirst(impactText(e.metric_name, e.direction));
                            const st = sizeTiming(e.size, e.timing);
                            return [`${txt}|${st}`, { id: e.hypothesis_id, txt, st }];
                          })).values()];
                          const checks = [...new Map(list.map(e => {
                            const m = e.check ? checkMove(e.check.what) : null;
                            const key = m ? `${m.move}|${m.against}` : (cur.basis === "data" ? "__wait" : "__exp");
                            return [key, { id: e.hypothesis_id, m }];
                          })).values()];
                          return (
                            <tr key={product}>
                              <td>
                                <strong style={{ color: "var(--ink)" }}>{product}</strong>
                                {list.length > 1 && <span className="small muted"> · {list.length} angles</span>}
                                <div className="col" style={{ gap: 3, marginTop: 2 }}>
                                  {chains.map((ch, idx) => (
                                    <div key={idx} className="small muted">{chains.length > 1 ? `• ${ch}` : ch}</div>
                                  ))}
                                </div>
                              </td>
                              <td>
                                <div className="col" style={{ gap: 6 }}>
                                  {moves.map(mv => (
                                    <div key={mv.id}>
                                      <div style={{ color: "var(--ink)", fontWeight: 500 }}>{mv.txt}</div>
                                      <div className="small muted">{mv.st}</div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td>
                                <div className="col" style={{ gap: 6 }}>
                                  {checks.map(ck => (
                                    <div key={ck.id}>
                                      {ck.m ? (
                                        <><strong style={{ color: "var(--ink)" }}>{ck.m.move}</strong> <span className="small muted">{ck.m.against}</span></>
                                      ) : (
                                        <span className="badge b-noeffect">{cur.basis === "data" ? "Waiting for data" : "Expectations only"}</span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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

                <Fold summary={`Audit trail (${runs(cur).length} entries)`} defaultOpen={false} bodyClassName="eos-fold-bd col">
                  <div className="col" style={{ gap: 4 }}>
                    {runs(cur).map((r, i) => (
                      <div key={i}><b>{CHANGE[r.change] ?? r.change}{r.n > 1 ? ` (${r.n}×)` : ""}</b> · <span className="mono">{dayTime(r.at)}</span>{r.by ? ` · ${person(r.by)}` : ""}</div>
                    ))}
                  </div>
                </Fold>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
