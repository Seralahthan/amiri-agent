import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Overview } from "../api/overview";
import { monitorsApi, type MonitorsStatus } from "../api/monitors";
import { ago, when } from "../format";
import { eventTitle, undated } from "../plain";

interface TickerEntry {
  key: string;
  to: string;
  tag: string;
  tone?: "ok" | "crit" | "warn" | "info";
  text: string;
  meta?: string;
}

/** Live topbar news & operational wire: smoothly scrolls active surveillance pulse and newly captured events/findings beside the ⌘K search bar. */
export function TelemetryStrip({ ov, now, down }: { ov: Overview | null; now: Date; down: boolean }) {
  const [monSt, setMonSt] = useState<MonitorsStatus | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => monitorsApi.status().then(s => { if (live) setMonSt(s); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const entries = useMemo<TickerEntry[]>(() => {
    if (!ov || ov.first_run) return [];
    const list: TickerEntry[] = [];
    const moved = (ov.markets ?? []).filter(m => m.state === "moved");

    // 1. Live captured events (most urgent news first)
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

    // 2. Market anomaly if present
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

    // 3. Latest captured finding headlines
    (ov.findings ?? []).slice(0, 3).forEach(f => {
      list.push({
        key: `fd-${f.finding_id}`,
        to: f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`,
        tag: f.source === "radar" ? "RADAR" : f.source === "monitor" ? "MONITOR" : "SIGNAL",
        tone: "info",
        text: undated(f.title),
        meta: ago(f.created_at, now),
      });
    });

    // 4. Operational schedules
    list.push({
      key: "sched-mon",
      to: "/monitors",
      tag: "MONITORS",
      tone: "ok",
      text: `${ov.counts.monitors_live} live${ov.counts.monitors_waiting_approval > 0 ? ` · ${ov.counts.monitors_waiting_approval} approval` : ""}`,
      meta: monSt?.next_check_at ? `next ${when(monSt.next_check_at, now)}` : undefined,
    });
    list.push({
      key: "sched-rad",
      to: "/radar",
      tag: "RADAR",
      tone: "info",
      text: ov.radar.last_run_at ? `last scan ${ago(ov.radar.last_run_at, now)}` : "News scanner",
      meta: ov.radar.next_run_at ? `next ${when(ov.radar.next_run_at, now)}` : undefined,
    });

    return list;
  }, [ov, monSt, now]);

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
    <div className="eos-ticker" role="region" aria-label="Live risk and news feed">
      <Link to="/findings" className="eos-tick-badge" title="View all captured signals">
        <span className={`eos-agent-dot ${liveTone}`} aria-hidden="true" />
        <span>LIVE FEED</span>
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
