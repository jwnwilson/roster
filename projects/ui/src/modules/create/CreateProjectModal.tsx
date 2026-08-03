import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";

import { Button } from "../../components/ui/Button";
import { FormField } from "../../components/ui/FormField";
import { Modal } from "../../components/ui/Modal";
import { TextInput } from "../../components/ui/TextInput";
import { createProject } from "../../lib/api/projects";
import type { NewProject } from "../../lib/api/projects";
import { queryKeys } from "../../lib/api/queryKeys";
import type { SourceKind } from "../../lib/api/types";

const TYPES: { kind: SourceKind; label: string; field?: string }[] = [
  { kind: "git", label: "Git repository", field: "Repository URL" },
  { kind: "local", label: "Local folder", field: "Local path" },
  { kind: "none", label: "No code" },
];

/** Create Project.
 *
 * Keeps the handoff's PROJECT TYPE segmented control and **drops its ARTIFACT
 * STORE block**: roster fixes that location at <project folder>/.roster/artifacts,
 * so there is nothing to choose (spec §6). A control offering a choice the system
 * does not have is worse than no control.
 */
export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SourceKind>("git");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Guards against a duplicate create. `isPending` alone is not enough: it goes
  // false again on success, and onClose is the parent's business — until it
  // unmounts us the form is still on screen and still clickable.
  const submitted = useRef(false);
  const nameId = useId();
  const targetId = useId();
  const queryClient = useQueryClient();

  const selected = TYPES.find((type) => type.kind === kind)!;

  const create = useMutation({
    mutationFn: (payload: NewProject) => createProject(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
      onClose();
    },
    onError: (cause: Error) => {
      // A rejected create is worth retrying — re-arm rather than stranding the
      // operator with a form that silently does nothing.
      submitted.current = false;
      setError(cause.message);
    },
  });

  const submit = () => {
    if (submitted.current) return;
    submitted.current = true;
    setError(null);
    // Only the field the declared kind actually uses is sent — the API validates
    // that a git source carries a url and a local one a path.
    const source =
      kind === "git"
        ? { kind, url: target }
        : kind === "local"
          ? { kind, path: target }
          : { kind };
    create.mutate({ name, source });
  };

  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <Button onClick={submit} disabled={create.isPending}>
          Create project
        </Button>
      }
    >
      <FormField label="Name" htmlFor={nameId} error={error ?? undefined}>
        <TextInput id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>

      <fieldset className="mb-3">
        <legend className="mb-1 text-[11px] font-medium text-text-3">Project type</legend>
        <div className="flex gap-2">
          {TYPES.map((type) => (
            <label key={type.kind} className="flex items-center gap-1 text-11-5 text-text-3">
              <input
                type="radio"
                name="project-type"
                value={type.kind}
                checked={kind === type.kind}
                onChange={() => {
                  setKind(type.kind);
                  setTarget("");
                }}
              />
              {type.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-11 text-text-5">
          Optional. A project needs no code at all — pick No code for research, ops or writing work.
        </p>
      </fieldset>

      {selected.field && (
        <FormField label={selected.field} htmlFor={targetId}>
          <TextInput id={targetId} value={target} onChange={(e) => setTarget(e.target.value)} />
        </FormField>
      )}
    </Modal>
  );
}
