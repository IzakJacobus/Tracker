import { useCallback } from "react";
import { useData } from "../data/DataProvider.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { useToast } from "../ui/Toast.tsx";

/** Marks a project or item done from the Track page, with an Undo. Done items can't take new hours. */
export function useMarkDone() {
  const { mutate } = useData();
  const toast = useToast();
  return useCallback(
    async (projectId: string, name: string) => {
      try {
        await mutate(() => api.post(`/projects/${projectId}/archive`));
        toast.show(`Marked “${name}” done. It can't take new hours; its hours stay in reports.`, {
          action: {
            label: "Undo",
            onClick: () => {
              mutate(() => api.post(`/projects/${projectId}/unarchive`)).catch((e) =>
                toast.error(errorMessage(e)),
              );
            },
          },
        });
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [mutate, toast],
  );
}
