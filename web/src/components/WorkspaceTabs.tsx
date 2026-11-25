import { NavLink } from "react-router-dom";

export function SurveillanceTabs({ right }: { right?: React.ReactNode }) {
  return (
    <div className="eos-utabs-bar">
      <nav className="eos-utabs" aria-label="Surveillance engines">
        <NavLink to="/monitors" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>✦ Monitors</NavLink>
        <NavLink to="/radar" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>✦ World Radar</NavLink>
        <NavLink to="/series" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>Market Series</NavLink>
      </nav>
      {right && <div className="row" style={{ gap: 8, paddingBottom: 6 }}>{right}</div>}
    </div>
  );
}

export function EventsFindingsTabs({ right }: { right?: React.ReactNode }) {
  return (
    <div className="eos-utabs-bar">
      <nav className="eos-utabs" aria-label="Events and findings">
        <NavLink to="/events" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>Open Events</NavLink>
        <NavLink to="/findings" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>Findings Funnel</NavLink>
      </nav>
      {right && <div className="row" style={{ gap: 8, paddingBottom: 6 }}>{right}</div>}
    </div>
  );
}
