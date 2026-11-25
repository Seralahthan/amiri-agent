// Market Series — Master-Detail Symbol Search, Asset Type Filter & Z-Score Inspector (V2.2).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { seriesApi, type Series, type SeriesStatus } from "../api/series";
import { Spark } from "../components/charts";
import { Icon } from "../components/Icon";
import { HowItWorks, StatusPill } from "../components/blocks";
import { AddSeriesModal, FetchBadge, RefreshButton, seriesSentence, StateBadge, themeMeaning } from "../components/series";
import { Banner, Empty, useNow, useRole, ListSkeleton, LoadError, useToast } from "../components/ui";
import { ago, due, pctFine, price, when, zx, ZONE_LABEL } from "../format";
import { count, ruleText } from "../plain";

const POLL_MS = 60_000;
const concern = (s: Series) => (s.state === "moved" ? 0 : s.state === "stale" ? 1 : 2);

export function useSeriesStatus() {
  const [status, setStatus] = useState<SeriesStatus | null>(null);
  const load = useCallback(() => seriesApi.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

export function PrototypeBanner({ status }: { status: SeriesStatus | null }) {
  const { role } = useRole();
  if (!status || status.provider.configured) return null;
  return role === "platform_admin"
    ? <Banner kind="crit" icon="warn"><b>Twelve Data isn't configured.</b> Set <span className="mono">TWELVEDATA_API_KEY</span> in the server's environment.</Banner>
    : <Banner kind="warn" icon="warn">Prices can't be updated right now. Your Platform Admin has been told.</Banner>;
}

export function PricesHelp({ status }: { status: SeriesStatus | null }) {
  const now = useNow(60_000);
  const { role } = useRole();
  const c = status?.provider.credits;
  return (
    <HowItWorks>
      <p>AMIRI Agent watches these prices automatically. It {ruleText(status?.detector_defaults.z_threshold ?? 3)}; each flagged move becomes a finding for the investigation.</p>
      {status && <p>Next pull due {due(status.schedule.next_run_at, now)} ({ZONE_LABEL}). {status.limits.used} of {status.limits.max_series} series watched.</p>}
      {role === "platform_admin" && c && <p>Twelve Data credits today: {c.used_today} of {c.per_day}.</p>}
    </HowItWorks>
  );
}

export function SeriesList() {
  const now = useNow(30_000);
  const toast = useToast();
  const { role } = useRole();
  const [items, setItems] = useState<Series[] | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [simPct, setSimPct] = useState(5);
  const [simBusy, setSimBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const { status, reload: reloadStatus } = useSeriesStatus();

  const load = useCallback(async () => {
    try { setItems(await seriesApi.list()); setError(null); }
    catch (e) { setError(e); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { load(); reloadStatus(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, reloadStatus]);

  const replace = (s: Series) => { setItems(xs => xs?.map(x => (x.series_id === s.series_id ? s : x)) ?? null); reloadStatus(); };
  const isAdmin = role === "platform_admin";
  const left = status ? status.limits.available : 0;

  const types = useMemo(() => [...new Set((items ?? []).map(s => s.instrument?.type).filter(Boolean) as string[])], [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(items ?? [])].sort((a, b) => concern(a) - concern(b)).filter(s => {
      if (typeFilter && (s.instrument?.type ?? "") !== typeFilter) return false;
      if (stateFilter && s.state !== stateFilter) return false;
      if (!q) return true;
      return `${s.symbol} ${s.name} ${s.instrument?.type ?? ""} ${s.places.join(" ")}`.toLowerCase().includes(q);
    });
  }, [items, query, typeFilter, stateFilter]);

  const cur = filtered.find(s => s.series_id === selId) ?? filtered[0] ?? null;

  const runSim = async () => {
    if (!cur) return;
    setSimBusy(true);
    try { const r = await seriesApi.simulate(cur.series_id, simPct); toast(r.note); }
    catch (e) { toast(String(e)); }
    finally { setSimBusy(false); }
  };

  return (
    <div className="eos-pad" style={{ paddingBottom: 0 }}>
      <div className="eos-hd">
        <div>
          <div className="label">Market Surveillance · Twelve Data</div>
          <h1>
            {items === null ? "Market Series" : <>{count(items.length, "price")} watched{items.some(x => x.state === "moved") ? <> · <span style={{ color: "var(--high-ink)" }}>{items.filter(x => x.state === "moved").length} unusual</span></> : ""}</>}
          </h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {isAdmin && (
            <button className="btn btn--primary btn--sm" type="button" onClick={() => setAdding(true)} disabled={!status || left <= 0}>
              <Icon name="plus" />Watch symbol
            </button>
          )}
        </div>
      </div>

      <PrototypeBanner status={status} />
      {error != null && <LoadError error={error} onRetry={load} what="the market series" />}

      {items && items.length > 0 && (
        <div className="eos-filterbar" style={{ marginBottom: 0 }}>
          <div className="eos-search">
            <Icon name="search" />
            <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Search market series" placeholder="Search symbol or instrument (USD/AED, Gold, LKR…)" />
          </div>
          {types.length > 0 && (
            <select className="eos-select" aria-label="Filter by asset type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All asset types</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select className="eos-select" aria-label="Filter by state" value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
            <option value="">All states</option>
            <option value="moved">Unusual move</option>
            <option value="normal">Normal</option>
            <option value="stale">Late / stale</option>
            <option value="paused">Paused</option>
          </select>
        </div>
      )}

      {items === null && error == null && <div className="mt12"><ListSkeleton rows={3} /></div>}
      {items && items.length === 0 && (
        <div className="mt16"><Empty icon="series" title="No series watched yet">A Platform Admin adds the FX rates and commodities AMIRI Agent watches.</Empty></div>
      )}
      {items && items.length > 0 && filtered.length === 0 && (
        <div className="mt16"><Empty icon="series" title="No matching symbols">Try clearing your search or type filter.</Empty></div>
      )}

      {cur && (
        <div className="eos-split">
          <div className="eos-list">
            {filtered.map(s => {
              const l = s.latest;
              const z = l?.max_z != null ? Math.abs(l.max_z) : null;
              const unusual = s.state === "moved" || (z !== null && z >= s.detector.z_threshold);
              return (
                <button key={s.series_id} type="button" className="eos-row" data-selected={cur.series_id === s.series_id} onClick={() => setSelId(s.series_id)}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ color: "var(--ink)" }}>{s.name}</strong>
                    {z !== null ? <StatusPill tone={unusual ? "red" : "green"}>{zx(z)} σ</StatusPill> : <StateBadge state={s.state} />}
                    <span className="mono" style={{ marginLeft: "auto", fontWeight: 700, color: "var(--ink)" }}>{price(l?.close)}</span>
                  </div>
                  <div className="row small muted" style={{ justifyContent: "space-between" }}>
                    <span>{s.instrument?.type ?? s.symbol} · {ago(s.fetch.last_at, now)}</span>
                    <span className="mono">{pctFine(l?.change_1d_pct)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="eos-insp">
            <div className="eos-hd">
              <div>
                <div className="label">{cur.instrument?.type ?? "Market series"} · {cur.symbol} · updated {ago(cur.fetch.last_at, now)}</div>
                <h2 style={{ fontSize: 23, marginTop: 2 }}>
                  {cur.name} <span className="mono" style={{ fontWeight: 500, color: "var(--ink-2)", marginLeft: 8 }}>{price(cur.latest?.close)}</span>
                </h2>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <RefreshButton s={cur} onDone={replace} />
                <Link className="btn btn--sm btn--ghost" to={`/series/${cur.series_id}`}>Full chart &amp; logs →</Link>
              </div>
            </div>

            <div className="eos-ai">
              <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>Anomaly Detector · Threshold {cur.detector.z_threshold}× normal</div>
              <div className="eos-ai-bd">{seriesSentence(cur, now)}. {themeMeaning(cur.theme)}</div>
              <div className="eos-ai-meta">
                <span>Normal day: <b className="mono">{cur.latest?.typical_daily_move_pct ? `±${pctFine(cur.latest.typical_daily_move_pct).replace(/^\+/, "")}` : "—"}</b></span>
                {cur.last_finding && <span>Last flagged: <b>{when(cur.last_finding.at, now)}</b></span>}
                <span><FetchBadge s={cur} /></span>
              </div>
            </div>

            <div className="eos-focal">
              <div className="row small muted" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <strong style={{ color: "var(--ink)" }}>Recent trajectory</strong>
                <span className="mono">1d change: {pctFine(cur.latest?.change_1d_pct)}</span>
              </div>
              <Spark values={cur.spark.map(p => p.close)} color={cur.state === "moved" ? "var(--high)" : "var(--accent)"} w={420} h={72} />
            </div>

            {cur.latest && cur.latest.windows.length > 0 && (
              <table className="eos-tbl">
                <thead><tr><th>Window</th><th className="r">Change</th><th className="r">vs. Normal</th></tr></thead>
                <tbody>
                  {cur.latest.windows.map(w => (
                    <tr key={w.days}>
                      <td><strong>{w.days}d</strong></td>
                      <td className="r mono">{pctFine(w.change_pct)}</td>
                      <td className="r mono"><b>{w.z != null ? zx(Math.abs(w.z)) : "—"}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <details className="eos-fold">
              <summary>Try a move (Sandbox simulator — live data untouched)</summary>
              <div className="eos-fold-bd row wrap" style={{ gap: 12 }}>
                <span>Simulated shock: <b className="mono">{simPct > 0 ? `+${simPct}%` : `${simPct}%`}</b></span>
                <input type="range" min={-10} max={10} step={0.5} value={simPct} onChange={e => setSimPct(Number(e.target.value))} />
                <button type="button" className="btn btn--primary btn--sm" disabled={simBusy} onClick={runSim}>{simBusy ? "Testing…" : "Run test"}</button>
              </div>
            </details>
          </div>
        </div>
      )}

      {adding && <AddSeriesModal left={left} onClose={() => setAdding(false)}
        onAdded={s => { setAdding(false); setItems(xs => [...(xs ?? []), s]); reloadStatus(); }} />}
    </div>
  );
}
