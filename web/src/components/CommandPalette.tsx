import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Overview } from "../api/overview";
import { eventTitle, undated } from "../plain";
import { price } from "../format";

interface CmdItem {
  id: string;
  label: string;
  sub?: string;
  cat: string;
  to: string;
}

const PAGES: CmdItem[] = [
  { id: "p-home", label: "Command (Overview)", cat: "PAGE", to: "/home" },
  { id: "p-alerts", label: "Alerts — Team Triage", cat: "PAGE", to: "/alerts" },
  { id: "p-events", label: "Events — Traced Impacts", cat: "PAGE", to: "/events" },
  { id: "p-findings", label: "Findings — Signal Funnel", cat: "PAGE", to: "/findings" },
  { id: "p-monitors", label: "Monitors — News Watchers", cat: "PAGE", to: "/monitors" },
  { id: "p-radar", label: "World Radar — News Scanner", cat: "PAGE", to: "/radar" },
  { id: "p-series", label: "Market Series — FX & Commodities", cat: "PAGE", to: "/series" },
  { id: "p-inst", label: "Institution Profile", cat: "PAGE", to: "/institution" },
  { id: "p-studio", label: "Scenario Studio — What-If Sandbox", cat: "PAGE", to: "/studio" },
  { id: "p-spec", label: "Metrics Spec v1.0.0", cat: "PAGE", to: "/spec" },
  { id: "p-data", label: "Data Connections (Admin)", cat: "ADMIN", to: "/admin/data" },
  { id: "p-settings", label: "Settings (Admin)", cat: "ADMIN", to: "/admin/settings" },
];

export function CommandPalette({ open, onClose, ov }: { open: boolean; onClose: () => void; ov: Overview | null }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHi(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const items = useMemo<CmdItem[]>(() => {
    const out: CmdItem[] = [];
    if (ov) {
      ov.events.forEach(e => out.push({
        id: `ev-${e.event_id}`,
        label: eventTitle(e),
        sub: `${e.effects} impacts · ${e.tone}`,
        cat: "EVENT",
        to: `/events/${e.event_id}`,
      }));
      ov.markets.forEach(m => out.push({
        id: `mk-${m.series_id}`,
        label: `${m.name}${m.close != null ? ` · ${price(m.close)}` : ""}`,
        sub: m.state === "moved" ? "Unusual move" : m.state,
        cat: "SERIES",
        to: `/series/${m.series_id}`,
      }));
      ov.radar.stories.forEach(r => out.push({
        id: `rd-${r.story_id}`,
        label: undated(r.title),
        sub: r.status === "sent" ? "Sent to investigate" : "Held back",
        cat: "RADAR",
        to: r.event_id ? `/events/${r.event_id}` : "/radar",
      }));
      ov.findings.slice(0, 6).forEach(f => out.push({
        id: `fd-${f.finding_id}`,
        label: undated(f.title),
        sub: f.source,
        cat: "FINDING",
        to: f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`,
      }));
    }
    return [...out, ...PAGES];
  }, [ov]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items.slice(0, 12);
    return items.filter(it =>
      it.label.toLowerCase().includes(s) ||
      (it.sub ?? "").toLowerCase().includes(s) ||
      it.cat.toLowerCase().includes(s),
    ).slice(0, 16);
  }, [items, q]);

  useEffect(() => { setHi(0); }, [q]);

  if (!open) return null;

  const pick = (it: CmdItem) => { onClose(); nav(it.to); };

  return (
    <div className="eos-cmd-overlay" role="dialog" aria-modal="true" aria-label="Search AMIRI Agent"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="eos-cmd-modal">
        <div className="eos-cmd-in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Jump to event, market series, Radar story, finding, or page…"
            onKeyDown={e => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setHi(i => Math.min(filtered.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi(i => Math.max(0, i - 1)); }
              else if (e.key === "Enter" && filtered[hi]) { e.preventDefault(); pick(filtered[hi]); }
            }} />
          <span className="eos-kbd">ESC</span>
        </div>
        <div className="eos-cmd-list">
          {filtered.length === 0
            ? <div style={{ padding: "18px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>No matching records</div>
            : filtered.map((it, idx) => (
              <button key={it.id} type="button" className="eos-cmd-item" data-hi={idx === hi}
                onMouseEnter={() => setHi(idx)} onClick={() => pick(it)}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.label}
                  {it.sub && <span style={{ color: "var(--ink-3)", marginLeft: 8, fontSize: 12 }}>{it.sub}</span>}
                </span>
                <span className="eos-cmd-cat">{it.cat}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
