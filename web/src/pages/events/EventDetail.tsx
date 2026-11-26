// One event, read as an Executive Impact Dossier: blast-radius ledger + lifecycle stepper,
// collapsible framed Team Impact cards on the left, and What Happened + Audit rail on the right.
import { useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventDetail } from "../../api/investigation";
import { alertsApi, type AlertItem } from "../../api/alerts";
import { DeadlineBadge, FactList, HowItWorks, PageHeader, TechnicalDetails, TonePill } from "../../components/blocks";
import { CheckPill } from "../../components/checks";
import { Icon } from "../../components/Icon";
import { Empty, LoadError, PageSkeleton, useRole } from "../../components/ui";
import { dayTime } from "../../format";
import { count, longWhen, onDay } from "../../plain";
import { alertPhrase, derive, forYou, productLineCount, Progress, ProductLines, Report, SetAside, Story, TeamCard, type D } from "./eventParts";
import "../../styles/event-detail.css";

// keyed by the event id: moving to another event starts from loading, and the previous event's answers can't land on it
export function EventDetailPage() {
  const { id = "" } = useParams();
  return <EventLoader key={id} id={id} />;
}

function EventLoader({ id }: { id: string }) {
  const [e, setE] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [alertsFailed, setAlertsFailed] = useState(false);
  const load = () => investigationApi.event(id).then(x => { setE(x); setErr(null); }).catch(setErr);
  const asked = useRef(0);
  const loadAlerts = () => {
    const n = ++asked.current;
    alertsApi.list({ event_id: id }).then(x => { if (n === asked.current) { setAlerts(x); setAlertsFailed(false); } })
      .catch(() => { if (n === asked.current) { setAlerts([]); setAlertsFailed(true); } });
  };
  useEffect(() => { load(); loadAlerts(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  if (err instanceof ApiError && err.status === 404) return (
    <div className="eos-pad"><PageHeader title="Event not found" crumbs={<Link to="/events">Events</Link>} />
      <div className="card"><Empty icon="events" title="This event isn't here" actions={<Link className="btn" to="/events">See all events</Link>}>
        It may have been removed when the prototype was reset.</Empty></div></div>);
  if (!e || !alerts) return <div className="eos-pad">{err != null ? <><PageHeader title="Event" crumbs={<Link to="/events">Events</Link>} />
    <LoadError error={err} onRetry={load} what="this event" /></> : <PageSkeleton bare />}</div>;
  return <EventPage d={derive(e, alerts, alertsFailed)} retryAlerts={loadAlerts} />;
}

function EventPage({ d, retryAlerts }: { d: D; retryAlerts: () => void }) {
  const { role } = useRole();
  const [help, setHelp] = useState(false);
  const panel = useId();
  const { e } = d, n = e.hypotheses.length;
  const open = e.status === "open";
  const impactToneColor = d.tone === "bad" ? "var(--critical-ink)" : d.tone === "good" ? "var(--accent)" : d.tone === "mixed" ? "var(--high-ink)" : "var(--ink)";

  return (
    <div className="eos-pad evd">
      <header className="evd-head">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/events">Events</Link><span aria-hidden="true">/</span><span>{d.title}</span></nav>
        <div className="eos-hd">
          <div>
            <p className="evd-when">
              <time dateTime={e.anchor} title={longWhen(e.anchor)}>{dayTime(e.anchor)}</time>
              {n > 0 && !(d.alertsFailed && d.tone === "neutral") && <TonePill tone={d.tone} />}
              {e.world !== "live" && <span className="pill t-blue">Simulated</span>}
              {open ? <DeadlineBadge>Open until {onDay(e.open_until.slice(0, 10))}</DeadlineBadge> : <span className="small muted">Closed{e.closed_at ? ` ${onDay(e.closed_at.slice(0, 10))}` : ""}</span>}
              <button type="button" className="ph-help" aria-expanded={help} aria-controls={panel} onClick={() => setHelp(h => !h)}><Icon name="help" />How this works</button>
            </p>
            <h1>{d.title}</h1>
            <p className="sub">{n ? <><b>{count(n, "possible impact")}</b> on <b>{count(d.products.length, "product")}</b>{forYou(d) && `, ${forYou(d)}`}.{" "}
              {!d.alertsFailed && d.teams.length > 0 && <><b>{count(d.teams.length, "team")}</b> {d.teams.length === 1 ? "has" : "have"} an alert
                {d.toReview === d.alerts.length ? `; ${d.alerts.length === 1 ? "not" : "none"} taken on yet` : d.toReview ? `; ${d.toReview} still to review` : ", all taken on"}.</>}</>
              : <>Nothing in it reaches your products. {open ? "It closes on its own when the news stops." : ""}</>}</p>
          </div>
          {d.toReview > 0 && <Link className="btn btn--primary" to="/alerts"><Icon name="alert" />Review {count(d.toReview, "alert")}</Link>}
        </div>
        <div id={panel} className="ph-panel" hidden={!help}><HowItWorks><p>{open
          ? <>This event stays open until <b>{dayTime(e.open_until)}</b>: new news about the same thing joins it instead of starting a new one.</>
          : <>This event closed {e.closed_at ? dayTime(e.closed_at) : ""}: nothing new about it came in for a while.</>}</p></HowItWorks></div>
        {d.alertsFailed && <p className="evd-once evd-fail"><Icon name="warn" />The alerts for this event couldn't be loaded{n ? ", so the impacts aren't grouped by team" : ""}.
          <button type="button" className="evd-retry" onClick={retryAlerts}>Try again</button></p>}
        {e.world !== "live" && <p className="evd-sim"><Icon name="info" />Simulated: this event came from a test move, not real news. It stays out of the live picture.</p>}
      </header>

      <div className="eos-ledger" role="group" aria-label="Event blast radius">
        <div className="eos-ledger-cell">
          <span className="eos-l-step">01 · Possible Impacts</span>
          <span className="eos-l-val" style={{ color: impactToneColor }}>{n}</span>
          <span className="eos-l-meta">{forYou(d) ? forYou(d).replace(/^./, c => c.toUpperCase()) : "No product reach"}</span>
        </div>
        <div className="eos-ledger-cell">
          <span className="eos-l-step">02 · Products Touched</span>
          <span className="eos-l-val">{d.products.length}</span>
          <span className="eos-l-meta">{d.products.length ? d.products.slice(0, 2).join(", ") + (d.products.length > 2 ? ` +${d.products.length - 2}` : "") : "None affected"}</span>
        </div>
        <Link to="/alerts" className="eos-ledger-cell">
          <span className="eos-l-step">03 · Teams Alerted</span>
          <span className="eos-l-val" style={{ color: d.teams.length ? "var(--accent)" : "var(--ink-3)" }}>{d.teams.length}</span>
          <span className="eos-l-meta">{d.toReview ? `${d.toReview} waiting for review` : d.teams.length ? "All taken on" : "No alerts"}</span>
        </Link>
        <div className="eos-ledger-cell">
          <span className="eos-l-step">04 · Data Checks</span>
          <span className="eos-l-val" style={{ color: !d.validation ? "var(--ink-3)" : d.checked ? "var(--accent)" : "var(--ink)" }}>
            {!d.validation ? "Off" : d.checked ? `${d.checked}/${n}` : "Pending"}
          </span>
          <span className="eos-l-meta">{!d.validation ? "Expectations only" : d.next ? `Next ${onDay(d.next)}` : "Checked against data"}</span>
        </div>
      </div>

      <Progress d={d} />

      <div className="evd-grid">
        <section className="evd-main" aria-labelledby="evd-why">
          {n > 0 ? (
            <>
              <div className="evd-sec-bar">
                <h2 id="evd-why">Why it matters to you{d.alertsFailed ? "" : ", by team"} <span className="eos-sec-cnt">{n}</span></h2>
                <Link className="evd-all" to="/alerts">All alerts →</Link>
              </div>
              {d.onePhrase && <p className="evd-once">{d.teams.length === 1 ? "The team has" : "Each team has"} {d.onePhrase}.</p>}
              <div className="col" style={{ gap: 12 }}>
                {d.teams.map(t => (
                  <TeamCard
                    key={t.owner}
                    owner={t.owner}
                    count={productLineCount(d, t.hs)}
                    status={!d.onePhrase ? [...new Set(t.alerts.map(alertPhrase))].join("; ") : undefined}
                    waiting={t.alerts.some(a => a.status === "new")}
                  >
                    <ProductLines d={d} hs={t.hs} />
                  </TeamCard>
                ))}
                {d.free.length > 0 && (
                  <TeamCard owner={d.alertsFailed ? "All impacts" : "No team alerted"} count={productLineCount(d, d.free)} noLink>
                    <ProductLines d={d} hs={d.free} />
                  </TeamCard>
                )}
              </div>
              <p className="evd-sub">AMIRI Agent's assessment: expectations, not facts yet{d.validation ? "; each is checked against your own figures as they're published" : ""}.
                {d.validation && d.same && d.checked > 0 && <span className="evd-shared">Your data so far, for all of them: <CheckPill c={{ ...d.checks[0], adverse: d.sharedAdverse }} /></span>}</p>
            </>
          ) : (
            <div className="card eos-sec-card"><div className="bd small muted">Nothing in this event reaches your institution's products or customer groups.</div></div>
          )}
        </section>

        <aside className="evd-rail" aria-label="Originating signal and investigation details">
          <div className="eos-ai">
            <div className="eos-ai-hd"><span className="eos-spark" aria-hidden="true">✦</span>What happened · Originating signal</div>
            <Story d={d} />
          </div>

          {e.set_aside.length > 0 && (
            <details className="eos-fold">
              <summary>Considered, no impact <span className="eos-sec-cnt is-closed" style={{ marginLeft: "auto" }}>{e.set_aside.length}</span></summary>
              <div className="eos-fold-bd"><SetAside d={d} /></div>
            </details>
          )}

          <Report d={d} />

          {role === "platform_admin" && (
            <TechnicalDetails><FactList items={[["Event", <span className="mono">{e.event_id}</span>],
              ["Investigation", <span className="mono">{e.run.run_id}</span>],
              ["Findings", <span className="mono">{e.findings.map(f => `${f.finding_id} (score ${f.score})`).join(", ")}</span>],
              ["Places", <span className="mono">{e.places.join(", ")}</span>], ["Open until", dayTime(e.open_until)]]} /></TechnicalDetails>
          )}
        </aside>
      </div>
    </div>
  );
}
