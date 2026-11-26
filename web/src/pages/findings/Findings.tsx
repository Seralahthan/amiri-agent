// Findings, by outcome: what came in over the last 7 days and what the investigation made of it. The headline answers; the funnel
// filter switches between the steps; findings still being looked at are pinned first, then one section per event, then the ones
// with no impact, folded. A line opens what happened and why it matters. No live push: the page reloads every 30 s.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventRow, type FindingRow } from "../../api/investigation";
import { FlowFilter } from "../../components/FlowFilter";
import { Icon } from "../../components/Icon";
import { TonePill } from "../../components/blocks";
import { SearchInput } from "../../components/SearchInput";
import { SelectMenu } from "../../components/SelectMenu";
import { Banner, Empty, errText, isDown, ListSkeleton, LoadError, useNow, useToast } from "../../components/ui";
import { ago, dayTime, placeName, until } from "../../format";
import { count, eventTitle, longWhen, signalStrength, sourceInfo, undated } from "../../plain";
import "../../styles/findings.css";
import { InvestigateNowButton, useInvestigationStatus } from "../events/Events";
import { EventsFindingsTabs } from "../../components/WorkspaceTabs";
import { DAYS, reasonText, useRecentFindings } from "./recent";

type F = FindingRow & { evidence?: { headlines?: { url?: string | null }[] } | null };
type Show = "all" | "new" | "grouped" | "linked" | "set_aside";
const FEW = 4;  // findings an event shows before "the other N"
const url = (f: F) => f.evidence?.headlines?.find(h => h.url)?.url ?? null;
// the explanation reads "what happened. Why it matters: …"; split so the opened line can lead with the why
const split = (t?: string | null) => { const [a, b] = (t ?? "").split(/\s*Why it matters:\s*/); return { what: a?.trim() ?? "", why: b?.trim() ?? "" }; };

function sourceLink(f: FindingRow): string | null {
  const r = f.source_ref ?? {};
  if (f.source === "monitor" && r.monitor_id) return `/monitors/${r.monitor_id}`;
  if (f.source === "timeseries" && r.series_id) return `/series/${r.series_id}`;
  if (f.source === "radar") return "/radar";
  return null;
}

function SignalBars({ level, label }: { level: 1 | 2 | 3; label: string }) {
  const color = level === 3 ? "var(--accent)" : level === 2 ? "var(--high)" : "var(--ink-3)";
  return (
    <span className="fd-sig" title={label} aria-label={label}>
      <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
        <rect x="1" y="9" width="3" height="4" rx="1" fill={level >= 1 ? color : "var(--hairline-2)"} />
        <rect x="6.5" y="5.5" width="3" height="7.5" rx="1" fill={level >= 2 ? color : "var(--hairline-2)"} />
        <rect x="12" y="2" width="3" height="11" rx="1" fill={level >= 3 ? color : "var(--hairline-2)"} />
      </svg>
    </span>
  );
}

const SOURCE_META: Record<string, { icon: string; label: string }> = {
  monitor: { icon: "monitor", label: "Monitor" },
  radar: { icon: "radar", label: "Radar" },
  timeseries: { icon: "series", label: "Market Series" },
};

export function FindingsPage() {
  const toast = useToast();
  const now = useNow(15_000);
  const { hash } = useLocation();
  const { items, err, loadedAt, load } = useRecentFindings();
  const { status, reload } = useInvestigationStatus();
  const [show, setShow] = useState<Show>("all");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [events, setEvents] = useState<Record<string, EventRow>>({});
  const [open, setOpen] = useState<string | null>(null);         // the finding whose line is open
  const [all, setAll] = useState<Record<string, boolean>>({});   // sections showing every finding
  const [checking, setChecking] = useState<string | null>(null);
  useEffect(() => { investigationApi.events().then(xs => setEvents(Object.fromEntries(xs.map(e => [e.event_id, e])))).catch(() => {}); }, [items]);
  const refresh = () => { load(); reload(); };
  const allXs = (items ?? []) as F[];
  const xs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allXs.filter(f => {
      if (sourceFilter && f.source !== sourceFilter) return false;
      if (!q) return true;
      return `${f.title} ${f.explanation} ${f.source}`.toLowerCase().includes(q);
    });
  }, [allXs, query, sourceFilter]);
  const n = (s: Show) => xs.filter(f => s === "all" || f.status === s).length;

  const pending = xs.filter(f => (f.status === "new" || f.status === "grouped") && (show === "all" || show === f.status));
  const groups = useMemo(() => {
    const m = new Map<string, F[]>();
    xs.filter(f => f.status === "linked").forEach(f => { const k = f.outcome?.event_id ?? ""; m.set(k, [...(m.get(k) ?? []), f]); });
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [items]);  // eslint-disable-line react-hooks/exhaustive-deps
  const aside = xs.filter(f => f.status === "set_aside");

  // from the Overview: open on that finding, unfolding its section
  const target = decodeURIComponent(hash.slice(1)).replace(/^f-/, "");
  useEffect(() => {
    const f = xs.find(x => x.finding_id === target);
    if (!f) return;
    setShow("all"); setOpen(f.finding_id);
    setAll(a => ({ ...a, [f.status === "set_aside" ? "aside" : f.outcome?.event_id ?? ""]: true }));
  }, [items, target]);  // eslint-disable-line react-hooks/exhaustive-deps
  const went = useRef("");  // scroll to it once its line is drawn, and only once
  useEffect(() => {
    const el = target && went.current !== target ? document.getElementById(`f-${target}`) : null;
    if (el) { went.current = target; el.scrollIntoView({ block: "center" }); }
  });

  const check = async (f: FindingRow) => {
    if (!f.run_id) return;
    setChecking(f.finding_id);
    try {
      const r = await investigationApi.collect(f.run_id);
      toast(r.status === "running" ? "Still being investigated. Try again in a moment." : "The investigation has finished.");
      refresh();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setChecking(null); }
  };
  const nextBatch = status?.next_batch_at && status.connected ? (new Date(status.next_batch_at) <= now ? "very soon" : `in ${until(status.next_batch_at, now)}`) : null;

  const line = (f: F) => {
    const si = SOURCE_META[f.source] ?? sourceInfo(f.source);
    const src = sourceLink(f);
    const sig = signalStrength(f.score);
    const sigWord = sig ? sig[0].split(" ")[0].toLowerCase() : "";
    const sigLevel: 1 | 2 | 3 = sigWord === "strong" ? 3 : sigWord === "moderate" ? 2 : 1;
    const loc = f.places?.length ? placeName(f.places[0]) : "";
    const isOpen = open === f.finding_id, x = split(f.explanation);
    const srcNode = <><Icon name={si.icon} /><span>{si.label}</span></>;
    return <li key={f.finding_id} id={`f-${f.finding_id}`} className={`fd-line ${f.status} ${target === f.finding_id ? "target" : ""}`}>
      <time dateTime={f.created_at} title={longWhen(f.created_at)}>{dayTime(f.created_at)}</time>
      {src ? <Link className={`fd-src src-${f.source}`} to={src}>{srcNode}</Link> : <span className={`fd-src src-${f.source}`}>{srcNode}</span>}
      <button type="button" className="fd-t" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.finding_id)}>{undated(f.title)}</button>
      <span className="fd-loc" title={f.places?.map(placeName).join(", ") || undefined}>{loc}</span>
      {sig ? <SignalBars level={sigLevel} label={sig[0]} /> : <span className="fd-sig" />}
      {isOpen && <div className="fd-x">
        {f.status === "new" && <p className="fd-out">Waiting to be investigated{nextBatch ? `: the next batch goes ${nextBatch}` : ""}.</p>}
        {f.status === "grouped" && <p className="fd-out">Being investigated{f.run_started_at ? `, started ${ago(f.run_started_at, now)}` : ""}.</p>}
        {f.status === "set_aside" && <p className="fd-out">No impact found: {reasonText(f) || "no link to your products"}.</p>}
        {x.why && <p className="fd-why"><b>Why it matters.</b> {x.why}</p>}
        {x.what && <p>{x.what}</p>}
        {url(f) && <p><a href={url(f)!} target="_blank" rel="noreferrer">Read the article<Icon name="external" className="src-ext" /></a></p>}
      </div>}
      {f.status === "grouped" && f.run_status === "running" && f.run_id && <span className="fd-run">
        <button className="btn btn--sm" type="button" disabled={checking === f.finding_id} onClick={() => check(f)}>
          <Icon name="refresh" className={checking === f.finding_id ? "spin" : undefined} />Check now</button>
        <span className="muted">Otherwise the result comes in on its own within a few minutes.</span></span>}
    </li>;
  };
  const lines = (k: string, fs: F[], few = FEW) => <>
    <ol className="fd-lines">{(all[k] ? fs : fs.slice(0, few)).map(line)}</ol>
    {fs.length > few && <button type="button" className="fd-more" aria-expanded={!!all[k]} onClick={() => setAll(a => ({ ...a, [k]: !a[k] }))}>
      <Icon name="chevron" className={`ico16 ${all[k] ? "rot" : ""}`} />{all[k] ? "Show fewer" : few ? `Show the other ${fs.length - few}` : `Show the ${fs.length}`}</button>}
  </>;

  const linked = groups.reduce((s, [, fs]) => s + fs.length, 0);
  const into = groups.length === 1 && events[groups[0][0]] ? <>went into <Link className="fd-ev" to={`/events/${groups[0][0]}`}>{eventTitle(events[groups[0][0]])}</Link></> : <>went into {count(groups.length, "event")}</>;
  const shown = (show === "all" || show === "new" || show === "grouped" ? pending.length : 0) + (show === "all" || show === "linked" ? linked : 0) + (show === "all" || show === "set_aside" ? aside.length : 0);
  return (
    <div className="eos-pad fd">
      <EventsFindingsTabs right={<button className="btn btn--ghost btn--sm" type="button" onClick={refresh}><Icon name="refresh" />Refresh</button>} />
      <div className="eos-hd">
        <div>
          <div className="label">Signal Funnel · Last {DAYS} days{loadedAt ? ` · updated ${ago(loadedAt.toISOString(), now)}` : ""}</div>
          <h1>{items === null ? "Findings" : <><span className="eos-h-ok">{count(xs.length, "finding")}</span> came in this week</>}</h1>
          {items !== null && xs.length > 0 && <p className="sub">{linked ? <><b>{linked}</b> {into}</> : "None went into an event"}{aside.length ? <>; <b>{aside.length}</b> had no impact</> : null}.</p>}
        </div>
      </div>
      {err != null && (items === null ? <LoadError error={err} onRetry={refresh} what="the findings" />
        : <Banner kind="warn" icon="warn">Couldn't refresh: {isDown(err) ? "AMIRI Agent didn't answer" : errText(err)}. Showing what was loaded.</Banner>)}
      {status && status.findings_waiting > 0 && status.connected && (
        <Banner kind="info" icon="info" action={<InvestigateNowButton onDone={refresh} small />}>
          <b>{count(status.findings_waiting, "finding")} waiting</b> to be investigated{nextBatch ? `: the next batch goes ${nextBatch}` : ""}.
        </Banner>)}
      <div className="eos-filterbar" style={{ marginBottom: 0 }}>
        <SearchInput value={query} onChange={setQuery} ariaLabel="Search findings" placeholder="Search findings or sources…" count={shown} />
        <SelectMenu label="Filter by source" value={sourceFilter} onChange={setSourceFilter} options={[
          { value: "", label: "All sources" },
          { value: "monitor", label: "Monitor" },
          { value: "radar", label: "Radar" },
          { value: "timeseries", label: "Market Series" },
        ]} />
        <FlowFilter label="Which findings" value={show} onChange={setShow} all={{ key: "all", label: "All", count: n("all") }}
          steps={[{ key: "new", label: "Waiting", count: n("new"), state: "queued" }, { key: "grouped", label: "Being investigated", count: n("grouped"), state: "busy" },
            [{ key: "linked", label: "In an event", count: n("linked"), state: "done" }, { key: "set_aside", label: "No impact found", count: n("set_aside") }]]} />
      </div>

      {items === null ? (err == null && <ListSkeleton rows={5} />) : !shown ? (
        <Empty icon="search" title={show === "all" ? `Nothing found in the last ${DAYS} days` : "None in this step"}
          actions={show === "all" ? <Link className="btn" to="/monitors"><Icon name="monitor" />See your monitors</Link> : undefined}>
          {show === "all" ? "When a monitor, a market series or Radar notices something, it appears here." : "Choose another step above."}</Empty>
      ) : <div className="fd-groups">
        {pending.length > 0 && <section aria-labelledby="fd-p"><h2 id="fd-p">Still being looked at <span>{pending.length}</span></h2>
          <p className="fd-sub">The investigation picks these up{nextBatch ? ` in its next batch, ${nextBatch}` : " shortly"}.</p>{lines("pending", pending, pending.length)}</section>}
        {(show === "all" || show === "linked") && groups.map(([k, fs]) => { const e = events[k]; return <section key={k} aria-labelledby={`fd-${k}`}>
          <h2 id={`fd-${k}`}>
            {e ? <Link to={`/events/${k}`}>{eventTitle(e)}</Link> : "An event"}
            {e && <TonePill tone={e.tone} />}
            <span>{count(fs.length, "finding")}</span>
          </h2>
          <p className="fd-sub">The investigation linked these to this event{e?.status === "open" ? ", which is still open" : e?.status === "closed" ? ", now closed" : ""}. {k && <Link to={`/events/${k}`}>See the event</Link>}</p>
          {lines(k, fs)}</section>; })}
        {(show === "all" || show === "set_aside") && aside.length > 0 && <section className="quiet" aria-labelledby="fd-a">
          <h2 id="fd-a">No impact found <span>{aside.length}</span></h2>
          <p className="fd-sub">Looked at and set aside: nothing in them reaches your products.</p>
          {lines("aside", aside, show === "set_aside" ? aside.length : 0)}</section>}
      </div>}
    </div>
  );
}
