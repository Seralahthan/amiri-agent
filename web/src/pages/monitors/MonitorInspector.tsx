import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { monitorsApi, type Monitor, type MonitorFinding, type MonitorRow } from "../../api/monitors";
import { Icon } from "../../components/Icon";
import { InlineSkeleton, useNow, useToast } from "../../components/ui";
import { ago, dayTime } from "../../format";
import { everyText, undated } from "../../plain";
import { MonitorActions, StatusBadge } from "./Monitors";

export function MonitorInspector({ row, findings, onChange }: { row: MonitorRow; findings?: MonitorFinding[]; onChange: () => void }) {
  const now = useNow(30_000);
  const toast = useToast();
  const [full, setFull] = useState<Monitor | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setFull(null);
    monitorsApi.get(row.monitor_id).then(m => { if (live) setFull(m); }).catch(() => {});
    return () => { live = false; };
  }, [row.monitor_id, row.updated_at]);

  const runNow = async () => {
    setBusy(true);
    try { await monitorsApi.runNow(row.monitor_id); toast("Checking now: result shows here in a minute or two."); onChange(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };

  const spec = full?.live_spec ?? full?.spec;
  const pub = spec?.public;
  const priv = spec?.private;
  const ex = pub?.example_headlines;

  return (
    <div className="eos-insp" aria-label={`Details for ${row.name}`}>
      <div className="row wrap" style={{ gap: 10 }}>
        <StatusBadge status={row.status} />
        <span className="small muted">
          v{row.live_version ?? row.latest_version} · Owner <b>{row.owner}</b> · {everyText(row.check_frequency)}
          {spec?.about.review_by ? ` · review by ${spec.about.review_by}` : ""}
        </span>
        <span className="spacer" />
        {row.status === "live" && (
          <button type="button" className="btn btn--sm" disabled={busy} onClick={runNow}>
            <Icon name="play" />{busy ? "Checking…" : "Run a check now"}
          </button>
        )}
        <Link className="btn btn--sm btn--ghost" to={`/monitors/${row.monitor_id}`}>Edit / Full page →</Link>
      </div>

      <div>
        <h2 style={{ fontSize: 22, letterSpacing: "-0.02em" }}>{row.name}</h2>
        <p style={{ marginTop: 6, color: "var(--ink-2)" }}>{pub?.in_one_sentence ?? row.sentence}</p>
      </div>

      <MonitorActions m={row} onChange={onChange} compact />

      {!full ? <InlineSkeleton /> : <>
        {pub && (
          <div className="eos-spec2">
            <div>
              <span className="label">Tell me if</span>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: "var(--fs-sm)", color: "var(--ink)" }}>
                {pub.tell_me_if.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>
            <div className="col" style={{ gap: 12 }}>
              {pub.watch.length > 0 && (
                <div>
                  <span className="label">Watch ({pub.watch.length})</span>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    {pub.watch.map((w, i) => (
                      <span key={i} className="eos-echip">{w.name} <span>· {w.type}</span></span>
                    ))}
                  </div>
                </div>
              )}
              {pub.ignore && pub.ignore.length > 0 && (
                <div>
                  <span className="label">Ignore</span>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    {pub.ignore.map((ig, i) => <span key={i} className="chip">{ig}</span>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {priv?.exposure && priv.exposure.length > 0 && (
          <div className="eos-ai">
            <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>How it reaches us · Private to your institution</div>
            <div className="eos-ai-bd">
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {priv.exposure.map((x, i) => (
                  <li key={i}><b>{x.id}</b>{x.how_it_reaches_us ? `: ${x.how_it_reaches_us}` : ""}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div>
          {ex && (ex.match.length > 0 || ex.not_match.length > 0) && (
            <details className="eos-fold" open>
              <summary>Example headlines · {ex.match.length} match, {ex.not_match.length} don't</summary>
              <div className="eos-fold-bd col" style={{ gap: 6 }}>
                {ex.match.map((m, i) => <div key={`m-${i}`}><span className="badge b-ok" style={{ marginRight: 6 }}>Match</span>{m.headline}</div>)}
                {ex.not_match.map((n, i) => <div key={`n-${i}`}><span className="badge b-noeffect" style={{ marginRight: 6 }}>Ignore</span><span className="muted">{n}</span></div>)}
              </div>
            </details>
          )}

          <details className="eos-fold">
            <summary>Recent findings ({findings?.length ?? row.findings_30d} in 30d) {row.last_check ? `· checked ${ago(row.last_check.at, now)}` : ""}</summary>
            <div className="eos-fold-bd col" style={{ gap: 6 }}>
              {findings && findings.length > 0 ? findings.slice(0, 5).map(f => {
                const h = f.evidence?.headlines?.[0];
                return <div key={f.finding_id}>
                  {h?.url ? <a href={h.url} target="_blank" rel="noreferrer">{undated(h.title)}</a> : undated(f.title)}
                  <span className="muted"> · {dayTime(f.created_at)}</span>
                </div>;
              }) : <span className="muted">No recent findings in the last 30 days.</span>}
            </div>
          </details>

          <details className="eos-fold">
            <summary>Versions · {full.versions.length}</summary>
            <div className="eos-fold-bd col" style={{ gap: 4 }}>
              {full.versions.map(v => (
                <div key={v.version}>
                  <b>v{v.version}</b> · {v.status}{v.approved_by ? ` · approved by ${v.approved_by}` : ""}{v.note ? ` — “${v.note}”` : ""}
                </div>
              ))}
            </div>
          </details>
        </div>
      </>}
    </div>
  );
}
