import {
  BarChart3,
  Building2,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  FolderTree,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Settings,
  Sun,
  Timer,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useData } from "../data/DataProvider.tsx";
import { getThemePref, setThemePref, type ThemePref } from "../lib/theme.ts";
import { Button } from "../ui/Button.tsx";
import { ConfirmDialog } from "../ui/Dialog.tsx";
import { Avatar, Logo } from "../ui/misc.tsx";
import { Menu, Popover } from "../ui/Popover.tsx";
import { useMe, useSession } from "./session.tsx";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: ("admin" | "manager" | "member")[];
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Track", icon: <Timer />, end: true },
  { to: "/reports", label: "Reports", icon: <BarChart3 /> },
  { to: "/approvals", label: "Approvals", icon: <CheckSquare />, roles: ["admin", "manager"] },
  { to: "/projects", label: "Projects", icon: <FolderTree /> },
  { to: "/clients", label: "Clients", icon: <Building2 />, roles: ["admin"] },
  { to: "/team", label: "Team", icon: <Users />, roles: ["admin", "manager"] },
  { to: "/settings", label: "Settings", icon: <Settings />, roles: ["admin"] },
];

const COLLAPSE_KEY = "stint.sidebar.collapsed";

export function Shell({ dock, statusSlot }: { dock?: ReactNode; statusSlot?: ReactNode }) {
  const me = useMe();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the mobile drawer on navigation
  useEffect(() => setDrawer(false), [location.pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  };

  const items = NAV.filter((n) => !n.roles || n.roles.includes(me.user.role));

  return (
    <div className="shell" data-collapsed={collapsed} data-drawer={drawer ? "open" : "closed"}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="mobile-bar">
        <Button
          variant="ghost"
          iconOnly
          label="Open menu"
          icon={<MenuIcon />}
          onClick={() => setDrawer(true)}
        />
        <Logo size={24} />
        <span className="mobile-bar__status">{statusSlot}</span>
      </header>
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar__brand">
          <Logo size={26} />
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            icon={collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            onClick={toggleCollapsed}
          />
        </div>
        <div className="sidebar__org truncate" title={me.organization?.name}>
          {me.organization?.name}
        </div>
        <div className="nav">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}>
              {n.icon}
              <span>{n.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="sidebar__spacer" />
        <div className="sidebar__footer">
          {statusSlot}
          <UserMenu />
        </div>
      </nav>
      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      {dock}
    </div>
  );
}

function UserMenu() {
  const me = useMe();
  const { logout } = useSession();
  const { db, engine } = useData();
  const navigate = useNavigate();
  const [unsent, setUnsent] = useState<number | null>(null);

  async function signOut(force = false) {
    await engine.syncNow().catch(() => {});
    const pending = await db.outbox.count();
    if (pending > 0 && !force) {
      setUnsent(pending);
      return;
    }
    engine.stop();
    // Don't leave a copy of this person's time on a shared computer.
    await db.delete().catch(() => {});
    await logout();
  }
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const pick = (t: ThemePref) => {
    setThemePref(t);
    setTheme(t);
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={me.user.name} color={me.user.color} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="user-chip__name truncate">{me.user.name}</div>
          <div className="user-chip__role">{me.user.role}</div>
        </div>
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        placement="top-start"
        role="menu"
        label="Account"
      >
        <Menu
          onClose={() => setOpen(false)}
          items={[
            { group: me.user.email },
            { label: "Change password", icon: <KeyRound />, onSelect: () => navigate("/account") },
            "sep",
            { group: "Appearance" },
            {
              label: `System${theme === "system" ? " ✓" : ""}`,
              icon: <Monitor />,
              onSelect: () => pick("system"),
            },
            { label: `Light${theme === "light" ? " ✓" : ""}`, icon: <Sun />, onSelect: () => pick("light") },
            { label: `Dark${theme === "dark" ? " ✓" : ""}`, icon: <Moon />, onSelect: () => pick("dark") },
            "sep",
            { label: "Sign out", icon: <LogOut />, onSelect: () => void signOut(), danger: true },
          ]}
        />
      </Popover>
      <ConfirmDialog
        open={unsent !== null}
        onClose={() => setUnsent(null)}
        onConfirm={() => void signOut(true)}
        title="Some changes haven't been sent yet"
        message={`${unsent} change${unsent === 1 ? " is" : "s are"} saved only on this computer because the Stint server can't be reached. If you sign out now, ${unsent === 1 ? "it" : "they"} will be lost. Connect to the office network and wait for “Synced” first.`}
        confirmLabel="Sign out and discard"
        danger
      />
    </>
  );
}
