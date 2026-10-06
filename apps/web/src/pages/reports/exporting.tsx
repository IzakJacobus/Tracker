import type { Line, Tag } from "@stint/shared";
import {
  type ExportDoc,
  type ExportTable,
  linesTable,
  safeFileName,
  toCsv,
  toPdf,
  toXlsx,
} from "@stint/shared/export";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { useMe } from "../../app/session.tsx";
import { useOrganization } from "../../data/DataProvider.tsx";
import { errorMessage } from "../../lib/api.ts";
import { logoForPdf, saveFile } from "../../lib/download.ts";
import { Button } from "../../ui/Button.tsx";
import { useToast } from "../../ui/Toast.tsx";

export function useDocOptions(tags: Tag[]) {
  const me = useMe();
  const org = useOrganization() ?? me.organization!;
  return { organization: org, tags };
}

/** PDF, Excel and CSV buttons for a report. */
export function ExportButtons({
  fileBase,
  buildDoc,
  lines,
  tags,
}: {
  fileBase: string;
  buildDoc: () => ExportDoc;
  lines: Line[];
  tags: Tag[];
}) {
  const toast = useToast();
  const opts = useDocOptions(tags);
  const [busy, setBusy] = useState<string | null>(null);
  const name = safeFileName(fileBase);

  async function run(kind: "pdf" | "xlsx" | "csv") {
    setBusy(kind);
    try {
      const doc = buildDoc();
      if (kind === "pdf") {
        doc.organization.logo = await logoForPdf(doc.organization.logo);
        await saveFile(`${name}.pdf`, await toPdf(doc), "application/pdf");
      } else if (kind === "xlsx") {
        const sheets = doc.tables
          .filter((t): t is ExportTable => t.rows.length > 0 || !t.title?.includes("entries"))
          .map((t, i) => ({
            name: t.title ?? `Sheet ${i + 1}`,
            table: t,
            heading:
              i === 0
                ? [doc.title, doc.subtitle ?? "", ...doc.meta.map(([k, v]) => `${k}: ${v}`)]
                : undefined,
          }));
        await saveFile(
          `${name}.xlsx`,
          toXlsx(sheets),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
      } else {
        await saveFile(`${name}.csv`, toCsv(linesTable(lines, opts)), "text/csv;charset=utf-8");
      }
    } catch (e) {
      toast.error(`Couldn't create the file: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="export-bar">
      <Button icon={<FileText />} loading={busy === "pdf"} onClick={() => void run("pdf")}>
        PDF
      </Button>
      <Button icon={<FileSpreadsheet />} loading={busy === "xlsx"} onClick={() => void run("xlsx")}>
        Excel
      </Button>
      <Button icon={<FileDown />} loading={busy === "csv"} onClick={() => void run("csv")}>
        CSV
      </Button>
    </div>
  );
}
