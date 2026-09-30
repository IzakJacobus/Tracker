import { type ReactNode, useEffect } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { CommandLayer } from "./app/CommandPalette.tsx";
import { DesktopGate } from "./app/DesktopGate.tsx";
import { Shell } from "./app/Shell.tsx";
import { SyncPill } from "./app/SyncPill.tsx";
import { SessionProvider, useSession } from "./app/session.tsx";
import { DataProvider } from "./data/DataProvider.tsx";
import { applyTheme, watchSystemTheme } from "./lib/theme.ts";
import { AccountPage } from "./pages/Account.tsx";
import { ApprovalsPage } from "./pages/approvals/ApprovalsPage.tsx";
import { ForcePassword } from "./pages/auth/ForcePassword.tsx";
import { Login } from "./pages/auth/Login.tsx";
import { Setup } from "./pages/auth/Setup.tsx";
import { ClientsPage } from "./pages/clients/ClientsPage.tsx";
import { Placeholder } from "./pages/Placeholder.tsx";
import { ProjectsPage } from "./pages/projects/ProjectsPage.tsx";
import { ClientReportPage } from "./pages/reports/ClientReport.tsx";
import { MonthlyReport } from "./pages/reports/Monthly.tsx";
import { Overview } from "./pages/reports/Overview.tsx";
import { ProjectReportPage } from "./pages/reports/ProjectReport.tsx";
import { ReportsLayout } from "./pages/reports/ReportsLayout.tsx";
import { AuditLogPage } from "./pages/settings/AuditLog.tsx";
import { OrgSettingsPage } from "./pages/settings/OrgSettings.tsx";
import { ReratePage } from "./pages/settings/Rerate.tsx";
import { SettingsLayout } from "./pages/settings/SettingsLayout.tsx";
import { TeamPage } from "./pages/team/Team.tsx";
import { TrackPage } from "./pages/track/TrackPage.tsx";
import { onAppUpdate } from "./pwa/register.ts";
import { DesktopBridge } from "./tracking/DesktopBridge.tsx";
import { EntryDialogHost, useEntryDialog } from "./tracking/EntryDialogHost.tsx";
import { TimerDock } from "./tracking/TimerDock.tsx";
import { Logo } from "./ui/misc.tsx";
import { ToastProvider, useToast } from "./ui/Toast.tsx";

function Splash() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }} aria-busy="true">
      <Logo size={36} />
    </div>
  );
}

function AppFrame() {
  const dialog = useEntryDialog();
  const toast = useToast();
  useEffect(
    () =>
      onAppUpdate((apply) =>
        toast.show("A new version of Stint is ready.", {
          action: { label: "Reload", onClick: apply },
          durationMs: 120_000,
        }),
      ),
    [toast],
  );
  return (
    <>
      <Shell statusSlot={<SyncPill />} dock={<TimerDock onAddManual={() => dialog.open({})} />} />
      <CommandLayer />
      <DesktopBridge />
    </>
  );
}

function RequireRole({
  roles,
  children,
}: {
  roles: ("admin" | "manager" | "member")[];
  children: ReactNode;
}) {
  const { me } = useSession();
  if (!me || !roles.includes(me.user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const appRouter = () =>
  createBrowserRouter([
    {
      path: "/",
      element: (
        <DataProvider>
          <EntryDialogHost>
            <AppFrame />
          </EntryDialogHost>
        </DataProvider>
      ),
      children: [
        { index: true, element: <TrackPage /> },
        {
          path: "reports",
          element: <ReportsLayout />,
          children: [
            { index: true, element: <Overview /> },
            { path: "monthly", element: <MonthlyReport /> },
            { path: "project", element: <ProjectReportPage /> },
            { path: "clients", element: <ClientReportPage /> },
          ],
        },
        {
          path: "approvals",
          element: (
            <RequireRole roles={["admin", "manager"]}>
              <ApprovalsPage />
            </RequireRole>
          ),
        },
        { path: "projects/*", element: <ProjectsPage /> },
        {
          path: "clients",
          element: (
            <RequireRole roles={["admin"]}>
              <ClientsPage />
            </RequireRole>
          ),
        },
        {
          path: "team",
          element: (
            <RequireRole roles={["admin", "manager"]}>
              <TeamPage />
            </RequireRole>
          ),
        },
        {
          path: "settings",
          element: (
            <RequireRole roles={["admin"]}>
              <SettingsLayout />
            </RequireRole>
          ),
          children: [
            { index: true, element: <OrgSettingsPage /> },
            { path: "audit", element: <AuditLogPage /> },
            { path: "rerate", element: <ReratePage /> },
            { path: "*", element: <Placeholder title="Coming soon" /> },
          ],
        },
        { path: "account", element: <AccountPage /> },
        { path: "setup", element: <Navigate to="/" replace /> },
        { path: "*", element: <Navigate to="/" replace /> },
      ],
    },
  ]);

let router: ReturnType<typeof appRouter> | null = null;

function Gate() {
  const { state } = useSession();
  switch (state.status) {
    case "loading":
      return <Splash />;
    case "needs-setup":
      return (
        <RouterProvider
          router={createBrowserRouter([{ path: "*", element: <Setup fromServerPc={state.fromServerPc} /> }])}
        />
      );
    case "anonymous":
      return <Login />;
    case "offline":
      return <Login offline />;
    case "authed":
      if (state.me.user.mustChangePassword) return <ForcePassword />;
      router ??= appRouter();
      return <RouterProvider router={router} />;
  }
}

export function App() {
  useEffect(() => {
    applyTheme();
    return watchSystemTheme();
  }, []);
  return (
    <ToastProvider>
      <DesktopGate>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </DesktopGate>
    </ToastProvider>
  );
}
