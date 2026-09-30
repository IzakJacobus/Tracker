export type ThemePref = "system" | "light" | "dark";
const KEY = "stint.theme";

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function applyTheme(pref: ThemePref = getThemePref()): void {
  const dark =
    pref === "dark" || (pref === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemePref(pref: ThemePref): void {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
}

export function watchSystemTheme(): () => void {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mq) return () => {};
  const fn = () => applyTheme();
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}
