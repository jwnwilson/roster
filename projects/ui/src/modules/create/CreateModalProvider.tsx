import { createContext, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { WorkItemStatus } from "../../lib/api/types";

import { CreateProjectModal } from "./CreateProjectModal";
import { CreateWorkItemModal } from "./CreateWorkItemModal";

type OpenModal =
  | { kind: "project" }
  | { kind: "workItem"; projectId: string; status?: WorkItemStatus }
  | null;

export interface CreateModalValue {
  openProject: () => void;
  openWorkItem: (projectId: string, status?: WorkItemStatus) => void;
}

export const CreateModalContext = createContext<CreateModalValue | null>(null);

/** Owns both create modals so the sidebar's + and a board column's + open the
 *  same thing, and only one can be open at a time. */
export function CreateModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenModal>(null);
  const close = useCallback(() => setOpen(null), []);

  const value = useMemo<CreateModalValue>(
    () => ({
      openProject: () => setOpen({ kind: "project" }),
      openWorkItem: (projectId: string, status?: WorkItemStatus) =>
        setOpen({ kind: "workItem", projectId, status }),
    }),
    [],
  );

  return (
    <CreateModalContext.Provider value={value}>
      {children}
      {open?.kind === "project" && <CreateProjectModal onClose={close} />}
      {open?.kind === "workItem" && (
        <CreateWorkItemModal projectId={open.projectId} status={open.status} onClose={close} />
      )}
    </CreateModalContext.Provider>
  );
}
