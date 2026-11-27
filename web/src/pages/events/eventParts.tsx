// The event page's parts: what it says worked out once, where the event has got to, a product's possible impacts as one
// line, what happened, what was set aside, the report. The page (EventDetail.tsx) puts them in order.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AlertItem } from "../../api/alerts";
import type { EventDetail, Hypothesis } from "../../api/investigation";
import { FactList, Fold, Places, TechnicalDetails, TonePill } from "../../components/blocks";
import { CheckPill } from "../../components/checks";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/markdown";
import { useRole } from "../../components/ui";
import { dayTime, person, placeName } from "../../format";
import {
  angleLabel, count, dateRange, earliest, eventTitle, impactText, listText, metricWords, onDay, productTypeLabel, relDay, SCREENING,
  sizeTiming, sourceInfo, splitCheckText, themeLabel, words, type VerdictKey,
} from "../../plain";

export const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** What narrows a possible impact, in words: "from Saudi Arabia", "three wheeler". */
const segText = (h: Hypothesis) => !h.segment ? "" : h.segment.dimension === "corridor" ? `from ${placeName(h.segment.value)}` : words(h.segment.value);
/** The run's report covers every event it found: this event's part only, when it has a heading of its own. */
export function reportFor(md: string | null, title: string): string | null {
  if (!md) return null;
  const hit = md.split(/\n(?=## )/).find(p => p.startsWith(`## ${title}\n`));
  return hit ? hit.replace(/^## .*\n+/, "") : md;
}
const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
const productOf = (h: Hypothesis) => h.product_name ?? h.product_id;
/** An alert's level and status as words after "has": "an early warning, waiting for review". */
const LEVEL_PHRASE: Record<string, string> = { warning: "an early warning", developing: "an alert showing early signs", adverse: "an alert confirmed by your data" };
const STATUS_PHRASE = (a: AlertItem) => a.status === "new" ? "waiting for review" : a.status === "acknowledged" ? (a.acknowledged_by ? `taken on by ${person(a.acknowledged_by)}` : "taken on") : "resolved";
export const alertPhrase = (a: AlertItem) => `${LEVEL_PHRASE[a.level] ?? "an alert"}, ${STATUS_PHRASE(a)}`;

/** Everything the page says, worked out once from the event and its alerts. */
export function derive(e: EventDetail, alerts: AlertItem[], alertsFailed = false) {
  const tasks = new Map(e.tasks.map(t => [t.hypothesis_id, t]));
  const effects = new Map(alerts.flatMap(a => a.effects).map(x => [x.hypothesis_id, x]));
  // the spec's metric name and whether the move is bad for you: from the alerts when they carry it, else from the task
  const metric = (h: Hypothesis) => effects.get(h.hypothesis_id)?.metric_name
    ?? (tasks.get(h.hypothesis_id)?.check ? splitCheckText(tasks.get(h.hypothesis_id)!.check!.what)[0] : metricWords(h.expected.metric));
  const adverse = (h: Hypothesis): boolean | null => {
    const t = tasks.get(h.hypothesis_id);
    if (t?.adverse_direction) return h.expected.direction === t.adverse_direction;
    if (effects.has(h.hypothesis_id)) return effects.get(h.hypothesis_id)!.adverse;
    return e.tone === "bad" ? true : e.tone === "good" ? false : null;
  };
  const hs = e.hypotheses;
  const nBad = hs.filter(h => adverse(h) === true).length, nGood = hs.filter(h => adverse(h) === false).length;
  const checks = hs.map(h => tasks.get(h.hypothesis_id)?.check).filter(c => !!c).map(c => ({ verdict: c!.verdict as VerdictKey, alert: c!.alert }));
  // teams in the order their alerts came, each with the impacts its alerts carry; impacts no alert carries go apart
  const teams = [...new Set(alerts.map(a => a.owner))].map(owner => {
    const as = alerts.filter(a => a.owner === owner), ids = new Set(as.flatMap(a => a.effects.map(x => x.hypothesis_id)));
    return { owner, alerts: as, hs: hs.filter(h => ids.has(h.hypothesis_id)) };
  });
  // checks agree when verdict and alert match and the impacts agree on bad-or-good; then the result is said once
  const advs = new Set(hs.map(adverse));
  const same = new Set(checks.map(c => `${c.verdict}|${c.alert}`)).size <= 1 && checks.length === hs.length && advs.size <= 1;
  const alerted = new Set(alerts.flatMap(a => a.effects.map(x => x.hypothesis_id)));
  const phrases = new Set(alerts.map(alertPhrase));
  return {
    e, alerts, alertsFailed, tasks, metric, adverse, nBad, nGood, checks, teams, free: hs.filter(h => !alerted.has(h.hypothesis_id)),
    tone: (nBad && nGood ? "mixed" : nBad ? "bad" : nGood ? "good" : "neutral") as "bad" | "good" | "mixed" | "neutral",
    checked: checks.filter(c => c.verdict !== "not_yet").length,
    same, sharedAdverse: advs.size === 1 ? adverse(hs[0]) : null,  // same: then no per-line result
    next: earliest(e.tasks.filter(t => !t.check?.final).map(t => t.next_check_after ?? t.check?.next_check_after)),
    products: [...new Set(hs.map(productOf))], toReview: alerts.filter(a => a.status === "new").length,
    onePhrase: phrases.size === 1 ? [...phrases][0] : null,  // said once above the teams when every alert shares it
    lead: e.findings[0], head: e.findings[0]?.evidence?.headlines?.[0],
    devs: [...e.developments].sort((a, b) => (a.joined_at < b.joined_at ? -1 : 1)),
    title: eventTitle(e), report: reportFor(e.run.report, e.title), allBad: hs.length > 1 && nBad === hs.length, validation: e.run.validation,
  };
}
export type D = ReturnType<typeof derive>;

/** Bad or good, said once for the event when every impact agrees. */
export const forYou = (d: D) => d.allBad ? (d.e.hypotheses.length === 2 ? "both bad for you" : "all bad for you")
  : d.nBad && d.nGood ? `${d.nBad} bad and ${d.nGood} good for you` : d.nBad ? "bad for you" : d.nGood ? "good for you" : "";

/** Framed collapsible Team Card matching Institution's tinted-header + emerald-rail grammar. */
export function TeamCard({ owner, eventId, count: n, status, waiting, noLink, children }: {
  owner: string; eventId?: string; count: number; status?: string; waiting?: boolean; noLink?: boolean; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const alertsTo = eventId ? `/alerts?event=${encodeURIComponent(eventId)}&team=${encodeURIComponent(owner)}` : "/alerts";
  return (
    <div className={`card eos-sec-card${collapsed ? " is-collapsed" : ""}`}>
      <div className="hd">
        <button type="button" className="eos-sec-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(c => !c)}>
          <span className={`eos-sec-chev-wrap${collapsed ? " is-closed" : ""}`} aria-hidden="true">
            <svg className={`eos-sec-chev${collapsed ? " is-closed" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 6.2 8 9.8l3.5-3.6" />
            </svg>
          </span>
          <h2 style={{ textTransform: "none", letterSpacing: "-0.01em", fontSize: 13.5 }}>{owner}</h2>
          <span className={`eos-sec-cnt${collapsed ? " is-closed" : ""}`}>{n}</span>
        </button>
        <span className="spacer" />
        {status && <span className={`evd-team-st${waiting ? " wait" : ""}`}>{status}</span>}
        {!noLink && <Link className="btn btn--sm btn--ghost" to={alertsTo}>Alerts →</Link>}
      </div>
      {!collapsed && <div className="evd-team-bd">{children}</div>}
    </div>
  );
}

/** Where the event has got to: 5-step framed Lifecycle Stepper. */
export function Progress({ d }: { d: D }) {
  const { e } = d, n = e.hypotheses.length;
  const s: { label: string; sub: ReactNode; st: "agent" | "wait" | "person" | "off" | "now" }[] = [
    { label: "Noticed", sub: onDay(e.anchor.slice(0, 10)), st: "agent" },
    { label: e.run.status === "running" ? "Investigating" : "Investigated", sub: e.run.status === "running" ? "In progress" : "Completed", st: e.run.status === "running" ? "now" : "agent" },
    { label: n ? count(n, "impact") : "No impact", sub: n ? count(d.products.length, "product") : "No product reach", st: "agent" },
    d.alertsFailed ? { label: "Alerts", sub: "Couldn't load", st: "off" }
      : d.teams.length ? { label: `${count(d.teams.length, "team")} alerted`, sub: d.toReview ? `${d.toReview} waiting review` : "All taken on", st: d.toReview ? "wait" : "person" }
      : { label: "No alerts", sub: "None sent", st: "off" },
    !d.validation ? { label: "Data checks", sub: "Switched off", st: "off" }
      : d.checked ? { label: `${d.checked} of ${n} checked`, sub: d.next ? `Next ${onDay(d.next)}` : "Complete", st: d.next ? "now" : "agent" }
      : { label: "Data checks", sub: d.next ? `${onDay(d.next)} (${relDay(d.next)})` : "With your data", st: "off" },
  ];
  return (
    <ol className="evd-stepper" aria-label="Where this event has got to">
      {s.map((x, i) => (
        <li key={i} className={`st-${x.st}`}>
          <span className="st-dot" aria-hidden="true">
            {x.st === "agent" || x.st === "person" ? "✓" : x.st === "wait" ? "!" : x.st === "now" ? "●" : "○"}
          </span>
          <div className="st-body">
            <span className="st-t">{x.label}</span>
            <span className="st-s">{x.sub}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Visual 3-Step Causal Flow: WHAT HAPPENED → THE EVENT → YOUR PRODUCTS & ALERTS. */
export function CausalChain({ d }: { d: D }) {
  const { e, lead, head } = d, n = e.hypotheses.length;
  const si = lead ? sourceInfo(lead.source) : null;
  const ref = lead?.source_ref ?? {};
  const triggerText = head?.title ?? lead?.title ?? "External signal detected";
  const shownProducts = d.products.slice(0, 2);
  const moreProducts = d.products.length - shownProducts.length;
  const checkNote = !d.validation ? "Checks off" : d.checked ? `${d.checked}/${n} checked` : "Waiting for data";

  return (
    <ol className="evd-chain" aria-label="Event causal chain">
      <li className="evd-chain-step">
        <div className="evd-chain-top">
          <span className="evd-chain-k">01 · What Happened</span>
          {si && <span className={`ev-lab src-${lead!.source}`}><Icon name={si.icon} />{si.label}</span>}
        </div>
        <strong className="evd-chain-v evd-chain-clamp" title={triggerText}>{triggerText}</strong>
        <div className="evd-chain-foot">
          <span className="evd-chain-m">{onDay(e.anchor.slice(0, 10))}{d.devs.length > 0 ? ` · +${d.devs.length} joined` : ""}</span>
          {(ref.monitor_id || ref.series_id) ? (
            <Link className="evd-chain-link" to={ref.monitor_id ? `/monitors/${ref.monitor_id}` : `/series/${ref.series_id}`}>
              {ref.monitor_id ? "Open monitor →" : "Open price series →"}
            </Link>
          ) : head?.url ? (
            <a className="evd-chain-link" href={head.url} target="_blank" rel="noreferrer">Source ↗</a>
          ) : null}
        </div>
      </li>

      <li className="evd-chain-arrow" aria-hidden="true">→</li>

      <li className="evd-chain-step">
        <div className="evd-chain-top">
          <span className="evd-chain-k">02 · The Event</span>
          {n > 0 && !(d.alertsFailed && d.tone === "neutral") && <TonePill tone={d.tone} />}
        </div>
        <strong className="evd-chain-v">{d.title}</strong>
        <div className="evd-chain-foot">
          <span className="evd-chain-m">
            {e.places.length > 0 ? <Places codes={e.places} max={2} /> : e.themes.map(themeLabel).join(" · ") || "Active event"}
            {e.status === "open" ? ` · Open until ${onDay(e.open_until.slice(0, 10))}` : " · Closed"}
          </span>
        </div>
      </li>

      <li className="evd-chain-arrow" aria-hidden="true">→</li>

      <li className={`evd-chain-step${d.toReview > 0 ? " is-wait" : ""}`}>
        <div className="evd-chain-top">
          <span className="evd-chain-k">03 · Your Products</span>
          {d.toReview > 0 ? (
            <span className="evd-team-st wait">{count(d.toReview, "alert")} waiting</span>
          ) : d.teams.length > 0 ? (
            <span className="evd-team-st">All taken on</span>
          ) : null}
        </div>
        <strong className="evd-chain-v">
          {n > 0 ? (
            <>
              {shownProducts.join(", ")}
              {moreProducts > 0 && <span className="muted" style={{ fontWeight: 500 }}> +{moreProducts} more</span>}
            </>
          ) : "No product reach"}
        </strong>
        <div className="evd-chain-foot">
          <span className="evd-chain-m">
            {d.alertsFailed ? "Alerts unavailable" : d.teams.length ? `${count(d.teams.length, "team")} alerted` : "No alerts"} · {checkNote}
          </span>
          {!d.alertsFailed && d.teams.length > 0 && (
            <Link className="evd-chain-link" to={`/alerts?event=${encodeURIComponent(e.event_id)}`}>View alerts →</Link>
          )}
        </div>
      </li>
    </ol>
  );
}

/** One possible impact opened: side-by-side AI Estimate vs. Verified Bank Data. */
function Detail({ d, h }: { d: D; h: Hypothesis }) {
  const { role } = useRole();
  const t = d.tasks.get(h.hypothesis_id), c = t?.check;
  const next = t?.next_check_after ?? c?.next_check_after;
  const rest = c ? splitCheckText(c.what)[1] : "";
  return <div className="evd-det">
    <div className="evd-det-split">
      <div className="evd-det-col">
        <div className="evd-det-hd">AMIRI Assessment · AI Estimate</div>
        <FactList items={[
          ["Why", `${h.chain_label}.`],
          ["What we watch", <>{d.metric(h)}{segText(h) ? <span className="muted"> · {segText(h)}</span> : null}{t?.watch ? <span className="muted"> · {dateRange(t.watch.from, t.watch.until)}</span> : null}</>],
        ]} />
      </div>
      <div className="evd-det-col evd-det-col--data">
        <div className="evd-det-hd">Your Bank Data · Verified by Code</div>
        <FactList items={[
          ["Status", !d.validation ? <span className="badge b-noeffect">Checks switched off · Expectations only</span>
            : c ? <span className="ck-sum"><CheckPill c={{ verdict: c.verdict as VerdictKey, alert: c.alert, adverse: d.adverse(h) }} />{rest && <span>{rest}</span>}</span>
            : t ? "Waiting for your figures" : "No automated check"],
          ["Next check", next && !c?.final ? <>{onDay(next)} <span className="muted">({relDay(next)})</span></> : null],
          ["Confidence", c && !c.final && c.verdict !== "not_yet" && c.verdict !== "error" ? "First look; may change as more data arrives" : null],
        ]} />
        {c && <Link className="evd-small" to={c.spec_link}>What this metric means →</Link>}
      </div>
    </div>
    {role === "platform_admin" && <TechnicalDetails><FactList items={[["Possible impact", <span className="mono">{h.hypothesis_id}</span>],
      ["Check", t ? <span className="mono">{t.task_id}</span> : null], ["Metric", <span className="mono">{h.expected.metric}</span>],
      ["Mechanism", <span className="mono">{h.mechanism_id}</span>], ["Watch", t?.watch ? `${t.watch.from} to ${t.watch.until}` : null],
      ["Scope", t?.scope_note ?? null], ["Tests", c?.checks.length ? c.checks.join("; ") : null], ["Revised", c?.supersedes ? `This ${c.supersedes.text}.` : null],
      ["Spec", c?.versions.spec ?? null], ["Catalog", c?.versions.catalog ?? null], ["Data", c?.versions.data ?? null], ["Validator", c?.versions.validator ?? null]]} /></TechnicalDetails>}
  </div>;
}

/** A product's possible impacts as one line: the same move from two angles is one line ("from Saudi Arabia and overall"),
 *  both angles in the detail. Bad or good only when the event's impacts differ; the result only when the checks differ. */
function ProductLine({ d, hs, showTeams }: { d: D; hs: Hypothesis[]; showTeams?: boolean }) {
  const move = impactText(d.metric(hs[0]), hs[0].expected.direction);
  const segs = hs.map(segText).filter(Boolean);
  // every angle of one move shares its bad-or-good; a result shows on the line only when the angles' checks agree
  const mixed = d.nBad > 0 && d.nGood > 0, bads = new Set(hs.map(d.adverse)), bad = bads.size === 1 ? d.adverse(hs[0]) : null;
  const cs = hs.map(h => d.tasks.get(h.hypothesis_id)?.check);
  const c = cs.every(x => x && x.verdict === cs[0]?.verdict && x.alert === cs[0]?.alert) && bads.size === 1 ? cs[0] : undefined;
  const owners = showTeams ? [...new Set(d.teams.filter(t => t.hs.some(th => hs.some(h => h.hypothesis_id === th.hypothesis_id))).map(t => t.owner))] : [];
  return <details className="evd-line">
    <summary><span className="evd-l1"><b>{productOf(hs[0])}</b>: {lower(move)}
      {segs.length > 0 && <span className="muted"> ({listText(hs.length > segs.length ? [...segs, "overall"] : segs)})</span>}
      {mixed && bad !== null && <span className={`evd-for ${bad ? "bad" : "good"}`}> · {bad ? "bad for you" : "good for you"}</span>}</span>
      {owners.length > 0 && (
        <span className="evd-owners" title={owners.join(", ")}>
          {owners.length === 1 ? owners[0] : `${owners[0]} +${owners.length - 1} more`}
        </span>
      )}
      {d.validation && !d.same && c && <CheckPill c={{ verdict: c.verdict as VerdictKey, alert: c.alert, adverse: bad }} />}
      <span className="evd-st">{sizeTiming(hs[0].expected.size, hs[0].expected.timing)}</span>
      <Icon name="chevron" className="evd-chev" /></summary>
    {hs.map(h => <Detail key={h.hypothesis_id} d={d} h={h} />)}
  </details>;
}
/** Count of deduplicated product-move lines (matches rendered ProductLines rows). */
export function productLineCount(d: D, hs: Hypothesis[]): number {
  return new Set(hs.map(h => `${productOf(h)}|${impactText(d.metric(h), h.expected.direction)}`)).size;
}

/** Impacts as lines, in the order they came: one per product and move, so two angles on one move share a line and two
 *  different moves on one product each get their own. */
export function ProductLines({ d, hs, showTeams }: { d: D; hs: Hypothesis[]; showTeams?: boolean }) {
  const key = (h: Hypothesis) => `${productOf(h)}|${impactText(d.metric(h), h.expected.direction)}`;
  return <>{[...new Set(hs.map(key))].map(k => <ProductLine key={k} d={d} hs={hs.filter(h => key(h) === k)} showTeams={showTeams} />)}</>;
}

/** Where it started, labelled; the reports that joined since in one line, the list on request. */
export function Story({ d }: { d: D }) {
  const [more, setMore] = useState(false);
  const { e, lead, head } = d;
  const si = lead ? sourceInfo(lead.source) : null, ref = lead?.source_ref ?? {};
  const last = d.devs[d.devs.length - 1];
  return <div className="evd-story">
    {lead && <p className="evd-src"><span>It started from</span>{si && <span className={`ev-lab src-${lead.source}`}><Icon name={si.icon} />{si.label}</span>}
      <span>{head?.url ? <a href={head.url} target="_blank" rel="noreferrer">{head.title ?? lead.title}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a> : head?.title ?? lead.title}
        <span className="muted"> · {[head?.outlet, onDay((head?.published_at ?? lead.created_at).slice(0, 10))].filter(Boolean).join(", ")}</span></span></p>}
    {lead?.explanation && <p>{firstSentence(lead.explanation)}</p>}
    {(ref.monitor_id || ref.series_id) && <Link className="ev-go" to={ref.monitor_id ? `/monitors/${ref.monitor_id}` : `/series/${ref.series_id}`}>
      {ref.monitor_id ? "Open the monitor" : "Open the price series"}<Icon name="arrow" /></Link>}
    {e.findings.length > 1 && <p>Also from {listText(e.findings.slice(1).map(f => `“${f.title}”`), 3)}.</p>}
    {(e.places.length > 0 || e.themes.length > 0) && <p className="evd-where">
      {e.places.length > 0 && <span className="ev-lab place"><Icon name="pin" /><Places codes={e.places} max={4} /></span>}
      <span className="muted">{e.themes.map(themeLabel).join(" · ")}</span></p>}
    {last && <div>
      <p><b>{count(d.devs.length, "more report")}</b> about the same thing joined it since, the latest {onDay(last.joined_at.slice(0, 10))}: “{last.title}”.</p>
      {more && <ol className="evd-devs">{d.devs.map(x => <li key={x.finding_id}><time dateTime={x.joined_at}>{dayTime(x.joined_at)}</time><span>{x.title}</span></li>)}</ol>}
      <button type="button" className="ev-more" aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon name="chevron" className={more ? "rot" : undefined} />{more ? "Show fewer" : `Show the ${d.devs.length}`}</button>
    </div>}
  </div>;
}

/** What the investigation weighed and set aside, a sentence each. */
export const SetAside = ({ d }: { d: D }) => <ul className="evd-aside">{d.e.set_aside.map((s, i) =>
  <li key={i}><b>{productTypeLabel(s.product_type)}</b>, {lower(angleLabel(s.angle))}: {lower(SCREENING[s.decision] ?? "no clear link")}. <span className="muted">{s.reason}</span></li>)}</ul>;

/** Clean raw internal tokens (chk:bab-el-mandeb, segment: remittance_linked) into readable English in the report. */
function humanizeReport(md: string): string {
  return md
    .replace(/\b(?:chk|sea|reg|corridor|flow|prod|mech):([a-z0-9_-]+)/gi, (_, slug: string) =>
      slug.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()))
    .replace(/\bsegment:\s*([a-z0-9_-]+)/gi, (_, slug: string) =>
      `segment: ${slug.replace(/[-_]+/g, " ")}`);
}

/** The investigation's report, folded inside our tinted eos-fold; this event's part of it. */
export const Report = ({ d }: { d: D }) => (
  <Fold
    summary={<>Full investigation report <span className="small muted" style={{ fontWeight: 500, marginLeft: "auto" }}>AMIRI Agent</span></>}
    bodyClassName="eos-fold-bd evd-rep"
  >
    {d.report ? <Markdown text={humanizeReport(d.report)} /> : <span className="muted">No report.</span>}
  </Fold>
);
