import { LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSession } from "../../app/session.tsx";
import { errorMessage } from "../../lib/api.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, Input } from "../../ui/Field.tsx";
import { Alert, Logo } from "../../ui/misc.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function Login({ offline }: { offline?: boolean }) {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <Logo size={30} />
      <div className="stack stack--sm">
        <h1>Sign in</h1>
        <p className="muted">Use the email address and password your administrator gave you.</p>
      </div>
      {offline && (
        <Alert tone="warning" title="Can't reach the Stint server">
          Check that you're connected to the office network. You need to sign in once while connected; after
          that Stint works offline too.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<LogIn />}>
          Sign in
        </Button>
      </form>
      <p className="subtle" style={{ fontSize: "var(--text-sm)" }}>
        Forgot your password? Ask your Stint administrator to reset it from <em>Team</em>.
      </p>
    </AuthLayout>
  );
}
