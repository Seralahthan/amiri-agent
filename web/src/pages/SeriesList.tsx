// Market Series — Master-Detail Symbol Search, Asset Type Filter & Editorial Anomaly Dossier Inspector.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { seriesApi, type Bar, type Series, type SeriesStatus, type SimulateResult } from "../api/series";
import { Icon } from "../components/Icon";
import { SearchInput } from "../components/SearchInput";
import { SelectMenu } from "../components/SelectMenu";
import { SurveillanceTabs } from "../components/WorkspaceTabs";
import { HowItWorks, StatusPill } from "../components/blocks";
import { AddSeriesModal, FetchBadge, RefreshButton, seriesSentence, StateBadge, themeMeaning } from "../components/series";
import { Banner, Empty, useNow, useRole, ListSkeleton, LoadError, useToast } from "../components/ui";
import { ago, due, pctFine, price, when, zx, ZONE_LABEL } from "../format";
import { count, ruleText } from "../plain";

const POLL_MS = 60_000;
const concern = (s: Series) => (s.state === "moved" ? 0 : s.state === "stale" ? 1 : 2);
const CHART_RANGES = [
  { id: "1w", label: "1 week", days: 7, interval: "1h" as const },
  { id: "1m", label: "1 month", days: 31, interval: "1h" as const },
  { id: "3m", label: "3 months", days: 92, interval: "1d" as const },
];
const SHOCK_PRESETS = [-5, -3, 3, 5];

/** Compact shaded usual-range trajectory chart with breakout dot. */
function SeriesBandChart({ s, bars, unusual }: { s: Series; bars: Bar[] | null; unusual: boolean }) {
  const vals = useMemo(() => {
    const src = bars && bars.length > 1 ? bars.map(b => b.close) : s.spark.map(p => p.close);
    return src.filter(v => Number.isFinite(v));
  }, [bars, s.spark]);

  if (vals.length < 2) {
    return <div className="small muted" style={{ padding: "24px 0", textAlign: "center" }}>Not enough price history yet.</div>;
  }

  const w = 420;
  const h = 96;
  const padY = 10;
  const sorted = [...vals].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.2)];
  const q3 = sorted[Math.floor(sorted.length * 0.8)];
  const med = sorted[Math.floor(sorted.length * 0.5)];
  const typPct = s.latest?.typical_daily_move_pct;
  const halfBand = typPct && typPct > 0 ? Math.max((q3 - q1) / 2, med * (typPct / 100) * 1.4) : Math.max((q3 - q1) / 2, med * 0.002);
  const bandLo = med - halfBand;
  const bandHi = med + halfBand;

  const minV = Math.min(...vals, bandLo);
  const maxV = Math.max(...vals, bandHi);
  const span = maxV - minV || 1;
  const xAt = (i: number) => (i / (vals.length - 1)) * w;
  const yAt = (v: number) => padY + (1 - (v - minV) / span) * (h - padY * 2);

  const d = vals.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const yHi = yAt(bandHi);
  const yLo = yAt(bandLo);
  const lastX = xAt(vals.length - 1);
  const lastY = yAt(vals[vals.length - 1]);

  return (
    <svg className="eos-ms-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${s.name} price trajectory`}>
      <rect x="0" y={yHi} width={w} height={Math.max(4, yLo - yHi)} fill="var(--sunken)" rx="2" />
      <line x1="0" y1={yHi} x2={w} y2={yHi} stroke="var(--hairline-2)" strokeDasharray="3 3" strokeWidth="1" />
      <line x1="0" y1={yLo} x2={w} y2={yLo} stroke="var(--hairline-2)" strokeDasharray="3 3" strokeWidth="1" />
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {unusual && (
        <circle cx={lastX} cy={lastY} r="4.5" fill="var(--high)" stroke="var(--pane)" strokeWidth="2" />
      )}
    </svg>
  );
}

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
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [scrollGroup, setScrollGroup] = useState<string | null>(null);
  const hoverTimer = useRef<number>(0);
  const scrollTimer = useRef<number>(0);
  useEffect(() => () => { window.clearTimeout(hoverTimer.current); window.clearTimeout(scrollTimer.current); }, []);
  const [simPct, setSimPct] = useState(-5);
  const [simBusy, setSimBusy] = useState(false);
  const [simOut, setSimOut] = useState<SimulateResult | null>(null);
  const [rangeId, setRangeId] = useState<string>("1m");
  const [bars, setBars] = useState<Bar[] | null>(null);
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

  useEffect(() => {
    setSimOut(null);
    if (!cur) { setBars(null); return; }
    const range = CHART_RANGES.find(r => r.id === rangeId) ?? CHART_RANGES[1];
    const lastMs = cur.latest?.bar_ts ? new Date(cur.latest.bar_ts).getTime() : 0;
    const anchored = !!lastMs && Date.now() - lastMs > (range.days * 86400_000) / 2;
    const until = new Date((anchored ? lastMs : Date.now()) + 3600_000);
    const from = new Date(until.getTime() - range.days * 86400_000);
    let alive = true;
    seriesApi.bars(cur.series_id, from, until, range.interval)
      .then(b => { if (alive) setBars(b); })
      .catch(() => { if (alive) setBars(null); });
    return () => { alive = false; };
  }, [cur?.series_id, cur?.latest?.bar_ts, rangeId]);

  const runSim = async () => {
    if (!cur || !Number.isFinite(simPct) || simPct === 0) return;
    setSimBusy(true);
    try { const r = await seriesApi.simulate(cur.series_id, simPct); setSimOut(r); toast(r.note); }
    catch (e) { toast(String(e)); }
    finally { setSimBusy(false); }
  };

  return (
    <div className="eos-pad" style={{ paddingBottom: 24 }}>
      <SurveillanceTabs right={isAdmin ? (
        <button className="btn btn--primary btn--sm" type="button" onClick={() => setAdding(true)} disabled={!status || left <= 0}>
          <Icon name="plus" />Watch symbol
        </button>
      ) : undefined} />
      <div className="eos-hd">
        <div>
          <div className="label">Market Surveillance · Twelve Data</div>
          <h1>
            {items === null ? "Market Series" : <><span className="eos-h-ok">{count(items.length, "price")}</span> watched{items.some(x => x.state === "moved") ? <> · <span className="eos-h-warn">{items.filter(x => x.state === "moved").length} unusual</span></> : ""}</>}
          </h1>
        </div>
      </div>

      <PrototypeBanner status={status} />
      {error != null && <LoadError error={error} onRetry={load} what="the market series" />}

      {items && items.length > 0 && (
        <div className="eos-filterbar" style={{ marginBottom: 0 }}>
          <SearchInput value={query} onChange={setQuery} ariaLabel="Search market series" placeholder="Search symbol (USD/AED, Gold…)" count={filtered.length} />
          {types.length > 0 && (
            <SelectMenu label="Filter by asset type" value={typeFilter} onChange={setTypeFilter} options={[
              { value: "", label: "All asset types" },
              ...types.map(t => ({ value: t, label: t })),
            ]} />
          )}
          <SelectMenu label="Filter by state" value={stateFilter} onChange={setStateFilter} options={[
            { value: "", label: "All states" },
            { value: "moved", label: "Unusual move" },
            { value: "normal", label: "Normal" },
            { value: "stale", label: "Late / stale" },
            { value: "paused", label: "Paused" },
          ]} />
        </div>
      )}

      {items === null && error == null && <div className="mt12"><ListSkeleton rows={3} /></div>}
      {items && items.length === 0 && (
        <div className="mt16"><Empty icon="series" title="No series watched yet">A Platform Admin adds the FX rates and commodities AMIRI Agent watches.</Empty></div>
      )}
      {items && items.length > 0 && filtered.length === 0 && (
        <div className="mt16"><Empty icon="series" title="No matching symbols">Try clearing your search or type filter.</Empty></div>
      )}

      {cur && (() => {
        const SERIES_GROUPS = [
          { key: "moved", label: "Unusual moves", dot: "paused", rows: filtered.filter(s => s.state === "moved") },
          { key: "normal", label: "Watching · Normal", dot: "live", rows: filtered.filter(s => s.state === "normal") },
          { key: "stale", label: "Late / Stale", dot: "submitted", rows: filtered.filter(s => s.state === "stale") },
          { key: "paused", label: "Paused", dot: "draft", rows: filtered.filter(s => s.state === "paused") },
        ].filter(g => g.rows.length > 0);
        const focusedGroup = hoveredGroup ?? scrollGroup;
        const staging = SERIES_GROUPS.length > 1 && focusedGroup !== null;
        const onSeriesScroll = (e: React.UIEvent<HTMLDivElement>) => {
          const el = e.currentTarget;
          const top = el.getBoundingClientRect().top + 36;
          let active: string | null = SERIES_GROUPS[0]?.key ?? null;
          el.querySelectorAll<HTMLElement>("[data-grp]").forEach(sec => {
            if (sec.getBoundingClientRect().top <= top) active = sec.dataset.grp ?? active;
          });
          if (el.scrollTop > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 6) {
            active = SERIES_GROUPS[SERIES_GROUPS.length - 1]?.key ?? active;
          }
          setScrollGroup(active);
          window.clearTimeout(scrollTimer.current);
          scrollTimer.current = window.setTimeout(() => setScrollGroup(null), 650);
        };
        return (
        <div className="eos-split">
          <div className="eos-list" data-staging={staging ? "true" : "false"}
            onMouseLeave={() => { window.clearTimeout(hoverTimer.current); setHoveredGroup(null); }}
            onScroll={onSeriesScroll}>
            {SERIES_GROUPS.map(g => (
              <section key={g.key} className="eos-grp" data-grp={g.key}
                data-focused={!staging || focusedGroup === g.key ? "true" : "false"}
                onMouseEnter={() => setHoveredGroup(g.key)}>
                <div className="eos-grp-hd">
                  <span className={`eos-grp-dot ${g.dot}`} aria-hidden="true" />
                  <span>{g.label}</span>
                  <span className="eos-grp-cnt">{g.rows.length}</span>
                </div>
                {g.rows.map(s => {
                  const l = s.latest;
                  const z = l?.max_z != null ? Math.abs(l.max_z) : null;
                  const thr = s.detector.z_threshold;
                  const unusual = s.state === "moved" || (z !== null && z >= thr);
                  const miniMax = Math.max(thr * 1.4, z ?? 0, 1);
                  const miniFill = z !== null ? Math.min(100, (z / miniMax) * 100) : 0;
                  const miniTick = Math.min(90, (thr / miniMax) * 100);
                  return (
                    <button key={s.series_id} type="button" className="eos-row" data-selected={cur.series_id === s.series_id}
                      onClick={() => { window.clearTimeout(hoverTimer.current); setSelId(s.series_id); }}
                      onMouseEnter={() => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setSelId(s.series_id), 90); }}>
                      <div className="row" style={{ gap: 8 }}>
                        <strong style={{ color: "var(--ink)" }}>{s.name}</strong>
                        {z !== null ? (
                          <StatusPill tone={unusual ? (z >= thr ? "red" : "amber") : "green"}>
                            {s.state === "moved" && z < thr ? `${zx(z)} usual · cooldown` : `${zx(z)} usual`}
                          </StatusPill>
                        ) : <StateBadge state={s.state} />}
                        <span className="mono" style={{ marginLeft: "auto", fontWeight: 700, color: "var(--ink)" }}>{price(l?.close)}</span>
                      </div>
                      {z !== null && (
                        <div className="eos-ms-mini" title={`${zx(z)} a normal move (threshold ${thr}×)`}>
                          <div className="eos-ms-ltrack eos-ms-ltrack--mini">
                            <div className={`eos-ms-lfill${z >= thr ? " hot" : ""}`} style={{ width: `${miniFill}%` }} />
                            <span className="eos-ms-ltick" style={{ left: `${miniTick}%` }} aria-hidden="true" />
                          </div>
                          <span className="eos-ms-mini-lbl">vs. {thr}× usual</span>
                        </div>
                      )}
                      <div className="row small muted" style={{ justifyContent: "space-between" }}>
                        <span>{s.instrument?.type ?? s.symbol} · {ago(s.fetch.last_at, now)}</span>
                        <span className="mono">{pctFine(l?.change_1d_pct)}</span>
                      </div>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>

          <div className="eos-insp">
            {(() => {
              const l = cur.latest;
              const maxZ = l?.max_z != null ? Math.abs(l.max_z) : null;
              const unusual = cur.state === "moved" || (maxZ !== null && maxZ >= cur.detector.z_threshold);
              const range = CHART_RANGES.find(r => r.id === rangeId) ?? CHART_RANGES[1];
              const windows = l?.windows ?? [];
              const peakW = Math.max(...windows.map(w => Math.abs(w.z ?? 0)), 0);
              const scaleMax = Math.max(cur.detector.z_threshold * 1.4, peakW * 1.12, 1);
              const tickPct = Math.min(92, (cur.detector.z_threshold / scaleMax) * 100);
              const meaning = cur.theme ? themeMeaning(cur.theme).replace(/\.$/, "") : null;
              return (
                <>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {unusual ? (
                        <span className="eos-ms-pill hot">
                          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><polygon points="5,0.8 9.2,5 5,9.2 0.8,5" fill="currentColor" /></svg>
                          Unusual
                        </span>
                      ) : <StateBadge state={cur.state} />}
                      <span className="small muted">
                        {cur.last_finding
                          ? `${cur.state === "moved" && maxZ !== null && maxZ < cur.detector.z_threshold ? "in cooldown · " : ""}flagged ${when(cur.last_finding.at, now)}`
                          : `updated ${ago(cur.fetch.last_at, now)}`}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <RefreshButton s={cur} onDone={replace} />
                      <Link className="btn btn--sm btn--ghost" to={`/series/${cur.series_id}`}>Full series →</Link>
                    </div>
                  </div>

                  <div>
                    <h2 style={{ fontSize: 22, margin: 0, letterSpacing: "-0.02em" }}>{cur.name}</h2>
                    <div className="small muted" style={{ marginTop: 3 }}>
                      {cur.symbol}
                      {meaning ? ` · ${meaning}` : ""}
                      {cur.places.length > 0 ? ` · ${cur.places.join(", ")}` : ""}
                    </div>
                  </div>

                  <div className="eos-ms-hero">
                    <span className="eos-ms-price">{price(l?.close)}</span>
                    {l?.change_1d_pct != null && (
                      <span className={`eos-ms-chg${unusual ? " hot" : ""}`}>{pctFine(l.change_1d_pct)}</span>
                    )}
                    <span className="small muted">
                      today{l?.typical_daily_move_pct ? ` · usual day ±${pctFine(l.typical_daily_move_pct).replace(/^\+/, "")}` : ""}
                    </span>
                  </div>

                  <div className="eos-ms-chart">
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                      <div className="eos-ms-seg" role="group" aria-label="Chart period">
                        {CHART_RANGES.map(r => (
                          <button key={r.id} type="button" className={r.id === range.id ? "active" : ""} onClick={() => setRangeId(r.id)}>
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <span className="small muted">{range.interval === "1h" ? "Hourly" : "Daily"} closes</span>
                    </div>
                    <SeriesBandChart s={cur} bars={bars} unusual={unusual} />
                    <div className="eos-ms-cfoot">
                      <span>
                        Shaded: usual range{l?.typical_daily_move_pct ? ` (±${pctFine(l.typical_daily_move_pct).replace(/^\+/, "")}/day)` : ""}
                      </span>
                      {cur.last_finding && (
                        <Link to={`/series/${cur.series_id}#findings`}>finding → {cur.last_finding.title}</Link>
                      )}
                    </div>
                  </div>

                  {windows.length > 0 && (
                    <div className="eos-ms-ladder">
                      <div className="eos-ms-lk">
                        <span>How unusual</span>
                        <span>Threshold · {cur.detector.z_threshold}×</span>
                      </div>
                      <div className="col" style={{ gap: 10 }}>
                        {windows.map(w => {
                          const z = w.z != null ? Math.abs(w.z) : null;
                          const hot = z !== null && z >= cur.detector.z_threshold;
                          const fillPct = z !== null ? Math.min(100, (z / scaleMax) * 100) : 0;
                          return (
                            <div key={w.days} className="eos-ms-lrow">
                              <span className="eos-ms-ld">{w.days === 1 ? "1 day" : `${w.days} days`}</span>
                              <span className="eos-ms-lc">{pctFine(w.change_pct)}</span>
                              <div className="eos-ms-ltrack" title={z !== null ? `${zx(z)} normal (threshold ${cur.detector.z_threshold}×)` : "Not enough history"}>
                                <div className={`eos-ms-lfill${hot ? " hot" : ""}`} style={{ width: `${fillPct}%` }} />
                                <div className="eos-ms-ltick" style={{ left: `${tickPct}%` }} />
                              </div>
                              <span className={`eos-ms-lz${hot ? " hot" : ""}`}>{z !== null ? zx(z) : "—"}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="eos-ai">
                    <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>Anomaly Detector · Threshold {cur.detector.z_threshold}× normal</div>
                    <div className="eos-ai-bd">{seriesSentence(cur, now).replace(/\.+$/, "")}.{meaning ? ` ${meaning}.` : ""}</div>
                    <div className="eos-ai-meta">
                      <span><FetchBadge s={cur} /></span>
                      <span>Updated {ago(cur.fetch.last_at, now)}</span>
                    </div>
                  </div>

                  <details className="eos-fold">
                    <summary>Try a move <span className="small muted" style={{ fontWeight: 500 }}>· Sandbox test (live prices untouched)</span></summary>
                    <div className="eos-fold-bd col" style={{ gap: 10 }}>
                      <div className="row wrap" style={{ gap: 8 }}>
                        {SHOCK_PRESETS.map(p => (
                          <button key={p} type="button" className={`eos-ms-chip${simPct === p ? " sel" : ""}`} onClick={() => setSimPct(p)}>
                            {p > 0 ? `+${p}%` : `${p}%`}
                          </button>
                        ))}
                        <label className="eos-ms-pct">
                          <span className="sr">Simulated percent move</span>
                          <input type="number" step="0.5" value={simPct} onChange={e => setSimPct(Number(e.target.value))}
                            onKeyDown={e => { if (e.key === "Enter") runSim(); }} />
                          <span>%</span>
                        </label>
                        <button type="button" className="btn btn--primary btn--sm" style={{ marginLeft: "auto" }} disabled={simBusy || !simPct} onClick={runSim}>
                          {simBusy ? "Testing…" : "Test"}
                        </button>
                      </div>
                      {simOut && <div className="small" style={{ color: simOut.fired ? "var(--high-ink)" : "var(--ink-2)" }}>{simOut.note}</div>}
                    </div>
                  </details>
                </>
              );
            })()}
          </div>
        </div>
        );
      })()}

      {adding && <AddSeriesModal left={left} onClose={() => setAdding(false)}
        onAdded={s => { setAdding(false); setItems(xs => [...(xs ?? []), s]); reloadStatus(); }} />}
    </div>
  );
}
