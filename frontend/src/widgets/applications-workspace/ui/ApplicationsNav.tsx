import { assets } from "@/shared/config";
import { notify, Icon } from "@/shared/ui";

export default function ApplicationsNav() {
  return (
    <aside className="applications-nav">
      <div className="delight-logo">
        <img src={assets.zoom.logo} alt="DelightTech" />
      </div>
      <nav>
        <span className="nav-label">General</span>
        <NavItem icon={assets.zoom.home} label="Dashboard" onClick={() => notify("Dashboard selected")} />
        <span className="nav-label">Main</span>
        <NavItem icon={assets.zoom.application} label="Application" active expanded />
        <div className="application-subnav">
          <button onClick={() => notify("Leads management selected")}>Leads management</button>
          <button className="active">Draft Application</button>
        </div>
        <NavItem
          icon={assets.zoom.verification}
          label="Verification (CA,CM)"
          expanded
          onClick={() => notify("Verification selected")}
        />
        <NavItem icon={assets.zoom.account} label="Account (AF)" expanded onClick={() => notify("Account selected")} />
        <NavItem icon={assets.zoom.collection} label="Collection (CO)" onClick={() => notify("Collection selected")} />
        <span className="nav-label spaced">Other</span>
        <NavItem icon={assets.zoom.blacklist} label="Blacklist" onClick={() => notify("Blacklist selected")} />
        <NavItem icon={assets.zoom.help} label="Help Center" onClick={() => notify("Help Center selected")} />
        <span className="nav-label spaced">Admin</span>
        <NavItem icon={assets.zoom.admin} label="Admin" expanded onClick={() => notify("Admin selected")} />
      </nav>
    </aside>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  expanded = false,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`applications-nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <Icon src={icon} alt="" />
      <span>{label}</span>
      {expanded && <Icon className="nav-chevron" src={assets.zoom.navChevron} alt="" />}
    </button>
  );
}
