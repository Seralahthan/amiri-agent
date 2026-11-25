import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Overview } from "../api/overview";
import { monitorsApi, type MonitorsStatus } from "../api/monitors";
import { Icon } from "./Icon";
import { ago, when } from "../format";
import { eventTitle, undated } from "../plain";

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

  if (!ov || ov.first_run) return null;

  const moved = (ov.markets ?? []).filter(m => m.state === "moved");
  const stale = (ov.markets ?? []).filter(m => m.state === "stale");

  return (
    <div className="eos-sched" role="region" aria-label="Operational schedules">
      <Link className="eos-sched-item" to="/monitors">
        <Icon name="monitor" />
        <b>Monitors ({ov.counts.monitors_live} live)</b>
        {monSt?.next_check_at && <span>· next <span className="mono">{when(monSt.next_check_at, now)}</span></span>}
        {ov.counts.monitors_waiting_approval > 0 && (
          <span style={{ color: "var(--info-ink)", fontWeight: 600 }}>· {ov.counts.monitors_waiting_approval} approval</span>
        )}
      </Link>
      <span className="eos-sched-div" aria-hidden="true" />
      <Link className="eos-sched-item" to="/radar">
        <Icon name="radar" />
        <b>Radar</b>
        {ov.radar.last_run_at && <span>· last <span className="mono">{ago(ov.radar.last_run_at, now)}</span></span>}
        {ov.radar.next_run_at && <span>· next <span className="mono">{when(ov.radar.next_run_at, now)}</span></span>}
      </Link>
      <span className="eos-sched-div" aria-hidden="true" />
      <Link className="eos-sched-item" to="/series">
        <Icon name="series" />
        <b>Market Series ({ov.counts.series_watched})</b>
        {moved.length > 0 && (
          <span style={{ color: "var(--high-ink)", fontWeight: 600 }}>· ◆ {moved[0].name} unusual</span>
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

/** Option A: Live Signal Wire placed directly below the 4-metric ledger on Command Overview. Streams real captured events, market anomalies, and findings, pausing smoothly on hover. */
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

  if (!ov || ov.first_run || entries.length === 0) return null;
  const tick = ov.services?.tick;
  const liveTone = down || !tick?.ok ? "warn" : "live";

  const renderTrack = (dup: boolean) => entries.map(item => (
    <Link key={`${dup ? "b" : "a"}-${item.key}`} className="eos-tick-item" to={item.to} tabIndex={dup ? -1 : 0}>
      <span className={`eos-tick-tag ${item.tone ?? "info"}`}>{item.tag}</span>
      <span className="eos-tick-txt">{item.text}</span>
      {item.meta && <span className="eos-tick-meta">· {item.meta}</span>}
    </Link>
  ));

  return (
    <div className="eos-ticker eos-wire" role="region" aria-label="Live captured risk and news feed">
      <Link to="/findings" className="eos-tick-badge" title="View all captured findings">
        <span className={`eos-agent-dot ${liveTone}`} aria-hidden="true" />
        <span>LIVE WIRE</span>
      </Link>
      <div className="eos-tick-viewport">
        <div className="eos-tick-track">
          <div className="eos-tick-group">{renderTrack(false)}</div>
          <div className="eos-tick-group" aria-hidden="true">{renderTrack(true)}</div>
        </div>
      </div>
    </div>
  );
}
