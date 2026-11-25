// Compact AMIRI Agent status pill in the left sidebar, right below the brand header. Clicking expands per-agent diagnostics.
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Overview } from "../api/overview";
import { ago } from "../format";
import "../styles/system-status.css";

/** Compact sidebar Agent Status pill placed right under the AMIRI Agent brand header. Clicking expands per-agent diagnostics. */
export function SystemStatus({ o, now, down = false }: { o: Overview | null; now: Date; down?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!o || o.first_run || !o.services) return null;
  const s = o.services;
  const agents = [["Investigation", s.investigation.connected], ["Monitors", s.monitor.connected], ["Setup agent", s.assistant.connected], ["Radar", s.radar.connected]] as const;
  const up = agents.filter(([, u]) => u).length;
  const liveOk = !down && s.tick.ok;
  const allUp = liveOk && up === agents.length;
  const label = down ? "Offline" : allUp ? "Live" : liveOk ? "Live" : "Paused";
  const when = s.tick.last_at ? ago(s.tick.last_at, now) : null;
  const sub = down ? "no answer from server" : !when ? "updates not run yet" : `updates ran ${when}`;
  const dotClass = down ? "off" : allUp ? "live" : liveOk ? "live" : "warn";
  return (
    <div className="eos-agent-wrap">
      <button type="button" className="eos-agent-pill" aria-expanded={open} aria-controls="sbs-detail" onClick={() => setOpen(x => !x)}
        aria-label={`AMIRI Agent status: ${label}, ${sub}. Show agent details.`}>
        <span className={`eos-agent-dot ${dotClass}`} aria-hidden="true" />
        <strong className="eos-agent-lbl">{label}</strong>
        <span className="eos-agent-sub">{sub}</span>
      </button>
      <span className="sr" role="status">{`AMIRI Agent: ${label}`}</span>
      {open && <ul className="eos-agent-pop" id="sbs-detail">
        <li><span className={`statusdot ${s.tick.ok ? "sd-ok" : "sd-down"}`} aria-hidden="true" />Updates: {when ? `${s.tick.ok ? "ran" : "late ·"} ${when}` : "not run yet"}</li>
        {agents.map(([n, u]) => <li key={n}><span className={`statusdot ${u ? "sd-ok" : "sd-off"}`} aria-hidden="true" />{n}: {u ? "working" : "not connected"}</li>)}
        {o.studio && <li><span className="statusdot sd-warn" aria-hidden="true" /><Link to={`/studio/run/${o.studio.sim_id}`}>Studio: {o.studio.title}, day {o.studio.step}/{o.studio.steps}</Link></li>}
      </ul>}
    </div>
  );
}
