import { tauri } from "./transport.ts";

/** Saves a generated file: a download in the browser, a Save dialog in the desktop app. */
export async function saveFile(name: string, data: Uint8Array | string, mime: string): Promise<void> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const t = tauri();
  if (t) {
    await t.invoke("save_file", { name, bytes: Array.from(bytes) });
    return;
  }
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** PDFs can only embed PNG/JPEG: convert an SVG/WebP logo to PNG in the browser. */
export async function logoForPdf(logo: string | null): Promise<string | null> {
  if (!logo) return null;
  if (/^data:image\/(png|jpeg);/.test(logo)) return logo;
  try {
    const img = new Image();
    img.src = logo;
    await img.decode();
    const scale = Math.min(1, 600 / Math.max(img.naturalWidth || 600, img.naturalHeight || 200));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((img.naturalWidth || 600) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 200) * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
