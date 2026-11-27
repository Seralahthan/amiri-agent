import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "./components/Icon";
import { Empty, isDown, PageHead, PageSkeleton, useNow, useRole, type Role } from "./components/ui";
import { api, ME } from "./api/client";
import { barClock, setZone } from "./format";
import { cap } from "./plain";
import { OVERVIEW_EVENT, overviewApi, type Overview } from "./api/overview";
import { SystemStatus } from "./components/SystemStatus";
import { CommandPalette } from "./components/CommandPalette";
import { TelemetryStrip } from "./components/TelemetryStrip";
import "./styles/shell.css";
import "./styles/enterprise-os.css";
import { InstitutionPage, NewInstitutionPage } from "./pages/institution/InstitutionPage";
import { SetupWizard } from "./pages/institution/SetupWizard";
import { EventDetailPage } from "./pages/events/EventDetail";
import { EventsPage } from "./pages/events/Events";
import { MonitorPage } from "./pages/monitors/MonitorPage";
import { MonitorsPage } from "./pages/monitors/Monitors";
import { ScenarioPage, StudioPage } from "./pages/studio/Studio";
import { StudioRunPage } from "./pages/studio/StudioRun";
import { SeriesDetail } from "./pages/SeriesDetail";
import { SeriesList } from "./pages/SeriesList";
import { OverviewPage } from "./pages/Overview";
import { RadarPage } from "./pages/radar/Radar";
import { BotCheckPage, PausedPage } from "./pages/Login";
import { authApi, type AuthConfig } from "./api/auth";
import { AlertsPage } from "./pages/Alerts";
import { DataConnectionsPage } from "./pages/admin/DataConnections";
import { SettingsPage } from "./pages/admin/Settings";
import { FindingsPage } from "./pages/findings/Findings";
import { SpecPage } from "./pages/spec/Spec";
import { SpecPrintPage } from "./pages/spec/SpecPrint";
import { alertsApi, type AlertSummary } from "./api/alerts";

// Enterprise Risk OS V2.2 navigation: Risk Workspace, Governance, and Try it out
const GROUPS: [string, string[]][] = [
  ["Risk Workspace", ["/home", "/alerts", "/events", "/monitors"]],
  ["Governance", ["/institution", "/spec"]],
  ["Try it out", ["/studio"]],
];

const ADMIN_GROUPS: [string, string[]][] = [
  ["Platform Admin", ["/admin/data", "/institution", "/spec", "/admin/settings"]],
  ["Try it out", ["/studio"]],
];

const NAV: Record<Role, [string, string, string][]> = {
  risk_manager: [
    ["home", "Overview", "/home"],
    ["alert", "Alerts", "/alerts"],
    ["events", "Events & Findings", "/events"],
    ["radar", "Surveillance", "/monitors"],
    ["bank", "Institution", "/institution"],
    ["studio", "Scenario Studio", "/studio"],
    ["book", "Metrics Spec", "/spec"],
  ],
  platform_admin: [
    ["data", "Data Connections", "/admin/data"],
    ["bank", "Institution Profile", "/institution"],
    ["studio", "Scenario Studio", "/studio"],
    ["book", "Metrics Spec", "/spec"],
    ["settings", "Settings", "/admin/settings"],
  ],
};
export interface Installation {
  institution_id: string; profile: boolean; name: string | null; short_name?: string | null; home_country?: string;
  country_name?: string | null; base_currency?: string; time_zone: string; notes: string[];
  prototype_reset?: boolean;  // the server allows the prototype reset (PROTOTYPE_RESET)
  unreachable?: boolean;  // UI only: the server didn't answer, so whether a profile exists is unknown
}

// what this installation serves; reloaded when an institution is created (event "amiri:installation")
export const InstallationCtx = createContext<Installation | null>(null);
export const useInstallation = () => useContext(InstallationCtx);

/** Pages that need the institution say so before it exists, with the way to set it up (not a spinner or an error). */
function NeedsInstitution({ title, what, children }: { title: string; what: string; children: ReactNode }) {
  const inst = useInstallation();
  if (!inst || inst.profile || inst.unreachable) return <>{children}</>;  // unreachable: the page shows the load error
  return (
    <div className="page">
      <PageHead title={title} />
      <div className="card"><Empty icon="bank" title="Set up your institution first"
        actions={<Link className="btn btn--primary" to="/institution/setup">Set up the institution</Link>}>
        {what} come from your institution's profile: who you are, where you operate, your customers, products and
        risks. Set it up first; it takes a few minutes with the forms or the setup chat.
      </Empty></div>
    </div>
  );
}

const BUILT = new Set(["/home", "/events", "/radar", "/monitors", "/series", "/studio", "/alerts", "/institution", "/admin/data", "/admin/settings", "/spec", "/findings"]);

function useTheme() {
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("amiri.theme") || "light"; } catch { return "light"; } });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const dark = theme === "dark";
  const toggle = () => {
    const next = dark ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("amiri.theme", next); } catch { /* private mode */ }
  };
  return { dark, toggle };
}

const ROUTE_TITLES: [string, string][] = [
  ["/home", "Overview"],
  ["/alerts", "Alerts"],
  ["/events", "Events"],
  ["/findings", "Findings"],
  ["/monitors", "Monitors"],
  ["/radar", "Radar"],
  ["/series", "Market Series"],
  ["/institution", "Institution"],
  ["/studio", "Scenario Studio"],
  ["/spec", "Metrics Spec"],
  ["/admin/data", "Data Connections"],
  ["/admin/settings", "Settings"],
];

/** Each page's heading becomes the tab title; after a navigation focus moves to the page and a screen reader
 *  hears where it is (a single-page app does neither by itself). */
function useRouteA11y(): string {
  const { pathname, hash } = useLocation();
  const first = useRef(true);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const fallback = ROUTE_TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? "";
    if (fallback) document.title = `${fallback} · AMIRI Agent`;
    const name = () => {
      if (pathname === "/home") return "Overview";
      const h = document.querySelector("main h1")?.cloneNode(true) as HTMLElement | undefined;  // the heading without its badges
      h?.querySelectorAll(".badge").forEach(b => b.remove());
      const text = (h?.textContent ?? "").replace(/\s+/g, " ").trim();
      return text || fallback;
    };
    // a table wider than its box scrolls sideways: it must be reachable and named for keyboard users
    const scrollers = () => document.querySelectorAll<HTMLElement>(".tblwrap").forEach(el => {
      if (el.scrollWidth > el.clientWidth) { el.tabIndex = 0; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Table (scrolls sideways)"); }
    });
    const set = () => { const n = name(); document.title = n ? `${n} · AMIRI Agent` : "AMIRI Agent"; return n; };
    const t1 = setTimeout(() => {
      const n = set();
      if (first.current) { first.current = false; return; }
      setSaid(n);
      const m = document.querySelector<HTMLElement>("main");
      if (m) { if (!hash) m.scrollTop = 0; m.focus({ preventScroll: true }); }  // a #link: the page scrolls to it itself
    }, 250);
    const t2 = setTimeout(() => { set(); scrollers(); }, 1200);  // headings that wait for data (an event's or a monitor's name)
    const t3 = setTimeout(scrollers, 3500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [pathname]);
  return said;
}

function NotBuilt({ title }: { title: string }) {
  return (
    <div className="page">
      <PageHead title={title} />
      <div className="card"><Empty icon="info" title="This page isn't available" actions={<Link className="btn" to="/home">Go to the Overview</Link>}>
        It may have moved, or it isn't part of this version.
      </Empty></div>
    </div>
  );
}

export function App() {
  // first: has this browser passed the bot check? (no login; AUTH_MODE=off: no check at all)
  const [gate, setGate] = useState<{ cfg: AuthConfig; signedIn: boolean } | null>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    Promise.all([authApi.config(), authApi.me()])
      .then(([cfg, me]) => setGate({ cfg, signedIn: me.signed_in }))
      .catch(() => setGate({ cfg: { mode: "off", recaptcha_site_key: null }, signedIn: true }));
    const out = () => setGate(g => (g ? { ...g, signedIn: false } : g));
    const asleep = () => setGate(g => (g ? { ...g, cfg: { ...g.cfg, asleep: true } } : g));
    window.addEventListener("amiri:signed-out", out);
    window.addEventListener("amiri:asleep", asleep);
    return () => { window.removeEventListener("amiri:signed-out", out); window.removeEventListener("amiri:asleep", asleep); };
  }, []);
  if (!gate) return <PageSkeleton />;
  if (gate.cfg.asleep) return <PausedPage />;
  if (!gate.signedIn) return <BotCheckPage cfg={gate.cfg} />;
  if (pathname === "/spec/print") return <SpecPrintPage />;  // the PDF's layout: no menu, no institution needed
  return <Installed />;
}

const NAME_KEY = "amiri.institution-name";
const lastName = () => { try { return localStorage.getItem(NAME_KEY); } catch { return null; } };

function Installed() {
  const [inst, setInst] = useState<Installation | null>(null);
  useEffect(() => {
    const load = () => api<Installation>("/api/v1/installation")
      .then(i => { setZone(i.time_zone); setInst(i); try { if (i.name) localStorage.setItem(NAME_KEY, i.name); } catch { /* private mode */ } })
      // not "no profile yet": the pages show the server didn't answer, and the bar keeps the last known name
      .catch(() => setInst(x => x ?? { institution_id: "", profile: false, name: lastName(), time_zone: "UTC", notes: [], unreachable: true }));
    load();
    window.addEventListener("amiri:installation", load);  // an institution was created (forms or chat)
    return () => window.removeEventListener("amiri:installation", load);
  }, []);
  if (!inst) return <PageSkeleton />;
  return <InstallationCtx.Provider value={inst}><Frame inst={inst} /></InstallationCtx.Provider>;
}

function useProjectorScale() {
  const [projector, setProjector] = useState<boolean>(() => {
    try { return localStorage.getItem("amiri.scale") === "projector"; } catch { return false; }
  });
  useEffect(() => {
    if (projector) document.documentElement.dataset.scale = "projector";
    else delete document.documentElement.dataset.scale;
  }, [projector]);
  const toggle = () => {
    const next = !projector;
    setProjector(next);
    try { localStorage.setItem("amiri.scale", next ? "projector" : "standard"); } catch { /* private mode */ }
  };
  return { projector, toggle };
}

function Frame({ inst }: { inst: Installation }) {
  const { role, setRole } = useRole();
  const { dark, toggle: toggleTheme } = useTheme();
  const { projector, toggle: toggleProjector } = useProjectorScale();
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen(o => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const now = useNow(30_000);
  const nav = NAV[role].filter(([, , to]) => BUILT.has(to));  // a page that isn't built isn't offered
  const said = useRouteA11y();
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [menu]);
  useEffect(() => {  // an admin page is the Platform Admin's: show its menu, so the page is selected in it
    if (pathname.startsWith("/admin/") && role !== "platform_admin") setRole("platform_admin");
  }, [pathname]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [ov, setOv] = useState<Overview | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {  // the Live pill: the same one call the Overview makes, once a minute
    let last = 0;  // when it last asked, or an answer came in from the Overview page
    const got = (x: Overview) => { last = Date.now(); setOv(x); setDown(false); };
    const load = () => { last = Date.now(); overviewApi.get().catch(e => setDown(isDown(e))); };  // the answer comes back through the event
    // the Overview page already asks every minute: take its answer rather than ask a second time
    const heard = (e: Event) => got((e as CustomEvent<Overview>).detail);
    window.addEventListener(OVERVIEW_EVENT, heard);
    window.addEventListener("amiri:installation", load);  // "Try again" on a page checks again here too
    // ask only when nothing has come in for over a minute: on the Overview page its own minute's answer always has
    // (looking every 10 s, not every 60, so the two timers can't line up and both ask)
    const t = setInterval(() => { if (Date.now() - last > 65_000) load(); }, 10_000);
    load();
    return () => { clearInterval(t); window.removeEventListener("amiri:installation", load); window.removeEventListener(OVERVIEW_EVENT, heard); };
  }, []);
  const [alerts, setAlerts] = useState<AlertSummary | null>(null);
  useEffect(() => {  // the menu badge: alerts to review
    const load = () => alertsApi.summary().then(setAlerts).catch(() => {});
    load(); const t = setInterval(load, 60_000);
    window.addEventListener("amiri:alerts", load);
    return () => { clearInterval(t); window.removeEventListener("amiri:alerts", load); };
  }, []);
  return (
    <div className="app">
      <a className="skip" href="#main" onClick={e => { e.preventDefault(); document.querySelector<HTMLElement>("main")?.focus(); }}>Skip to the page</a>
      <div className="sr" role="status" aria-live="polite">{said}</div>
      <header className="appbar">
        <button className="btn btn--ghost btn--icon menubtn" type="button" aria-label="Menu" aria-expanded={menu} aria-controls="sidenav"
          onClick={() => setMenu(m => !m)}><Icon name={menu ? "x" : "menu"} /></button>
        <Link className="brand eos-mob-brand" to="/home" aria-label="AMIRI Agent home">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0F3D2E" /><path d="M9.2 25 15 7h2l5.8 18h-3.1L16 13.1 12.3 25z" fill="#F1F5EC" /><rect x="15.4" y="13.5" width="1.2" height="10" fill="#F05A28" /><rect x="14.2" y="16" width="3.6" height="5.2" fill="#F05A28" /></svg>
          <b>AMIRI Agent</b>
        </Link>
        <button type="button" className="eos-cmd-btn" onClick={() => setCmdOpen(true)} aria-label="Search AMIRI Agent">
          <Icon name="search" />
          <span>Search alerts, monitors, symbols…</span>
          <span className="eos-kbd">⌘K</span>
        </button>
        <TelemetryStrip ov={ov} now={now} down={down} />
        {(() => {
          const clk = barClock(now);
          return (
            <time
              className="eos-clock"
              dateTime={now.toISOString()}
              title={`Institution local time (${inst.time_zone})`}
              aria-label={`${clk.date}, ${clk.time} ${clk.zone}`}
            >
              <span className="eos-clock-date">{clk.date}</span>
              <span className="eos-clock-dot" aria-hidden="true">·</span>
              <span className="eos-clock-time">{clk.time}</span>
              <span className="eos-clock-zone">{clk.zone}</span>
            </time>
          );
        })()}
        <button className="btn btn--ghost btn--icon themebtn" type="button" aria-label={dark ? "Switch to light" : "Switch to dark"} onClick={toggleTheme}><Icon name={dark ? "sun" : "moon"} /></button>
      </header>
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} ov={ov} projector={projector} onToggleProjector={toggleProjector} />
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <div className="body">
        <aside className="side" id="sidenav" aria-label="Menu" data-open={menu}>
          <div className="eos-side-top">
            <Link className="eos-side-brand" to="/home" aria-label="AMIRI Agent home">
              <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0F3D2E" /><path d="M9.2 25 15 7h2l5.8 18h-3.1L16 13.1 12.3 25z" fill="#F1F5EC" /><rect x="15.4" y="13.5" width="1.2" height="10" fill="#F05A28" /><rect x="14.2" y="16" width="3.6" height="5.2" fill="#F05A28" /></svg>
              <span className="eos-side-brand-txt">
                <b>AMIRI Agent</b>
                <span className="eos-side-inst">{inst.name ?? (inst.unreachable ? "" : "No institution profile yet")}</span>
              </span>
            </Link>
            <SystemStatus o={ov} now={now} down={down} />
          </div>
          <nav className="nav" aria-label="Main">
            {(role === "risk_manager" ? GROUPS : ADMIN_GROUPS).map(([group, paths]) => {
              const items = nav.filter(n => paths.includes(n[2]));
              return items.length === 0 ? null : (
              <div key={group || "all"} className="navgroup">
                {group && <div className="grp label" id={`g-${group.replace(/\W+/g, "")}`}>{group}</div>}
            {items.map(([icon, label, to]) => {
              const active = to === "/monitors"
                ? pathname.startsWith("/monitors") || pathname.startsWith("/radar") || pathname.startsWith("/series")
                : to === "/events"
                  ? pathname.startsWith("/events") || pathname.startsWith("/findings")
                  : pathname === to || pathname.startsWith(`${to}/`);
              return (
              <Link key={to} to={to} className={active ? "eos-nav-active" : undefined} aria-current={active ? "page" : undefined}>
                <Icon name={icon} /><span>{label}</span>
                {to === "/alerts" && alerts?.to_review ? <span className={`count ${alerts.by_level.warning ? "hot" : ""}`}>{alerts.to_review}<span className="sr"> to review</span></span> : null}
              </Link>);
            })}
              </div>);
            })}
          </nav>
          <div className="eos-side-profile">
            <div className="eos-side-user" title={ME}>
              <span className="avatar" aria-hidden="true">{ME[0].toUpperCase()}</span>
              <span className="col" style={{ gap: 0, minWidth: 0 }}>
                <b>{cap(ME.split("@")[0])}</b>
                <span className="small muted">{role === "risk_manager" ? "Risk Manager" : "Platform Admin"}</span>
              </span>
            </div>
            <div className="eos-role-seg" role="group" aria-label="View as">
              <button type="button" aria-pressed={role === "risk_manager"} onClick={() => { setRole("risk_manager"); if (pathname.startsWith("/admin/")) navigate("/home"); }}>Risk Manager</button>
              <button type="button" aria-pressed={role === "platform_admin"} onClick={() => setRole("platform_admin")}>Platform Admin</button>
            </div>
          </div>
        </aside>
        <main className="main" id="main" tabIndex={-1}>
          {inst.notes.map(n => <div key={n} className="banner warn" style={{ margin: "16px 24px 0" }}><Icon name="warn" /><div>{n}</div></div>)}
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<OverviewPage />} />
            <Route path="/radar" element={<NeedsInstitution title="Radar" what="What Radar watches"><RadarPage /></NeedsInstitution>} />
            <Route path="/alerts" element={<NeedsInstitution title="Alerts" what="Alerts"><AlertsPage /></NeedsInstitution>} />
            <Route path="/findings" element={<NeedsInstitution title="Findings" what="Findings"><FindingsPage /></NeedsInstitution>} />
            <Route path="/events" element={<NeedsInstitution title="Events" what="Events"><EventsPage /></NeedsInstitution>} />
            <Route path="/events/:id" element={<NeedsInstitution title="Events" what="Events"><EventDetailPage /></NeedsInstitution>} />
            <Route path="/monitors" element={<NeedsInstitution title="Monitors" what="Monitors"><MonitorsPage /></NeedsInstitution>} />
            <Route path="/monitors/:id" element={<NeedsInstitution title="Monitors" what="Monitors"><MonitorPage /></NeedsInstitution>} />
            <Route path="/studio" element={<NeedsInstitution title="Scenario Studio" what="Scenarios"><StudioPage /></NeedsInstitution>} />
            <Route path="/studio/run/:id" element={<NeedsInstitution title="Scenario Studio" what="Scenarios"><StudioRunPage /></NeedsInstitution>} />
            <Route path="/studio/:id" element={<NeedsInstitution title="Scenario Studio" what="Scenarios"><ScenarioPage /></NeedsInstitution>} />
            <Route path="/series" element={<SeriesList />} />
            <Route path="/series/:id" element={<SeriesDetail />} />
            <Route path="/institution" element={<InstitutionPage />} />
            <Route path="/institution/new" element={<NewInstitutionPage />} />
            <Route path="/institution/setup" element={<SetupWizard />} />
            <Route path="/institution/setup/:step" element={<SetupWizard />} />
            <Route path="/institution/:tab" element={<InstitutionPage />} />
            <Route path="/admin/data" element={<DataConnectionsPage />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
            <Route path="/spec" element={<SpecPage />} />
            {[...NAV.risk_manager, ...NAV.platform_admin].filter(([, , to]) => !BUILT.has(to)).map(([, label, to]) => (
              <Route key={to} path={to} element={<NotBuilt title={label} />} />
            ))}
            <Route path="*" element={<NotBuilt title="Page not found" />} />
          </Routes>
        </main>
      </div>
      <nav className="eos-mobnav" aria-label="Quick navigation">
        <Link to="/home" aria-current={pathname === "/home" ? "page" : undefined}><Icon name="home" /><span>Home</span></Link>
        <Link to="/alerts" aria-current={pathname.startsWith("/alerts") ? "page" : undefined}>
          <span className="eos-mobnav-ico">
            <Icon name="alert" />
            {alerts?.to_review ? <span className={`eos-mobnav-badge${alerts.by_level.warning ? " hot" : ""}`}>{alerts.to_review > 99 ? "99+" : alerts.to_review}</span> : null}
          </span>
          <span>Alerts</span>
        </Link>
        <Link to="/events" aria-current={pathname.startsWith("/events") || pathname.startsWith("/findings") ? "page" : undefined}><Icon name="events" /><span>Events</span></Link>
        <Link to="/monitors" aria-current={pathname.startsWith("/monitors") || pathname.startsWith("/radar") || pathname.startsWith("/series") ? "page" : undefined}><Icon name="monitor" /><span>Watch</span></Link>
        <Link to="/institution" aria-current={pathname.startsWith("/institution") ? "page" : undefined}><Icon name="bank" /><span>Bank</span></Link>
      </nav>
    </div>
  );
}
