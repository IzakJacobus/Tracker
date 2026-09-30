import { useMe } from "../../app/session.tsx";
import { Logo } from "../../ui/misc.tsx";
import { ChangePasswordForm } from "../Account.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function ForcePassword() {
  const me = useMe();
  return (
    <AuthLayout>
      <Logo size={30} />
      <div className="stack stack--sm">
        <h1>Welcome, {me.user.name.split(" ")[0]}</h1>
        <p className="muted">Please choose your own password to finish signing in.</p>
      </div>
      <ChangePasswordForm forced />
    </AuthLayout>
  );
}
