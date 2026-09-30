import { type ReactNode, useEffect } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Shell } from "./app/Shell.tsx";
import { SessionProvider, useSession } from "./app/session.tsx";
import { applyTheme, watchSystemTheme } from "./lib/theme.ts";
import { AccountPage } from "./pages/Account.tsx";
import { ForcePassword } from "./pages/auth/ForcePassword.tsx";
import { Login } from "./pages/auth/Login.tsx";
import { Setup } from "./pages/auth/Setup.tsx";
import { Placeholder } from "./pages/Placeholder.tsx";
import { OrgSettingsPage } from "./pages/settings/OrgSettings.tsx";
import { SettingsLayout } from "./pages/settings/SettingsLayout.tsx";
import { TeamPage } from "./pages/team/Team.tsx";
import { Logo } from "./ui/misc.tsx";
import { ToastProvider } from "./ui/Toast.tsx";

function Splash() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }} aria-busy="true">
      <Logo size={36} />
    </div>
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
      element: <Shell />,
      children: [
        { index: true, element: <Placeholder title="Track" /> },
        { path: "reports/*", element: <Placeholder title="Reports" /> },
        {
          path: "approvals",
          element: (
            <RequireRole roles={["admin", "manager"]}>
              <Placeholder title="Approvals" />
            </RequireRole>
          ),
        },
        { path: "projects/*", element: <Placeholder title="Projects" /> },
        {
          path: "clients",
          element: (
            <RequireRole roles={["admin"]}>
              <Placeholder title="Clients" />
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
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </ToastProvider>
  );
}
