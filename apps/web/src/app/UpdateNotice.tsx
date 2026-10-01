import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { api } from "../lib/api.ts";
import { useMe } from "./session.tsx";

/** Tells admins when a newer Stint Server is published (the server checks GitHub Releases daily). */
export function UpdateNotice() {
  const me = useMe();
  const [latest, setLatest] = useState<string | null>(null);
  const isAdmin = me.user.role === "admin";
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const load = () =>
      api
        .get<{ available: boolean; latest: string | null } | null>("/admin/updates")
        .then((u) => alive && setLatest(u?.available ? u.latest : null))
        .catch(() => {});
    void load();
    const t = setInterval(load, 6 * 3600_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [isAdmin]);
  if (!latest) return null;
  return (
    <NavLink to="/settings/health" className="update-notice">
      <Sparkles aria-hidden="true" />
      <span>Stint {latest} is available</span>
    </NavLink>
  );
}
