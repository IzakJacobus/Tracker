import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useMe, useSession } from "../app/session.tsx";
import { ApiError, api, errorMessage } from "../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { Field, Input } from "../ui/Field.tsx";
import { Alert } from "../ui/misc.tsx";
import { useToast } from "../ui/Toast.tsx";

/**
 * Used on the Account page and, for people signing in with a temporary password, before the app
 * (and its router) exists, so it must not use the router itself: `onDone` says where to go next.
 */
export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { refresh } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (f.next !== f.confirm) {
      setErrors({ confirm: "The passwords don't match." });
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/password", { currentPassword: f.current, newPassword: f.next });
      toast.success("Password changed.");
      await refresh();
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.fields.newPassword) setErrors({ next: err.fields.newPassword });
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={forced ? "Temporary password" : "Current password"}>
        <Input
          type="password"
          autoComplete="current-password"
          value={f.current}
          onChange={(e) => setF({ ...f, current: e.target.value })}
          autoFocus
        />
      </Field>
      <Field
        label="New password"
        error={errors.next}
        hint="At least 10 characters. A short sentence works well."
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={f.next}
          onChange={(e) => setF({ ...f, next: e.target.value })}
        />
      </Field>
      <Field label="Confirm new password" error={errors.confirm}>
        <Input
          type="password"
          autoComplete="new-password"
          value={f.confirm}
          onChange={(e) => setF({ ...f, confirm: e.target.value })}
        />
      </Field>
      <div>
        <Button type="submit" variant="primary" loading={busy} icon={<KeyRound />}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function AccountPage() {
  const me = useMe();
  const navigate = useNavigate();
  return (
    <div className="page page--narrow">
      <div className="page-header">
        <div>
          <h1>Your account</h1>
          <p>
            {me.user.name} · {me.user.email}
          </p>
        </div>
      </div>
      <div className="card">
        <div className="card__header">
          <h2>Change password</h2>
        </div>
        <div className="card__body">
          <ChangePasswordForm onDone={() => navigate("/")} />
        </div>
      </div>
    </div>
  );
}
