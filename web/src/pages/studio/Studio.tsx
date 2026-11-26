// The Scenario Studio: Master-Detail War-Game Studio (Variation 1) with priority groups, hover preview, Staging the Focus, and 21-day shock timeline.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { studioApi, type Custom, type HeadlineIn, type Mode, type PriceMove, type Scenario, type ScenarioRow, type Simulation, type Template } from "../../api/studio";
import { FillFromJson } from "../../components/FillFromJson";
import { scenariosOf } from "../../components/fillJson";
import { FlowFilter } from "../../components/FlowFilter";
import { Icon } from "../../components/Icon";
import { SearchInput } from "../../components/SearchInput";
import { SelectMenu } from "../../components/SelectMenu";
import { TonePill } from "../../components/blocks";
import { Banner, Empty, InlineSkeleton, LoadError, Modal, PageHead, PageSkeleton, useToast } from "../../components/ui";
import { dayTime, plural } from "../../format";

const TAG: Record<string, string> = { fx: "currency" };  // a template's tags in words

const MODES: [Mode, string, string][] = [
  ["replay", "Replay (instant, no agents)", "No agent is called: the answers saved from an earlier run come back, so it plays in seconds and the same every time."],
  ["live", "Run with the live agents", "The agents read the scenario as it happens. Takes a few minutes."],
  ["record", "Run live and save for replay", "As the live run, and keeps every agent answer so the run can be replayed exactly."],
];
const DAYS = 21;

export function useStart() {
  const nav = useNavigate();
  const toast = useToast();
  return async (scenario_id: string, mode: Mode) => {
    try { const s = await studioApi.start(scenario_id, mode); nav(`/studio/run/${s.sim_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
}

function CurrentBanner({ sim }: { sim: Simulation | null }) {
  if (!sim) return null;
  return <Banner kind="info" icon="studio" action={<Link className="btn btn--sm" to={`/studio/run/${sim.sim_id}`}>Open it</Link>}>
    <b>{sim.title}</b> is running for {sim.institution.name}: day {sim.step} of {sim.steps}. One simulation runs at a time.
  </Banner>;
}

/** Coming back to a scenario: its latest run, one click away (the full list stays in Runs, lower down). */
function LastRunBanner({ m }: { m: Scenario["simulations"][number] }) {
  const how = m.mode === "replay" ? "replay" : m.mode === "record" ? "live, saved" : "live";
  const where = m.status === "completed" || m.status === "finished" ? "finished" : m.status === "stopped" ? `stopped on day ${m.step} of ${m.steps}` : `${m.status.replace(/_/g, " ")}, day ${m.step} of ${m.steps}`;
  return <Banner kind="info" icon="studio" action={<Link className="btn btn--sm btn--primary" to={`/studio/run/${m.sim_id}`}>Open the run</Link>}>
    Your last run ({how} · {dayTime(m.created_at)}) {where}. Its findings, events and alerts are still there.
  </Banner>;
}

/** A name for a scenario you write yourself. */
function NewOwnModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [custom, setCustom] = useState<Custom>({ headlines: [], prices: { direction: "none", size_pct: 0, ramp_days: 5 } });
  const [busy, setBusy] = useState(false);
  // a file's scenario fills the form: its name, its headlines and its price move (checked by the server when it is created)
  const fillFrom = (x: Record<string, any>) => {
    const c = (x.custom && typeof x.custom === "object" ? x.custom : x) as Record<string, any>;
    const heads: HeadlineIn[] = (Array.isArray(c.headlines) ? c.headlines : []).filter((h: any) => h && typeof h.title === "string")
      .map((h: any, i: number) => ({ id: typeof h.id === "string" && h.id ? h.id : `h${i + 1}`, title: h.title, day: Number(h.day) || 1, time: typeof h.time === "string" ? h.time : "09:00" }));
    const p = c.prices && typeof c.prices === "object" ? c.prices : {};
    setTitle(typeof x.title === "string" ? x.title.slice(0, 120) : title);
    setCustom({ headlines: heads, prices: { direction: ["weaker", "stronger"].includes(p.direction) ? p.direction : "none",
      size_pct: Number(p.size_pct) || 0, ramp_days: Number(p.ramp_days) || 5 } });
  };
  const go = async () => {
    setBusy(true);
    try {
      const s = await studioApi.create("blank", { title: title.trim(), custom });
      nav(`/studio/${s.scenario_id}?new=1`);
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); setBusy(false); }
  };
  const n = custom.headlines?.length ?? 0, p = custom.prices;
  return (
    <Modal title="Write your own scenario" onClose={onClose} footer={<>
      <button className="btn" type="button" onClick={onClose}>Cancel</button>
      <button className="btn btn--primary" type="button" disabled={busy || !title.trim()} onClick={go}>Create</button></>}>
      <p style={{ margin: 0 }}>Name it, then write the headlines that arrive day by day and, if you like, how the exchange rate moves. AMIRI Agent's monitor reads your headlines and the investigation traces them to your products.</p>
      <FillFromJson what="a scenario" read={scenariosOf} onFill={c => fillFrom(c.data)}
        example={'{"title": "…", "headlines": [{"title": "…", "day": 1, "time": "09:00"}], "prices": {"direction": "weaker", "size_pct": 5, "ramp_days": 4}}'} />
      <label className="field"><span>Name</span>
        <input className="input" value={title} maxLength={120} placeholder="e.g. Gulf visa freeze" onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && title.trim()) go(); }} /></label>
      {(n > 0 || (p && p.direction !== "none")) && <p className="small muted" style={{ margin: 0 }}>
        {n > 0 ? plural(n, "headline") : "No headlines"}{p && p.direction !== "none" ? `, and the rate moves ${p.size_pct}% ${p.direction} over ${p.ramp_days} days` : ""}: you can change them on the next page.</p>}
    </Modal>
  );
}

type StudioKey = { kind: "scenario"; id: string } | { kind: "template"; id: string };
type StudioShow = "all" | "recorded" | "templates" | "saved";

export function StudioPage() {
  const nav = useNavigate();
  const toast = useToast();
  const start = useStart();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [items, setItems] = useState<ScenarioRow[] | null>(null);
  const [details, setDetails] = useState<Record<string, Scenario>>({});
  const [current, setCurrent] = useState<Simulation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [own, setOwn] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [show, setShow] = useState<StudioShow>("all");
  const [sel, setSel] = useState<StudioKey | null>(null);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [scrollGroup, setScrollGroup] = useState<string | null>(null);
  const hoverTimer = useRef<number>(0);
  const scrollTimer = useRef<number>(0);

  useEffect(() => () => { window.clearTimeout(hoverTimer.current); window.clearTimeout(scrollTimer.current); }, []);

  const load = useCallback(() => Promise.all([studioApi.templates(), studioApi.scenarios(), studioApi.current()])
    .then(([t, s, c]) => { setTemplates(t); setItems(s); setCurrent(c); setErr(null); })
    .catch(setErr), []);
  useEffect(() => { load(); }, [load]);

  const create = async (t: Template) => {
    if (t.template_id === "blank") { setOwn(true); return; }
    try { const s = await studioApi.create(t.template_id); nav(`/studio/${s.scenario_id}`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };

  const q = query.trim().toLowerCase();
  const recordedRows = useMemo(() => (items ?? []).filter(s => !!s.recorded), [items]);
  const savedRows = useMemo(() => (items ?? []).filter(s => !s.recorded), [items]);
  const tplRows = useMemo(() => templates ?? [], [templates]);

  const matchSc = (s: ScenarioRow) => (!q || `${s.title} ${s.template_id} ${s.intensity}`.toLowerCase().includes(q));
  const matchTpl = (t: Template) => (!q || `${t.title} ${t.summary} ${t.tags.join(" ")}`.toLowerCase().includes(q));

  const groups = useMemo(() => {
    const out: {
      key: "recorded" | "templates" | "saved";
      label: string;
      dot: string;
      entries: ({ kind: "scenario"; row: ScenarioRow } | { kind: "template"; tpl: Template })[];
    }[] = [];
    const want = (k: StudioShow) => (show === "all" || show === k) && (!typeFilter || typeFilter === k);
    if (want("recorded")) {
      const xs = recordedRows.filter(matchSc);
      if (xs.length) out.push({ key: "recorded", label: "Ready to replay · Instant demo", dot: "live", entries: xs.map(row => ({ kind: "scenario", row })) });
    }
    if (want("templates")) {
      const xs = tplRows.filter(matchTpl);
      if (xs.length) out.push({ key: "templates", label: "Start from a template", dot: "paused", entries: xs.map(tpl => ({ kind: "template", tpl })) });
    }
    if (want("saved")) {
      const xs = savedRows.filter(matchSc);
      if (xs.length) out.push({ key: "saved", label: "Your saved scenarios", dot: "draft", entries: xs.map(row => ({ kind: "scenario", row })) });
    }
    return out;
  }, [recordedRows, tplRows, savedRows, show, typeFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const allEntries = useMemo(() => groups.flatMap(g => g.entries), [groups]);
  const activeEntry = useMemo(() => {
    if (sel) {
      const found = allEntries.find(e => (e.kind === "scenario" && sel.kind === "scenario" && e.row.scenario_id === sel.id)
        || (e.kind === "template" && sel.kind === "template" && e.tpl.template_id === sel.id));
      if (found) return found;
    }
    return allEntries[0] ?? null;
  }, [allEntries, sel]);

  // Lazily fetch & cache full scenario details when selected or hovered
  const activeScId = activeEntry?.kind === "scenario" ? activeEntry.row.scenario_id : null;
  useEffect(() => {
    if (!activeScId || details[activeScId]) return;
    let live = true;
    studioApi.scenario(activeScId).then(d => { if (live) setDetails(m => ({ ...m, [activeScId]: d })); }).catch(() => {});
    return () => { live = false; };
  }, [activeScId, details]);

  const ready = recordedRows[0];
  const totalCount = recordedRows.length + tplRows.length + savedRows.length;
  const focusedGroup = hoveredGroup ?? scrollGroup;
  const staging = groups.length > 1 && focusedGroup !== null;

  const onEntryEnter = (key: StudioKey) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setSel(key), 90);
  };
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const top = el.getBoundingClientRect().top + 36;
    let active: string | null = groups[0]?.key ?? null;
    el.querySelectorAll<HTMLElement>("[data-grp]").forEach(sec => {
      if (sec.getBoundingClientRect().top <= top) active = sec.dataset.grp ?? active;
    });
    if (el.scrollTop > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 6) {
      active = groups[groups.length - 1]?.key ?? active;
    }
    setScrollGroup(active);
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => setScrollGroup(null), 650);
  };

  const activeDetail = activeScId ? details[activeScId] : null;

  return (
    <div className="eos-pad" style={{ paddingBottom: 0 }}>
      <div className="eos-hd">
        <div>
          <span className="label">Try It Out · Sandbox Simulation</span>
          <h1>
            {items === null ? "Scenario Studio" : <><span className="eos-h-ok">{plural(items.length, "scenario")}</span> ready · live data untouched</>}
          </h1>
          <div className="sub">Replay a recorded 21-day shock in 30 seconds or author custom headlines and FX moves to test how AMIRI's agents respond.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" type="button" onClick={() => setOwn(true)}><Icon name="plus" />Write your own</button>
          {ready && !current && (
            <button className="btn btn--primary" type="button" onClick={() => start(ready.scenario_id, "replay")}>
              <Icon name="play" />Replay {ready.title.length > 26 ? "recorded run" : ready.title}
            </button>
          )}
        </div>
      </div>

      {err != null && templates === null ? <LoadError error={err} onRetry={load} what="the Scenario Studio" /> : <>
        {current && <div className="banners"><CurrentBanner sim={current} /></div>}

        <div className="eos-filterbar" style={{ marginBottom: 0 }}>
          <SearchInput value={query} onChange={setQuery} ariaLabel="Search scenarios" placeholder="Search scenarios, templates, or tags…" count={allEntries.length} />
          <SelectMenu label="Filter by type" value={typeFilter} onChange={setTypeFilter} options={[
            { value: "", label: "All types" },
            { value: "recorded", label: "Ready to replay" },
            { value: "templates", label: "Templates" },
            { value: "saved", label: "Your scenarios" },
          ]} />
          <FlowFilter toned label="Which scenarios" value={show} onChange={setShow}
            all={{ key: "all", label: "All", count: totalCount }}
            steps={[
              { key: "recorded", label: "Ready to replay", count: recordedRows.length, state: "done" },
              { key: "templates", label: "Templates", count: tplRows.length, state: "queued" },
              ...(savedRows.length ? [{ key: "saved" as const, label: "Saved", count: savedRows.length }] : []),
            ]} />
        </div>

        {templates === null || items === null ? <div className="mt12"><InlineSkeleton /></div> : allEntries.length === 0 ? (
          <div className="mt16"><Empty icon="studio" title="No matching scenarios">Try clearing your search or filter, or write a custom scenario.</Empty></div>
        ) : (
          <div className="eos-split">
            <div className="eos-list" data-staging={staging ? "true" : "false"}
              onMouseLeave={() => { window.clearTimeout(hoverTimer.current); setHoveredGroup(null); }}
              onScroll={onListScroll}>
              {groups.map(g => (
                <section key={g.key} className="eos-grp" data-grp={g.key}
                  data-focused={!staging || focusedGroup === g.key ? "true" : "false"}
                  onMouseEnter={() => setHoveredGroup(g.key)}>
                  <div className="eos-grp-hd">
                    <span className={`eos-grp-dot ${g.dot}`} aria-hidden="true" />
                    <span>{g.label}</span>
                    <span className="eos-grp-cnt">{g.entries.length}</span>
                  </div>
                  {g.entries.map(entry => {
                    if (entry.kind === "scenario") {
                      const s = entry.row;
                      const isSel = activeEntry?.kind === "scenario" && activeEntry.row.scenario_id === s.scenario_id;
                      return (
                        <button key={`sc-${s.scenario_id}`} type="button" className="eos-row" data-selected={isSel}
                          onClick={() => { window.clearTimeout(hoverTimer.current); setSel({ kind: "scenario", id: s.scenario_id }); }}
                          onMouseEnter={() => onEntryEnter({ kind: "scenario", id: s.scenario_id })}>
                          <div className="row" style={{ gap: 8 }}>
                            <strong style={{ color: "var(--ink)" }}>{s.title}</strong>
                            <span style={{ marginLeft: "auto" }}>
                              {s.recorded ? <span className="badge b-ok">Recorded</span> : <span className="chip">{s.template_id === "blank" ? "Custom" : "Saved"}</span>}
                            </span>
                          </div>
                          <span className="small muted">
                            {s.template_id === "blank" ? "Written by you" : `Intensity: ${s.intensity}`} · made {dayTime(s.created_at)}
                            {s.last_run ? ` · ran ${dayTime(s.last_run)}` : ""}
                          </span>
                        </button>
                      );
                    }
                    const t = entry.tpl;
                    const isSel = activeEntry?.kind === "template" && activeEntry.tpl.template_id === t.template_id;
                    return (
                      <button key={`tpl-${t.template_id}`} type="button" className="eos-row" data-selected={isSel}
                        onClick={() => { window.clearTimeout(hoverTimer.current); setSel({ kind: "template", id: t.template_id }); }}
                        onMouseEnter={() => onEntryEnter({ kind: "template", id: t.template_id })}>
                        <div className="row" style={{ gap: 8 }}>
                          <strong style={{ color: "var(--ink)" }}>{t.title}</strong>
                          <span className="chip" style={{ marginLeft: "auto" }}>{t.template_id === "blank" ? "Blank" : "Template"}</span>
                        </div>
                        <span className="small muted">{t.summary}</span>
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>

            <div className="eos-insp">
              {activeEntry?.kind === "scenario" && (() => {
                const s = activeEntry.row;
                const d = activeDetail;
                const b = d?.built;
                const headlineDays = new Set((b?.headlines ?? []).map(h => h.day));
                const rampDays = b?.prices.off ? 0 : (b?.prices.shock?.ramp_business_days ?? 0);
                return (
                  <>
                    <div className="eos-hd">
                      <div>
                        <div className="label">
                          {s.recorded ? "Recorded Replay" : s.template_id === "blank" ? "Custom Scenario" : "Saved Scenario"}
                          {b ? ` · ${b.institution.name} · ${b.prices.symbol}` : ""}
                        </div>
                        <h2 style={{ marginTop: 2 }}>{s.title}</h2>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        {s.recorded ? (
                          <button className="btn btn--primary btn--sm" type="button" disabled={!!current} onClick={() => start(s.scenario_id, "replay")}>
                            <Icon name="play" />Replay (30s)
                          </button>
                        ) : (
                          <button className="btn btn--primary btn--sm" type="button" disabled={!!current} onClick={() => start(s.scenario_id, "live")}>
                            <Icon name="play" />Run live
                          </button>
                        )}
                        {s.recorded && (
                          <button className="btn btn--sm" type="button" disabled={!!current} onClick={() => start(s.scenario_id, "live")}>Run live</button>
                        )}
                        <Link className="btn btn--sm btn--ghost" to={`/studio/${s.scenario_id}`}>Edit &amp; configure →</Link>
                      </div>
                    </div>

                    {!d || !b ? <InlineSkeleton /> : (
                      <>
                        <div className="eos-ai">
                          <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>Sandbox Agent Pipeline · What AMIRI will trace</div>
                          <div className="eos-ai-bd" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <div>
                              <b>Monitor Agent</b> ({b.monitor.spec.about.name}) reads <b>{plural(b.headlines.length, "simulated headline")}</b> over {b.clock.steps} days
                              {!b.prices.off && b.prices.shock ? <> while <b>Market Series</b> injects a <b>{b.prices.shock.size_pct.toFixed(1)}% {b.prices.symbol}</b> ramp over {b.prices.shock.ramp_business_days} business days</> : null}.
                            </div>
                            <div>
                              <span style={{ color: "var(--accent)", fontWeight: 700, marginRight: 6 }} aria-hidden="true">↳</span>
                              <b>Investigation Agent</b> traces impacts across your bank's products without touching live data.
                            </div>
                          </div>
                        </div>

                        {b.stories.length > 0 && (
                          <div>
                            <div className="label" style={{ marginBottom: 8 }}>Expected Stories &amp; Tone ({b.stories.length})</div>
                            <div className="row wrap" style={{ gap: 8 }}>
                              {b.stories.map(st => (
                                <span key={st.key} className="row" style={{ gap: 6, padding: "4px 10px 4px 6px", borderRadius: 99, border: "1px solid var(--hairline)", background: "var(--surface)", fontSize: 12.5 }}>
                                  <TonePill tone={st.tone} />
                                  <span style={{ color: st.expected ? "var(--ink)" : "var(--ink-3)" }}>{st.label}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                            <span className="label">{b.clock.steps}-Day Event Injection Preview</span>
                            <span className="small muted">Green = headlines · Red = FX shock ramp</span>
                          </div>
                          <div className="eos-tl-bar" aria-label="21-day simulation schedule">
                            {Array.from({ length: b.clock.steps }, (_, idx) => {
                              const dayNum = idx + 1;
                              const isShock = rampDays > 0 && dayNum >= 5 && dayNum < 5 + rampDays;
                              const hasNews = headlineDays.has(dayNum);
                              return (
                                <span
                                  key={dayNum}
                                  className={`eos-tl-day${isShock ? " shock" : hasNews ? " news" : ""}`}
                                  title={`Day ${dayNum}${hasNews ? " · headlines" : ""}${isShock ? " · FX shock ramp" : ""}`}
                                />
                              );
                            })}
                          </div>
                        </div>

                        <details className="eos-fold">
                          <summary>Simulated Headlines ({b.headlines.length})</summary>
                          <div className="eos-fold-bd col" style={{ gap: 6 }}>
                            {b.headlines.length === 0 ? <span className="muted">No active headlines yet.</span> : b.headlines.map(h => (
                              <div key={h.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                                <span className="mono small muted" style={{ flexShrink: 0 }}>Day {h.day}</span>
                                <span style={{ color: "var(--ink)" }}>{h.title}</span>
                              </div>
                            ))}
                          </div>
                        </details>

                        <details className="eos-fold" open={d.simulations.length > 0}>
                          <summary>Past Runs ({d.simulations.length})</summary>
                          <div className="eos-fold-bd col" style={{ gap: 6 }}>
                            {d.simulations.length === 0 ? <span className="muted">Not run yet — press Replay or Run live above to start.</span> : d.simulations.map(m => (
                              <div key={m.sim_id} className="row" style={{ justifyContent: "space-between" }}>
                                <span>{dayTime(m.created_at)} · {m.mode === "replay" ? "replay" : m.mode === "record" ? "live, saved" : "live"} · {m.status} (day {m.step}/{m.steps})</span>
                                <Link to={`/studio/run/${m.sim_id}`} style={{ fontWeight: 600 }}>Open run →</Link>
                              </div>
                            ))}
                          </div>
                        </details>
                      </>
                    )}
                  </>
                );
              })()}

              {activeEntry?.kind === "template" && (() => {
                const t = activeEntry.tpl;
                return (
                  <>
                    <div className="eos-hd">
                      <div>
                        <div className="label">{t.template_id === "blank" ? "Blank Sandbox" : "Scenario Template"}</div>
                        <h2 style={{ marginTop: 2 }}>{t.title}</h2>
                      </div>
                      {!t.unavailable && (
                        <button className="btn btn--primary btn--sm" type="button" onClick={() => create(t)}>
                          <Icon name="plus" />{t.template_id === "blank" ? "Write your own" : "Use this template"}
                        </button>
                      )}
                    </div>

                    <div className="eos-ai">
                      <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>Sandbox Template · Isolated from Live Data</div>
                      <div className="eos-ai-bd">{t.summary}</div>
                    </div>

                    {t.tags.length > 0 && (
                      <div>
                        <div className="label" style={{ marginBottom: 8 }}>Risk Domains Covered</div>
                        <div className="row wrap" style={{ gap: 6 }}>
                          {t.tags.map(x => <span key={x} className="chip">{TAG[x] ?? x}</span>)}
                        </div>
                      </div>
                    )}

                    {t.unavailable && <Banner kind="warn" icon="warn">Can't run here: {t.unavailable}.</Banner>}

                    <p className="small muted">
                      {t.template_id === "blank"
                        ? "Write up to 30 custom headlines across 21 simulated days (or import JSON) and optionally inject a custom exchange-rate shock. AMIRI Agent's monitors and investigation trace them without affecting live alerts."
                        : "Creates a customizable copy for your institution. You can tune shock intensity, toggle individual headlines, and replay or run live with AMIRI's agents."}
                    </p>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </>}
      {own && <NewOwnModal onClose={() => setOwn(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- one scenario

const newId = () => `c-${Math.random().toString(36).slice(2, 8)}`;

/** One headline, written or edited in place. */
function HeadlineForm({ value, dayLabel, onSave, onCancel }: {
  value: HeadlineIn; dayLabel: (d: number) => string; onSave: (h: HeadlineIn) => void; onCancel: () => void;
}) {
  const [h, setH] = useState(value);
  const ok = h.title.trim().length >= 8;
  return (
    <div className="st-form">
      <label className="field"><span>Headline</span>
        <textarea className="input" rows={2} autoFocus maxLength={200} value={h.title} placeholder="e.g. Saudi Arabia freezes new work visas for six months"
          onChange={e => setH({ ...h, title: e.target.value })} /></label>
      <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
        <label className="field" style={{ width: 190 }}><span>Published on</span>
          <select className="input" value={h.day} onChange={e => setH({ ...h, day: Number(e.target.value) })}>
            {Array.from({ length: DAYS }, (_, i) => i + 1).map(d => <option key={d} value={d}>Day {d} · {dayLabel(d)}</option>)}</select></label>
        <label className="field" style={{ width: 120 }}><span>At</span>
          <input className="input" type="time" value={h.time} onChange={e => setH({ ...h, time: e.target.value || "09:00" })} /></label>
        <span className="spacer" />
        <button className="btn btn--sm" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn--sm btn--primary" type="button" disabled={!ok} onClick={() => onSave({ ...h, title: h.title.trim() })}>Save headline</button>
      </div>
      {!ok && h.title.length > 0 && <span className="hint">A headline needs at least 8 characters.</span>}
    </div>
  );
}

function Headlines({ s, save, startOpen }: { s: Scenario; save: (body: { custom?: Custom; switched_off?: string[] }) => Promise<void>; startOpen: boolean }) {
  const b = s.built;
  const all = b.all_headlines;
  const off = new Set(s.switched_off);
  const [editing, setEditing] = useState<string | null>(startOpen && !all.length ? "new" : null);
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: b.institution.time_zone });
  const dayLabel = (d: number) => fmt.format(new Date(new Date(b.clock.start_at).getTime() + (d - 1) * 86400_000 + 12 * 3600_000));
  const list = (): HeadlineIn[] => all.map(h => ({ id: h.id, title: h.title, day: h.day, time: h.time }));
  const put = async (next: HeadlineIn[]) => { await save({ custom: { headlines: next } }); setEditing(null); };
  const upsert = (h: HeadlineIn) => put(editing === "new" ? [...list(), h] : list().map(x => (x.id === h.id ? h : x)));
  const remove = (id: string) => put(list().filter(x => x.id !== id));
  const toggle = (id: string) => save({ switched_off: off.has(id) ? s.switched_off.filter(x => x !== id) : [...s.switched_off, id] });
  return (
    <div className="card"><div className="hd"><h2>Headlines</h2><span className="small muted">{plural(all.length - all.filter(h => off.has(h.id)).length, "headline")} in the run</span>
      <span className="spacer" />{editing !== "new" && all.length < 30 && <button className="btn btn--sm" type="button" onClick={() => setEditing("new")}><Icon name="plus" />Add a headline</button>}</div>
      {!all.length && editing !== "new" && <div className="bd"><Empty icon="edit" title="No headlines yet" actions={<button className="btn btn--primary" type="button" onClick={() => setEditing("new")}><Icon name="plus" />Write the first headline</button>}>
        Write what happens and on which day. AMIRI Agent's monitor reads each headline the day it is published.</Empty></div>}
      <div className="list">{all.map(h => editing === h.id
        ? <div key={h.id} className="li"><HeadlineForm value={{ id: h.id, title: h.title, day: h.day, time: h.time }} dayLabel={dayLabel} onSave={upsert} onCancel={() => setEditing(null)} /></div>
        : (
          <div key={h.id} className={`li st-head ${off.has(h.id) ? "off" : ""}`}>
            <label className="st-pick">{/* the whole headline is the checkbox's target, not 18 px of it */}
              <input type="checkbox" checked={!off.has(h.id)} onChange={() => toggle(h.id)} aria-label={`Include: ${h.title}`} />
              <span className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <span className="small muted">Day {h.day} · {dayLabel(h.day)} {h.time}{h.story === "custom" && b.template_id !== "blank" ? " · added by you" : ""}</span>
                <span className="st-title">{h.title}</span>
              </span>
            </label>
            <button className="btn btn--sm btn--ghost btn--icon" type="button" aria-label={`Edit: ${h.title}`} onClick={() => setEditing(h.id)}><Icon name="edit" /></button>
            <button className="btn btn--sm btn--ghost btn--icon" type="button" aria-label={`Remove: ${h.title}`} onClick={() => remove(h.id)}><Icon name="trash" /></button>
          </div>))}
        {editing === "new" && <div className="li"><HeadlineForm value={{ id: newId(), title: "", day: Math.min(DAYS, (all[all.length - 1]?.day ?? 0) + 1), time: "09:00" }}
          dayLabel={dayLabel} onSave={upsert} onCancel={() => setEditing(null)} /></div>}
      </div>
    </div>
  );
}

function PriceMoveCard({ s, save }: { s: Scenario; save: (body: { custom?: Custom }) => Promise<void> }) {
  const cur = s.built.institution.currency === "USD" ? "US dollar" : s.built.institution.currency;
  const [m, setM] = useState<PriceMove>(s.built.prices.move ?? { direction: "none", size_pct: 0, ramp_days: 5 });
  const saved = JSON.stringify(s.built.prices.move ?? {}) === JSON.stringify(m);
  return (
    <div className="col" style={{ gap: 10 }}>
      <label className="field"><span>Exchange rate</span>
        <select className="input" value={m.direction} onChange={e => setM({ ...m, direction: e.target.value as PriceMove["direction"], size_pct: m.size_pct || 5 })}>
          <option value="none">No price move</option>
          <option value="weaker">The {cur} weakens against the US dollar</option>
          <option value="stronger">The {cur} strengthens against the US dollar</option></select></label>
      {m.direction !== "none" && <div className="row" style={{ gap: 10 }}>
        <label className="field" style={{ flex: 1 }}><span>By (%)</span>
          <input className="input" type="number" min={0.5} max={30} step={0.5} value={m.size_pct} onChange={e => setM({ ...m, size_pct: Number(e.target.value) })} /></label>
        <label className="field" style={{ flex: 1 }}><span>Over (business days)</span>
          <input className="input" type="number" min={1} max={15} value={m.ramp_days} onChange={e => setM({ ...m, ramp_days: Number(e.target.value) })} /></label>
      </div>}
      {!saved && <button className="btn btn--sm" type="button" style={{ alignSelf: "flex-start" }}
        disabled={m.direction !== "none" && !(m.size_pct >= 0.5 && m.size_pct <= 30 && m.ramp_days >= 1 && m.ramp_days <= 15)}
        onClick={() => save({ custom: { prices: m } })}>Save the price move</button>}
    </div>
  );
}

export function ScenarioPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const start = useStart();
  const [s, setS] = useState<Scenario | null>(null);
  const [current, setCurrent] = useState<Simulation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [asking, setAsking] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const fresh = new URLSearchParams(window.location.search).has("new");
  const load = useCallback(() => Promise.all([studioApi.scenario(id), studioApi.current()])
    .then(([x, c]) => { setS(x); setCurrent(c); setErr(null); })
    .catch(setErr), [id]);
  useEffect(() => { load(); }, [load]);
  if (!s) return <div className="page">{err != null ? <><PageHead title="Scenario" crumbs={<Link to="/studio">Scenario Studio</Link>} /><LoadError error={err} onRetry={load} what="this scenario" /></> : <PageSkeleton bare />}</div>;
  const b = s.built;
  const own = b.template_id === "blank";
  const save = async (body: { intensity?: string; switched_off?: string[]; title?: string; custom?: Custom }) => {
    try { setS(await studioApi.update(id, body)); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const off = new Set(s.switched_off);
  const toggle = (key: string) => save({ switched_off: off.has(key) ? s.switched_off.filter(x => x !== key) : [...s.switched_off, key] });
  const rec = s.recording;
  const empty = !b.headlines.length && (b.prices.off ?? true);
  const replayable = !!(rec?.complete && rec.current);
  return (
    <div className="page">
      <PageHead title={naming !== null
          ? <span className="row" style={{ gap: 8 }}><input className="input" aria-label="Scenario name" autoFocus style={{ fontSize: 20, height: 40, width: "min(520px, 70vw)" }} value={naming} maxLength={120}
              onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && naming.trim()) { save({ title: naming.trim() }); setNaming(null); } if (e.key === "Escape") setNaming(null); }} />
            <button className="btn btn--sm btn--primary" type="button" disabled={!naming.trim()} onClick={() => { save({ title: naming.trim() }); setNaming(null); }}>Save</button></span>
          : <span className="row" style={{ gap: 8 }}>{s.title}<button className="btn btn--sm btn--ghost btn--icon" type="button" aria-label="Rename" onClick={() => setNaming(s.title)}><Icon name="edit" /></button></span>}
        crumbs={<><Link to="/studio">Scenario Studio</Link> / {s.title}</>}
        sub={<>For {b.institution.name} · {b.prices.symbol} · starts {dayTime(b.clock.start_at)} · {b.clock.steps} days, a day per step{own ? " · your own scenario" : ""}</>}
        actions={asking ? <span className="row" style={{ gap: 6 }}><span className="small">Delete this scenario and its runs?</span>
          <button className="btn btn--danger btn--sm" type="button" onClick={async () => { try { await studioApi.remove(id); nav("/studio"); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); } }}>Delete</button>
          <button className="btn btn--sm" type="button" onClick={() => setAsking(false)}>Keep it</button></span>
          : <button className="btn btn--ghost" type="button" onClick={() => setAsking(true)}><Icon name="trash" />Delete</button>} />
      <div className="banners">
        {err != null && <LoadError error={err} onRetry={load} what="this scenario" />}
        <CurrentBanner sim={current} />
        {!current && s.simulations[0] && <LastRunBanner m={s.simulations[0]} />}
        <Banner kind="info">{own ? "Your headlines are marked simulated and never reach the live pages. AMIRI Agent's monitor reads each one on its day; the investigation traces what it finds to your products."
          : "The headlines are written for this scenario and marked simulated; you can edit, add or remove them. Their figures come from the price path. Sizes are illustrative."}</Banner>
      </div>
      <div className="split mt12">
        <div className="col gap16">
          <Headlines s={s} save={save} startOpen={fresh} />
          {!own && <div className="card"><div className="hd"><h2>What AMIRI Agent should find</h2></div><div className="list">{b.stories.map(st => (
            <div key={st.key} className="li"><div className="row" style={{ gap: 8, flex: 1 }}>
              <TonePill tone={st.tone} /><span style={{ flex: 1 }}>{st.label}</span>
              {!st.expected && <span className="small muted">not expected: its headlines are out</span>}</div></div>))}</div></div>}
        </div>
        <div className="col gap16">
          <div className="card"><div className="hd"><h2>Run</h2></div><div className="bd col" style={{ gap: 10 }}>
            {own ? <PriceMoveCard key={s.version} s={s} save={save} /> : <>
              <label className="field"><span>How hard the shock hits</span>
                <select className="input" value={s.intensity} onChange={e => save({ intensity: e.target.value })}>
                  <option value="low">Low (×0.5)</option><option value="medium">Medium</option><option value="high">High (×1.5)</option></select></label>
              <label className="check"><input type="checkbox" checked={!off.has("prices")} onChange={() => toggle("prices")} /><span>Move {b.prices.symbol} ({b.prices.shock.size_pct.toFixed(1)}% over {b.prices.shock.ramp_business_days} business days)</span></label>
            </>}
            <div className="divider" />
            {empty && <span className="small" style={{ color: "var(--high-ink)" }}>Add a headline or a price move to run it.</span>}
            {MODES.map(([m, label, help]) => (
              <button key={m} className={`btn ${m === (replayable ? "replay" : "live") ? "btn--primary" : ""}`} type="button" title={help}
                disabled={!!current || empty || (m === "replay" && !replayable)} onClick={() => start(id, m)}>
                <Icon name="play" />{label}</button>))}
            <span className="small muted">{rec ? (rec.current ? (rec.complete ? `Recorded ${dayTime(rec.recorded_at)}.` : "A recording was started but didn't finish.")
              : "Changed since it was recorded: run it live and save it to replay again.") : "Not recorded yet: run it live and save it, then it replays instantly."}</span>
          </div></div>
          <div className="card"><div className="hd"><h2>The monitor it runs</h2></div><div className="bd col" style={{ gap: 6 }}>
            <b>{b.monitor.spec.about.name}</b><span className="small muted">{b.monitor.spec.public.in_one_sentence}</span>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{b.monitor.spec.public.tell_me_if.map(l => <li key={l}>{l}</li>)}</ul>
            <span className="small muted">It reads the scenario's headlines, not the web.</span></div></div>
          {s.simulations.length > 0 && <div className="card"><div className="hd"><h2>Runs</h2></div><div className="list">{s.simulations.map(m => (
            <div key={m.sim_id} className="li"><Link to={`/studio/run/${m.sim_id}`} className="small">{dayTime(m.created_at)} · {m.mode === "replay" ? "replay" : m.mode === "record" ? "live, saved" : "live"} · {m.status} · day {m.step} of {m.steps}</Link></div>))}</div></div>}
        </div>
      </div>
    </div>
  );
}
