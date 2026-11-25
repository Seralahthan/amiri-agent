import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Overview } from "../api/overview";
import { monitorsApi, type MonitorsStatus } from "../api/monitors";
import { ago, when } from "../format";

/** Always-visible operational pulse strip: surfaces live agent tick, Monitors next check, Radar last/next run, and Market anomalies at first glance. */
export function TelemetryStrip({ ov, now, down }: { ov: Overview | null; now: Date; down: boolean }) {
  const [monSt, setMonSt] = useState<MonitorsStatus | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => monitorsApi.status().then(s => { if (live) setMonSt(s); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  if (!ov || ov.first_run) return null;

  const tick = ov.services?.tick;
  const moved = (ov.markets ?? []).filter(m => m.state === "moved");
  const stale = (ov.markets ?? []).filter(m => m.state === "stale");
  const dotTone = down || !tick?.ok ? "off" : stale.length || moved.length ? "warn" : "";

  return (
    <div className="eos-telemetry" role="region" aria-label="Live operational schedules">
      <Link className="eos-tel-item" to="/home">
        <span className={`eos-dot ${dotTone}`} aria-hidden="true" />
        <b>{down ? "No answer" : tick?.ok ? "Agents Live" : "Paused"}</b>
        {tick?.last_at && <span>· tick {ago(tick.last_at, now)}</span>}
      </Link>
      <span className="eos-tel-div" aria-hidden="true" />
      <Link className="eos-tel-item" to="/monitors">
        <b>✦ Monitors ({ov.counts.monitors_live} live)</b>
        {monSt?.next_check_at && <span>· next <span className="mono">{when(monSt.next_check_at, now)}</span></span>}
        {ov.counts.monitors_waiting_approval > 0 && (
          <span style={{ color: "var(--info-ink)", fontWeight: 600 }}>· {ov.counts.monitors_waiting_approval} approval</span>
        )}
      </Link>
      <span className="eos-tel-div" aria-hidden="true" />
      <Link className="eos-tel-item" to="/radar">
        <b>✦ Radar</b>
        {ov.radar.last_run_at && <span>· last <span className="mono">{ago(ov.radar.last_run_at, now)}</span></span>}
        {ov.radar.next_run_at && <span>· next <span className="mono">{when(ov.radar.next_run_at, now)}</span></span>}
      </Link>
      <span className="eos-tel-div" aria-hidden="true" />
      <Link className="eos-tel-item" to="/series">
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
