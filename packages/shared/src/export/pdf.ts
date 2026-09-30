import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import {
  type CellValue,
  decimalHours,
  type ExportColumn,
  type ExportDoc,
  formatMoneyPlain,
  hm,
} from "./model.ts";

const A4 = { w: 595.28, h: 841.89 };
const M = { top: 40, bottom: 48, left: 40, right: 40 };
const INK = rgb(0.11, 0.13, 0.11);
const MUTED = rgb(0.42, 0.45, 0.41);
const LINE = rgb(0.86, 0.87, 0.85);
const ZEBRA = rgb(0.97, 0.975, 0.965);

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) ?? ["", "1f", "5c", "4a"];
  return rgb(
    Number.parseInt(m[1]!, 16) / 255,
    Number.parseInt(m[2]!, 16) / 255,
    Number.parseInt(m[3]!, 16) / 255,
  );
}

function tint(hex: string, amount: number) {
  const c = hexToRgb(hex);
  return rgb(c.red + (1 - c.red) * amount, c.green + (1 - c.green) * amount, c.blue + (1 - c.blue) * amount);
}

/** Standard PDF fonts only cover WinAnsi; replace anything else so rendering never fails. */
function makeSafe(font: PDFFont) {
  const ok = new Map<string, boolean>();
  return (text: string): string => {
    let out = "";
    for (const ch of text.normalize("NFC")) {
      let good = ok.get(ch);
      if (good === undefined) {
        try {
          font.encodeText(ch);
          good = true;
        } catch {
          good = false;
        }
        ok.set(ch, good);
      }
      out += good ? ch : ch === "\t" ? " " : "?";
    }
    return out.replace(/[\r\n]+/g, " ");
  };
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${text.slice(0, mid)}…`, size) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function display(col: ExportColumn, v: CellValue, currency: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (col.kind === "hours") return hm(v);
    if (col.kind === "money") return formatMoneyPlain(v, currency);
    if (col.kind === "decimal") return v.toFixed(2);
    return String(v);
  }
  return v;
}

const isNumeric = (c: ExportColumn) => c.kind !== "text" && c.kind !== "date";

function dataUrlBytes(url: string): { bytes: Uint8Array; type: "png" | "jpg" } | null {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(url);
  if (!m) return null;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: m[1] === "png" ? "png" : "jpg" };
}

export async function toPdf(doc: ExportDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setAuthor(doc.organization.name);
  pdf.setCreator("Stint");
  pdf.setProducer("Stint (pdf-lib)");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const safe = makeSafe(regular);
  const accent = hexToRgb(doc.organization.accentColor);
  const accentSoft = tint(doc.organization.accentColor, 0.88);
  let logo: PDFImage | null = null;
  const logoData = doc.organization.logo ? dataUrlBytes(doc.organization.logo) : null;
  if (logoData) {
    try {
      logo =
        logoData.type === "png" ? await pdf.embedPng(logoData.bytes) : await pdf.embedJpg(logoData.bytes);
    } catch {
      logo = null;
    }
  }

  const contentW = A4.w - M.left - M.right;
  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M.top;

  const text = (s: string, x: number, yy: number, size: number, font = regular, color = INK) =>
    page.drawText(safe(s), { x, y: yy, size, font, color });
  const textRight = (s: string, xRight: number, yy: number, size: number, font = regular, color = INK) => {
    const t = safe(s);
    page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y: yy, size, font, color });
  };

  const header = (first: boolean) => {
    y = A4.h - M.top;
    const top = y;
    let leftBottom = top;
    if (logo) {
      const scale = Math.min(130 / logo.width, 46 / logo.height, 1);
      const w = logo.width * scale;
      const h = logo.height * scale;
      page.drawImage(logo, { x: M.left, y: top - h, width: w, height: h });
      leftBottom = top - h;
    } else {
      text(doc.organization.name, M.left, top - 16, 16, bold, accent);
      leftBottom = top - 20;
    }
    const right = A4.w - M.right;
    let ry = top - 10;
    textRight(doc.organization.name, right, ry, 10, bold);
    if (first) {
      for (const line of doc.organization.address.split(/\r?\n/).filter(Boolean).slice(0, 4)) {
        ry -= 11;
        textRight(line, right, ry, 8, regular, MUTED);
      }
      const ids = [
        doc.organization.registration && `Reg. ${doc.organization.registration}`,
        doc.organization.vatNumber && `VAT ${doc.organization.vatNumber}`,
      ]
        .filter(Boolean)
        .join("   ");
      if (ids) {
        ry -= 11;
        textRight(ids, right, ry, 8, regular, MUTED);
      }
    }
    y = Math.min(leftBottom, ry) - 12;
    page.drawRectangle({ x: M.left, y, width: contentW, height: 2.2, color: accent });
    y -= 22;
  };

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    header(false);
  };
  const ensure = (h: number) => {
    if (y - h < M.bottom + 10) newPage();
  };

  header(true);
  text(doc.title, M.left, y, 18, bold);
  y -= 16;
  if (doc.subtitle) {
    text(doc.subtitle, M.left, y, 10, regular, MUTED);
    y -= 14;
  }
  y -= 4;

  // meta: two columns of label/value
  if (doc.meta.length) {
    const colW = contentW / 2;
    doc.meta.forEach(([k, v], i) => {
      const x = M.left + (i % 2) * colW;
      if (i % 2 === 0 && i > 0) y -= 14;
      text(k, x, y, 8, regular, MUTED);
      text(fit(safe(v), bold, 9, colW - 80), x + 78, y, 9, bold);
    });
    y -= 22;
  }

  // figures: highlighted boxes
  if (doc.figures?.length) {
    const n = doc.figures.length;
    const gap = 8;
    const w = (contentW - gap * (n - 1)) / n;
    ensure(50);
    doc.figures.forEach(([label, value], i) => {
      const x = M.left + i * (w + gap);
      page.drawRectangle({ x, y: y - 38, width: w, height: 44, color: accentSoft });
      text(label, x + 10, y - 8, 7.5, regular, MUTED);
      text(fit(safe(value), bold, 14, w - 20), x + 10, y - 28, 14, bold);
    });
    y -= 60;
  }

  // tables
  for (const table of doc.tables) {
    const weights = table.columns.map((c) => c.width ?? (c.kind === "text" ? 3 : 1.2));
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / sum) * contentW);
    const xs = widths.map((_, i) => M.left + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const rowH = 15;
    const pad = 4;

    const drawHead = () => {
      page.drawRectangle({ x: M.left, y: y - 5, width: contentW, height: rowH + 1, color: accentSoft });
      table.columns.forEach((c, i) => {
        const label = fit(safe(c.header), bold, 8, widths[i]! - pad * 2);
        if (isNumeric(c)) textRight(label, xs[i]! + widths[i]! - pad, y, 8, bold);
        else text(label, xs[i]! + pad, y, 8, bold);
      });
      y -= rowH + 2;
    };

    ensure(rowH * 3 + (table.title ? 18 : 0));
    if (table.title) {
      text(table.title, M.left, y, 11, bold);
      y -= 16;
    }
    drawHead();
    table.rows.forEach((row, ri) => {
      if (y - rowH < M.bottom + 10) {
        newPage();
        if (table.title) {
          text(`${table.title} (continued)`, M.left, y, 9, bold, MUTED);
          y -= 14;
        }
        drawHead();
      }
      if (ri % 2 === 1)
        page.drawRectangle({ x: M.left, y: y - 5, width: contentW, height: rowH, color: ZEBRA });
      table.columns.forEach((c, i) => {
        const v = fit(safe(display(c, row[c.key] ?? null, doc.currency)), regular, 8, widths[i]! - pad * 2);
        if (isNumeric(c)) textRight(v, xs[i]! + widths[i]! - pad, y, 8);
        else text(v, xs[i]! + pad, y, 8);
      });
      y -= rowH;
    });
    if (table.rows.length === 0) {
      text("No time recorded.", M.left + pad, y, 8, regular, MUTED);
      y -= rowH;
    }
    if (table.totals) {
      ensure(rowH + 4);
      page.drawLine({
        start: { x: M.left, y: y + rowH - 4 },
        end: { x: M.left + contentW, y: y + rowH - 4 },
        thickness: 0.8,
        color: INK,
      });
      table.columns.forEach((c, i) => {
        const v = fit(
          safe(display(c, table.totals![c.key] ?? null, doc.currency)),
          bold,
          8.5,
          widths[i]! - pad * 2,
        );
        if (isNumeric(c)) textRight(v, xs[i]! + widths[i]! - pad, y, 8.5, bold);
        else text(v, xs[i]! + pad, y, 8.5, bold);
      });
      y -= rowH;
    }
    y -= 16;
  }

  if (doc.notes) {
    ensure(24);
    text(fit(safe(doc.notes), regular, 8, contentW), M.left, y, 8, regular, MUTED);
    y -= 18;
  }

  // signature lines
  if (doc.signatures?.length) {
    ensure(80);
    y -= 30;
    const n = doc.signatures.length;
    const gap = 30;
    const w = (contentW - gap * (n - 1)) / n;
    doc.signatures.forEach((label, i) => {
      const x = M.left + i * (w + gap);
      page.drawLine({ start: { x, y }, end: { x: x + w * 0.62, y }, thickness: 0.7, color: INK });
      page.drawLine({ start: { x: x + w * 0.7, y }, end: { x: x + w, y }, thickness: 0.7, color: INK });
      text(label, x, y - 11, 8, regular, MUTED);
      text("Date", x + w * 0.7, y - 11, 8, regular, MUTED);
    });
    y -= 30;
  }

  // footer on every page
  const pages = pdf.getPages();
  const generated = new Date(doc.generatedAt).toISOString().slice(0, 16).replace("T", " ");
  pages.forEach((p, i) => {
    const footer = [doc.organization.footer, `Generated by Stint on ${generated}`]
      .filter(Boolean)
      .join("  ·  ");
    p.drawLine({
      start: { x: M.left, y: M.bottom - 12 },
      end: { x: A4.w - M.right, y: M.bottom - 12 },
      thickness: 0.5,
      color: LINE,
    });
    p.drawText(safe(fit(footer, regular, 7, contentW - 80)), {
      x: M.left,
      y: M.bottom - 24,
      size: 7,
      font: regular,
      color: MUTED,
    });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: A4.w - M.right - regular.widthOfTextAtSize(label, 7),
      y: M.bottom - 24,
      size: 7,
      font: regular,
      color: MUTED,
    });
  });

  return pdf.save();
}

export { decimalHours };
