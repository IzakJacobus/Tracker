import { ArrowLeft, ArrowRight, Check, Monitor, Plus, Trash2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useSession } from "../../app/session.tsx";
import { ApiError, api, errorMessage } from "../../lib/api.ts";
import { CURRENCIES, timeZones } from "../../lib/locale.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, Input, Select } from "../../ui/Field.tsx";
import { Alert, Logo } from "../../ui/misc.tsx";
import { AuthLayout } from "./AuthLayout.tsx";
import { ConnectPanel } from "./ConnectPanel.tsx";

type Step = "welcome" | "company" | "admin" | "work" | "team" | "connect";
const ORDER: Step[] = ["welcome", "company", "admin", "work", "team", "connect"];

function Steps({ current }: { current: Step }) {
  const idx = ORDER.indexOf(current);
  return (
    <ol className="steps" aria-label={`Step ${idx + 1} of ${ORDER.length}`}>
      {ORDER.map((s, i) => (
        <li key={s} data-state={i < idx ? "done" : i === idx ? "current" : "todo"} />
      ))}
    </ol>
  );
}

export function Setup({ fromServerPc }: { fromServerPc: boolean }) {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [company, setCompany] = useState({
    organizationName: "",
    currency: "ZAR",
    timezone: "Africa/Johannesburg",
  });
  const [admin, setAdmin] = useState({ name: "", email: "", password: "", confirm: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!fromServerPc && step === "welcome") {
    return (
      <AuthLayout>
        <Logo size={30} />
        <h1>Almost there</h1>
        <Alert tone="info" title="Finish setup on the server computer">
          For security, Stint can only be set up on the computer where Stint Server is installed. On that
          computer, open the Start menu and choose <strong>Stint Server — Open</strong>.
        </Alert>
      </AuthLayout>
    );
  }

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    setFields({});
    setError(null);
    if (admin.password !== admin.confirm) {
      setFields({ confirm: "The passwords don't match." });
      return;
    }
    setBusy(true);
    try {
      await api.post("/setup", {
        ...company,
        admin: { name: admin.name, email: admin.email, password: admin.password },
      });
      // The session cookie is set now; refresh() happens at the end so the wizard stays open.
      setStep("work");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone finished setup elsewhere (another tab, or the server was restored): go to sign-in.
        await refresh();
        return;
      }
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        const f: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) f[k.replace(/^admin\./, "")] = v;
        setFields(f);
        if (f.organizationName) setStep("company");
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout wide>
      <div className="row row--between">
        <Logo size={30} />
        <span className="subtle">
          Setup · {ORDER.indexOf(step) + 1} of {ORDER.length}
        </span>
      </div>
      <Steps current={step} />

      {step === "welcome" && (
        <div className="stack">
          <h1>Welcome to Stint</h1>
          <p className="muted">
            Setting up takes about two minutes. You'll name your company, create your own administrator
            account and, if you like, add your first client and your team. You can change everything later in
            Settings.
          </p>
          <Alert tone="info" title="This computer is now your Stint Server">
            Leave it switched on during office hours. Stint keeps it awake while it's running and starts
            automatically when the computer starts.
          </Alert>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="primary" size="lg" icon={<ArrowRight />} onClick={() => setStep("company")}>
              Get started
            </Button>
          </div>
        </div>
      )}

      {step === "company" && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!company.organizationName.trim()) {
              setFields({ organizationName: "Please enter your company's name." });
              return;
            }
            setFields({});
            setStep("admin");
          }}
        >
          <h1>Your company</h1>
          <Field
            label="Company name"
            error={fields.organizationName}
            hint="Shown on timesheets and PDF reports."
          >
            <Input
              value={company.organizationName}
              onChange={(e) => setCompany({ ...company, organizationName: e.target.value })}
              placeholder="e.g. Karoo Consulting Engineers"
              autoFocus
            />
          </Field>
          <div className="grid-2">
            <Field label="Currency">
              <Select
                value={company.currency}
                onChange={(e) => setCompany({ ...company, currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Time zone">
              <Select
                value={company.timezone}
                onChange={(e) => setCompany({ ...company, timezone: e.target.value })}
              >
                {timeZones().map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="subtle" style={{ fontSize: "var(--text-sm)" }}>
            Weeks start on Monday and dates are shown as YYYY-MM-DD. You can change both in Settings.
          </p>
          <div className="row row--between">
            <Button icon={<ArrowLeft />} onClick={() => setStep("welcome")}>
              Back
            </Button>
            <Button type="submit" variant="primary" icon={<ArrowRight />}>
              Continue
            </Button>
          </div>
        </form>
      )}

      {step === "admin" && (
        <form className="stack" onSubmit={createOrg} noValidate>
          <h1>Your administrator account</h1>
          <p className="muted">
            Administrators manage clients, projects, people and settings. You can add more administrators
            later.
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Your name" error={fields.name}>
            <Input
              value={admin.name}
              onChange={(e) => setAdmin({ ...admin, name: e.target.value })}
              autoComplete="name"
              autoFocus
            />
          </Field>
          <Field label="Email" error={fields.email}>
            <Input
              type="email"
              value={admin.email}
              onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
              autoComplete="username"
            />
          </Field>
          <div className="grid-2">
            <Field
              label="Password"
              error={fields.password}
              hint="At least 10 characters. A short sentence works well."
            >
              <Input
                type="password"
                value={admin.password}
                onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm password" error={fields.confirm}>
              <Input
                type="password"
                value={admin.confirm}
                onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <div className="row row--between">
            <Button icon={<ArrowLeft />} onClick={() => setStep("company")}>
              Back
            </Button>
            <Button type="submit" variant="primary" loading={busy} icon={<Check />}>
              Create company
            </Button>
          </div>
        </form>
      )}

      {step === "work" && <FirstWorkStep onNext={() => setStep("team")} />}
      {step === "team" && <InviteStep onNext={() => setStep("connect")} />}
      {step === "connect" && (
        <div className="stack">
          <h1>Open Stint on the other computers</h1>
          <p className="muted">
            There's nothing to install on employees' computers: they open Stint in their web browser and sign
            in to <strong>{company.organizationName || "your company"}</strong>. Share this address with them:
          </p>
          <ConnectPanel />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button
              variant="primary"
              size="lg"
              icon={<Monitor />}
              onClick={async () => {
                navigate("/", { replace: true });
                await refresh();
              }}
            >
              Open Stint
            </Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}

function FirstWorkStep({ onNext }: { onNext: () => void }) {
  const [client, setClient] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!client.trim() || !project.trim()) {
      onNext();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await api.post<{ id: string }>("/clients", { name: client.trim() });
      await api.post("/projects", { clientId: c.id, name: project.trim() });
      onNext();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <h1>Your first client and project</h1>
      <p className="muted">
        Clients are the companies you bill. Projects belong to a client and can have sub-projects. Your firm's
        own work (admin, training, leave…) is already set up under the built-in <strong>Internal</strong>{" "}
        client.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid-2">
        <Field label="Client">
          <Input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="e.g. Drakenstein Municipality"
            autoFocus
          />
        </Field>
        <Field label="Project">
          <Input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="e.g. Paarl bridge upgrade"
          />
        </Field>
      </div>
      <div className="row row--between">
        <Button variant="ghost" onClick={onNext}>
          Skip for now
        </Button>
        <Button type="submit" variant="primary" loading={busy} icon={<ArrowRight />}>
          {client && project ? "Add and continue" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

interface Invite {
  name: string;
  email: string;
  role: "member" | "manager" | "admin";
  password: string;
}

function tempPassword(): string {
  const words = [
    "river",
    "karoo",
    "baobab",
    "protea",
    "summit",
    "harbour",
    "granite",
    "meadow",
    "copper",
    "delta",
    "cedar",
    "ember",
  ];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0]! % words.length];
  const n = (crypto.getRandomValues(new Uint32Array(1))[0]! % 90) + 10;
  return `${pick()}-${pick()}-${pick()}-${n}`;
}

function InviteStep({ onNext }: { onNext: () => void }) {
  const [rows, setRows] = useState<Invite[]>([
    { name: "", email: "", role: "member", password: tempPassword() },
  ]);
  const [done, setDone] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const todo = rows.filter((r) => r.name.trim() && r.email.trim());
    if (todo.length === 0) {
      onNext();
      return;
    }
    setBusy(true);
    setError(null);
    const created: Invite[] = [];
    try {
      for (const r of todo) {
        await api.post("/users", {
          name: r.name.trim(),
          email: r.email.trim(),
          role: r.role,
          password: r.password,
        });
        created.push(r);
      }
      setDone([...done, ...created]);
      setRows([{ name: "", email: "", role: "member", password: tempPassword() }]);
    } catch (err) {
      setDone([...done, ...created]);
      setRows(todo.filter((r) => !created.includes(r)));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <h1>Add your team</h1>
      <p className="muted">
        Each person gets a temporary password to sign in with the first time; Stint then asks them to choose
        their own. Managers approve timesheets for their team and can see rates.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {done.length > 0 && (
        <Alert tone="success" title={`${done.length} ${done.length === 1 ? "person" : "people"} added`}>
          <div className="stack stack--sm" style={{ marginTop: 4 }}>
            {done.map((d) => (
              <div key={d.email}>
                {d.name} · {d.email} · temporary password <code className="mono">{d.password}</code>
              </div>
            ))}
            <span className="subtle">
              Write these down or share them privately — they are not shown again.
            </span>
          </div>
        </Alert>
      )}
      {rows.map((r, i) => (
        <div key={r.password} className="row row--wrap" style={{ alignItems: "flex-end" }}>
          <Field label="Name" className="grow">
            <Input
              value={r.name}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
          </Field>
          <Field label="Email" className="grow">
            <Input
              type="email"
              value={r.email}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
            />
          </Field>
          <Field label="Role">
            <Select
              value={r.role}
              onChange={(e) =>
                setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value as Invite["role"] } : x)))
              }
            >
              <option value="member">Member</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Button
            iconOnly
            label="Remove row"
            variant="ghost"
            icon={<Trash2 />}
            onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
          />
        </div>
      ))}
      <div>
        <Button
          variant="ghost"
          icon={<Plus />}
          onClick={() =>
            setRows([...rows, { name: "", email: "", role: "member", password: tempPassword() }])
          }
        >
          Add another person
        </Button>
      </div>
      <div className="row row--between">
        <Button variant="ghost" onClick={onNext}>
          {done.length ? "Continue" : "Skip for now"}
        </Button>
        <Button type="submit" variant="primary" loading={busy} icon={<UserPlus />}>
          Add {rows.filter((r) => r.name && r.email).length || ""}{" "}
          {rows.filter((r) => r.name && r.email).length === 1 ? "person" : "people"}
        </Button>
      </div>
    </form>
  );
}
