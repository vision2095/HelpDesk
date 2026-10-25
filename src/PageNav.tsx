import React from "react";
import {
  Aperture,
  UserRound,
  History,
  Download,
  Settings2,
  ShieldCheck,
  KeyRound,
  Home,
} from "lucide-react";

export function PageNav({
  current,
  onNavigate,
  isDesktop = false,
}: {
  current: string;
  onNavigate: (p: string) => void;
  isDesktop?: boolean;
}) {
  const items = [
    ...(!isDesktop ? [{ id: "home", label: "Home", icon: Home }] : []),
    { id: "workspace", label: "Assistant", icon: Aperture },
    { id: "profiles", label: "Profiles", icon: UserRound },
    { id: "sessions", label: "Session History", icon: History },
    { id: "downloads", label: "Desktop Downloads", icon: Download },
    { id: "settings", label: "Settings", icon: Settings2 },
    { id: "account", label: "Account & Cloud", icon: ShieldCheck },
    ...(!isDesktop ? [{ id: "admin", label: "Admin Console", icon: KeyRound }] : []),
  ];
  return (
    <div className="quick-nav-bar" role="navigation" aria-label="Quick page navigation">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`quick-nav-pill ${current === item.id ? "active" : ""}`}
          onClick={() => onNavigate(item.id)}
        >
          <item.icon size={13} />
          {item.label}
        </button>
      ))}
    </div>
  );
}
