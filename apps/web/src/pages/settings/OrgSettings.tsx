import type { Organization, OrgSettings as Settings } from "@stint/shared";
import { ImageUp, Save, Trash2 } from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";
import { useSession } from "../../app/session.tsx";
import { api, errorMessage } from "../../lib/api.ts";
import { timeZones, WEEKDAYS } from "../../lib/locale.ts";
import { Button } from "../../ui/Button.tsx";
import { Field, Input, Select, Switch, Textarea } from "../../ui/Field.tsx";
import { Alert } from "../../ui/misc.tsx";
import { useToast } from "../../ui/Toast.tsx";

export function OrgSettingsPage() {
  const { refresh } = useSession();
  const toast = useToast();
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Organization>("/org")
      .then((o) => {
        setOrg(o);
        setName(o.name);
        setS(o.settings);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (error && !s) return <Alert tone="danger">{error}</Alert>;
  if (!s || !org) return null;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  async function save() {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<Organization>("/org", {
        name,
        settings: s,
      });
      setOrg(updated);
      setS(updated.settings);
      await refresh();
      toast.success("Settings saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      toast.error("Please choose an image smaller than 500 KB.");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    try {
      setOrg(await api.put<Organization>("/org/logo", { logo: dataUrl }));
      toast.success("Logo updated.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <div className="card__body" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <section className="form-section">
          <div className="form-section__intro">
            <h2>Company</h2>
            <p>Appears in the app and on every PDF you export.</p>
          </div>
          <div className="stack">
            <Field label="Company name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="row" style={{ alignItems: "center", gap: 16 }}>
              <div
                style={{
                  width: 120,
                  height: 64,
                  border: "1px dashed var(--border-strong)",
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--surface-sunken)",
                  overflow: "hidden",
                }}
              >
                {org.logo ? (
                  <img src={org.logo} alt="Company logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                ) : (
                  <span className="subtle" style={{ fontSize: 12 }}>
                    No logo
                  </span>
                )}
              </div>
              <label className="btn">
                <ImageUp /> Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="sr-only"
                  onChange={uploadLogo}
                />
              </label>
              {org.logo && (
                <Button
                  variant="ghost"
                  icon={<Trash2 />}
                  onClick={async () => setOrg(await api.put<Organization>("/org/logo", { logo: null }))}
                >
                  Remove
                </Button>
              )}
            </div>
            <div className="grid-3">
              <Field label="Address (for PDFs)" className="grow">
                <Textarea
                  rows={3}
                  value={s.pdf.address}
                  onChange={(e) => set("pdf", { ...s.pdf, address: e.target.value })}
                />
              </Field>
              <div className="stack">
                <Field label="Registration no.">
                  <Input
                    value={s.pdf.registration}
                    onChange={(e) => set("pdf", { ...s.pdf, registration: e.target.value })}
                  />
                </Field>
              </div>
              <div className="stack">
                <Field label="PDF accent colour">
                  <Input
                    type="color"
                    value={s.pdf.accentColor}
                    onChange={(e) => set("pdf", { ...s.pdf, accentColor: e.target.value })}
                  />
                </Field>
                <Field label="PDF footer">
                  <Input
                    value={s.pdf.footer}
                    onChange={(e) => set("pdf", { ...s.pdf, footer: e.target.value })}
                    placeholder="e.g. Confidential"
                  />
                </Field>
              </div>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section__intro">
            <h2>Regional</h2>
            <p>How dates and times are shown.</p>
          </div>
          <div className="form-grid">
            <Field label="Time zone">
              <Select value={s.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {timeZones().map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Week starts on">
              <Select value={s.weekStart} onChange={(e) => set("weekStart", Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date format">
              <Select
                value={s.dateFormat}
                onChange={(e) => set("dateFormat", e.target.value as Settings["dateFormat"])}
              >
                <option value="YYYY-MM-DD">2026-03-05</option>
                <option value="DD/MM/YYYY">05/03/2026</option>
                <option value="MM/DD/YYYY">03/05/2026</option>
                <option value="D MMM YYYY">5 Mar 2026</option>
              </Select>
            </Field>
            <Field label="Time format">
              <Select
                value={s.timeFormat}
                onChange={(e) => set("timeFormat", e.target.value as Settings["timeFormat"])}
              >
                <option value="24h">24-hour (14:30)</option>
                <option value="12h">12-hour (2:30 pm)</option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section__intro">
            <h2>Working time</h2>
            <p>Used for reminders, utilisation and timesheet approval.</p>
          </div>
          <div className="stack">
            <div className="form-grid">
              <Field label="Hours per working day">
                <Input
                  type="number"
                  min={0}
                  max={24}
                  step={0.25}
                  value={s.workdayMinutes / 60}
                  onChange={(e) => set("workdayMinutes", Math.round(Number(e.target.value) * 60))}
                />
              </Field>
              <Field
                label="Workday starts at"
                hint="Where entries typed as a duration are placed on the calendar."
              >
                <Input
                  type="time"
                  value={s.workdayStart}
                  onChange={(e) => set("workdayStart", e.target.value)}
                />
              </Field>
              <Field label="Timesheets are handed in">
                <Select
                  value={s.approvalPeriod}
                  onChange={(e) => set("approvalPeriod", e.target.value as "week" | "biweek" | "month")}
                >
                  <option value="week">Every week</option>
                  <option value="biweek">Every two weeks</option>
                  <option value="month">Every month</option>
                </Select>
              </Field>
              {s.approvalPeriod !== "month" && (
                <Field
                  label="…on"
                  hint="The last day of the week. Hours up to and including this day go into that timesheet."
                >
                  <Select value={s.approvalDay} onChange={(e) => set("approvalDay", Number(e.target.value))}>
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <fieldset className="stack stack--sm" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field__label" style={{ marginBottom: 6 }}>
                Working days
              </legend>
              <div className="row row--wrap">
                {WEEKDAYS.map((d, i) => (
                  <label key={d} className="checkbox" style={{ marginRight: 12 }}>
                    <input
                      type="checkbox"
                      checked={s.workingDays.includes(i)}
                      onChange={(e) =>
                        set(
                          "workingDays",
                          e.target.checked
                            ? [...s.workingDays, i].sort()
                            : s.workingDays.filter((x) => x !== i),
                        )
                      }
                    />
                    {d.slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section__intro">
            <h2>Reminders</h2>
            <p>Gentle nudges so timesheets are complete before they're due.</p>
          </div>
          <div className="stack">
            <Switch
              checked={s.reminders.enabled}
              onChange={(v) => set("reminders", { ...s.reminders, enabled: v })}
              label="Remind people when a workday has fewer hours than expected"
            />
            <div className="form-grid">
              <Field label="Remind at">
                <Input
                  type="time"
                  value={s.reminders.time}
                  disabled={!s.reminders.enabled}
                  onChange={(e) => set("reminders", { ...s.reminders, time: e.target.value })}
                />
              </Field>
              <Field label="If fewer than (hours)">
                <Input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  disabled={!s.reminders.enabled}
                  value={s.reminders.minMinutes / 60}
                  onChange={(e) =>
                    set("reminders", { ...s.reminders, minMinutes: Math.round(Number(e.target.value) * 60) })
                  }
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section__intro">
            <h2>Server computer</h2>
            <p>Settings for the PC running Stint Server.</p>
          </div>
          <div className="stack">
            <Switch
              checked={s.sleepGuard}
              onChange={(v) => set("sleepGuard", v)}
              label="Keep the server computer awake while Stint Server is running"
            />
          </div>
        </section>
      </div>
      <div className="card__footer" style={{ position: "sticky", bottom: 0 }}>
        {error && <span style={{ color: "var(--danger)", marginRight: "auto" }}>{error}</span>}
        <Button variant="primary" icon={<Save />} loading={busy} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
