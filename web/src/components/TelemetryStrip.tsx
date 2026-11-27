import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Overview } from "../api/overview";
import { monitorsApi, type MonitorsStatus } from "../api/monitors";
import { Icon } from "./Icon";
import { ago, when } from "../format";
import { eventTitle, undated } from "../plain";

/** Compact market label for the narrow topbar (e.g. "US dollar to UAE dirham" -> "USD/AED", "Gold" -> "Gold"). */
function shortMarketLabel(m: { series_id: string; name: string }): string {
  if (m.name.length <= 12) return m.name;
  if (/^[a-z]{3}_[a-z]{3}$/i.test(m.series_id)) return m.series_id.toUpperCase().replace("_", "/");
  return `${m.name.slice(0, 12).trim()}…`;
}

/** Stationary topbar operational schedule strip: lets Risk Managers & Platform Admins see last/next runs at one glance beside ⌘K search. */
export function TelemetryStrip({ ov, now }: { ov: Overview | null; now: Date; down?: boolean }) {
  const [monSt, setMonSt] = useState<MonitorsStatus | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => monitorsApi.status().then(s => { if (live) setMonSt(s); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  if (!ov) return <div className="eos-sched eos-sched--placeholder" aria-hidden="true" />;
  if (ov.first_run) return null;

  const moved = (ov.markets ?? []).filter(m => m.state === "moved");
  const stale = (ov.markets ?? []).filter(m => m.state === "stale");

  return (
    <div className="eos-sched" role="region" aria-label="Operational schedules">
      <Link className="eos-sched-item" to="/monitors">
        <Icon name="monitor" />
        <b>Monitors ({ov.counts.monitors_live})</b>
        {monSt?.next_check_at && <span className="eos-sched-sub">· next <span className="mono">{when(monSt.next_check_at, now)}</span></span>}
        {ov.counts.monitors_waiting_approval > 0 && (
          <span style={{ color: "var(--info-ink)", fontWeight: 600 }}>· {ov.counts.monitors_waiting_approval} approval</span>
        )}
      </Link>
      <span className="eos-sched-div" aria-hidden="true" />
      <Link className="eos-sched-item" to="/radar">
        <Icon name="radar" />
        <b>Radar</b>
        {ov.radar.last_run_at && <span className="eos-sched-sub eos-sched-last">· last <span className="mono">{ago(ov.radar.last_run_at, now)}</span></span>}
        {ov.radar.next_run_at && <span className="eos-sched-sub">· next <span className="mono">{when(ov.radar.next_run_at, now)}</span></span>}
      </Link>
      <span className="eos-sched-div" aria-hidden="true" />
      <Link className="eos-sched-item" to="/series" title={moved.length > 0 ? moved.map(m => `${m.name} unusual`).join(", ") : undefined}>
        <Icon name="series" />
        <b>Series ({ov.counts.series_watched})</b>
        {moved.length > 0 && (
          <span style={{ color: "var(--high-ink)", fontWeight: 600 }}>
            · ◆ {shortMarketLabel(moved[0])}{moved.length > 1 ? ` +${moved.length - 1}` : ""} unusual
          </span>
        )}
        {moved.length === 0 && stale.length > 0 && (
          <span style={{ color: "var(--high-ink)" }}>· {stale.length} late</span>
        )}
      </Link>
    </div>
  );
}

interface TickerEntry {
  key: string;
  to: string;
  tag: string;
  tone?: "ok" | "crit" | "warn" | "info";
  text: string;
  meta?: string;
}

/** Option A: Live Signal Wire placed directly below the 4-metric ledger on Command Overview. Cycles through captured events, market anomalies, and findings in wrap-around batches without clipping, pausing on hover/focus. */
export function LiveWire({ ov, now, down = false }: { ov: Overview | null; now: Date; down?: boolean }) {
  const entries = useMemo<TickerEntry[]>(() => {
    if (!ov || ov.first_run) return [];
    const list: TickerEntry[] = [];
    const moved = (ov.markets ?? []).filter(m => m.state === "moved");

    (ov.events ?? []).slice(0, 3).forEach(ev => {
      list.push({
        key: `ev-${ev.event_id}`,
        to: `/events/${ev.event_id}`,
        tag: ev.tone === "bad" ? "ADVERSE" : ev.tone === "good" ? "POSITIVE" : "EVENT",
        tone: ev.tone === "bad" ? "crit" : ev.tone === "good" ? "ok" : "info",
        text: eventTitle(ev),
        meta: ev.effects ? `${ev.effects} ${ev.effects === 1 ? "line" : "lines"}` : undefined,
      });
    });

    if (moved.length > 0) {
      list.push({
        key: `mk-${moved[0].series_id}`,
        to: `/series/${moved[0].series_id}`,
        tag: "MARKET",
        tone: "warn",
        text: `${moved[0].name} unusual move`,
        meta: `${ov.counts.series_watched} watched`,
      });
    }

    (ov.findings ?? []).slice(0, 4).forEach(f => {
      list.push({
        key: `fd-${f.finding_id}`,
        to: f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`,
        tag: f.source === "radar" ? "RADAR" : f.source === "monitor" ? "MONITOR" : "SIGNAL",
        tone: "info",
        text: undated(f.title),
        meta: ago(f.created_at, now),
      });
    });

    return list;
  }, [ov, now]);

  const [slots, setSlots] = useState(() => (typeof window === "undefined" ? 3 : window.innerWidth <= 680 ? 1 : window.innerWidth <= 1120 ? 2 : 3));
  const [offset, setOffset] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const update = () => setSlots(window.innerWidth <= 680 ? 1 : window.innerWidth <= 1120 ? 2 : 3);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const total = entries.length;
  const canFlip = total > slots;

  useEffect(() => {
    if (!canFlip || paused) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setOffset(o => (o + slots) % total), 6000);
    return () => window.clearInterval(t);
  }, [canFlip, paused, slots, total]);

  if (!ov || ov.first_run || total === 0) return null;
  const tick = ov.services?.tick;
  const liveTone = down || !tick?.ok ? "warn" : "live";

  const count = Math.min(slots, total);
  const shown = Array.from({ length: count }, (_, i) => entries[(offset + i) % total]);
  const step = (dir: -1 | 1) => setOffset(o => ((o + dir * slots) % total + total) % total);
  const startIdx = (offset % total) + 1;
  const endIdx = ((offset + count - 1) % total) + 1;

  return (
    <div
      className="eos-ticker eos-wire"
      role="region"
      aria-label="Live captured risk and news feed"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Link to="/findings" className="eos-tick-badge" title="View all captured findings">
        <span className={`eos-agent-dot ${liveTone}`} aria-hidden="true" />
        <span>LIVE WIRE</span>
      </Link>
      <div className="eos-tick-strip" key={offset}>
        {shown.map(item => (
          <Link key={item.key} className="eos-tick-item" to={item.to} title={item.text}>
            <span className={`eos-tick-tag ${item.tone ?? "info"}`}>{item.tag}</span>
            <span className="eos-tick-txt">{item.text}</span>
            {item.meta && <span className="eos-tick-meta">· {item.meta}</span>}
          </Link>
        ))}
      </div>
      {canFlip && (
        <div className="eos-tick-pager">
          <span className="eos-tick-pos" aria-live="polite">{count === 1 ? `${startIdx}/${total}` : `${startIdx}–${endIdx}/${total}`}</span>
          <button type="button" className="eos-tick-nav" aria-label="Previous signals" onClick={() => step(-1)}>‹</button>
          <button type="button" className="eos-tick-nav" aria-label="Next signals" onClick={() => step(1)}>›</button>
        </div>
      )}
    </div>
  );
}
