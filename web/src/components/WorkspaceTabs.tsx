import { NavLink } from "react-router-dom";
import { Icon } from "./Icon";

export function SurveillanceTabs({ right }: { right?: React.ReactNode }) {
  return (
    <div className="eos-utabs-bar">
      <nav className="eos-utabs" aria-label="Surveillance engines">
        <NavLink to="/monitors" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>
          <Icon name="monitor" /><span>Monitors</span>
        </NavLink>
        <NavLink to="/radar" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>
          <Icon name="radar" /><span>World Radar</span>
        </NavLink>
        <NavLink to="/series" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>
          <Icon name="series" /><span>Market Series</span>
        </NavLink>
      </nav>
      {right && <div className="row" style={{ gap: 8, paddingBottom: 6 }}>{right}</div>}
    </div>
  );
}

export function EventsFindingsTabs({ right }: { right?: React.ReactNode }) {
  return (
    <div className="eos-utabs-bar">
      <nav className="eos-utabs" aria-label="Events and findings">
        <NavLink to="/events" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>
          <Icon name="events" /><span>Open Events</span>
        </NavLink>
        <NavLink to="/findings" className={({ isActive }) => `eos-utab${isActive ? " active" : ""}`}>
          <Icon name="news" /><span>Findings Funnel</span>
        </NavLink>
      </nav>
      {right && <div className="row" style={{ gap: 8, paddingBottom: 6 }}>{right}</div>}
    </div>
  );
}
