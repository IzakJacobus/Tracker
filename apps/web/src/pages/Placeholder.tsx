import { Hammer } from "lucide-react";
import { EmptyState } from "../ui/misc.tsx";

export function Placeholder({ title }: { title: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
      </div>
      <EmptyState icon={<Hammer />} title="Coming soon">
        This part of Stint is still being built.
      </EmptyState>
    </div>
  );
}
