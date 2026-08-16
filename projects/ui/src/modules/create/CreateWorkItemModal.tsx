import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";

import { Button } from "../../components/ui/Button";
import { FormField } from "../../components/ui/FormField";
import { Modal } from "../../components/ui/Modal";
import { TextInput } from "../../components/ui/TextInput";
import { useWorkItems } from "../../lib/api/hooks";
import { queryKeys } from "../../lib/api/queryKeys";
import type { WorkItemStatus, WorkItemType } from "../../lib/api/types";
import { createWorkItem } from "../../lib/api/workItems";
import type { NewWorkItem } from "../../lib/api/workItems";

const TYPES: { value: WorkItemType; label: string }[] = [
  { value: "epic", label: "Epic" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Task" },
];

/** Create Work Item.
 *
 * The hierarchy the API enforces (epic → feature → task; a task under a feature
 * carries its epic too) is made unreachable in the form rather than left to the
 * 400. A form that can compose an invalid request and relies on the server to
 * refuse it teaches the operator nothing about the rule.
 */
export function CreateWorkItemModal({
  projectId,
  status,
  onClose,
}: {
  projectId: string;
  /** Set when opened from a board column, so the item starts in that column
   *  rather than the backlog — otherwise the per-column + means nothing. */
  status?: WorkItemStatus;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<WorkItemType>("task");
  const [epicId, setEpicId] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);
  const titleId = useId();
  const queryClient = useQueryClient();

  const { data } = useWorkItems(projectId);
  const items = data?.results ?? [];
  const epics = items.filter((item) => item.type === "epic");
  const features = items.filter((item) => item.type === "feature");

  const create = useMutation({
    mutationFn: (payload: NewWorkItem) => createWorkItem(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workItems(projectId) });
      onClose();
    },
    onError: (cause: Error) => {
      submitted.current = false;
      setError(cause.message);
    },
  });

  const submit = () => {
    if (submitted.current) return;
    if (type === "feature" && !epicId) {
      setError("A feature needs an epic to belong to.");
      return;
    }
    if (type === "task" && featureId && !epicId) {
      setError("A task under a feature must carry that feature's epic too.");
      return;
    }
    submitted.current = true;
    setError(null);
    create.mutate({
      project_id: projectId,
      type,
      title,
      ...(status ? { status } : {}),
      ...(epicId ? { epic_id: epicId } : {}),
      ...(featureId ? { feature_id: featureId } : {}),
    });
  };

  return (
    <Modal
      title="New work item"
      onClose={onClose}
      footer={
        <Button onClick={submit} disabled={create.isPending}>
          Create work item
        </Button>
      }
    >
      <FormField label="Title" htmlFor={titleId} error={error ?? undefined}>
        <TextInput id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} />
      </FormField>

      <fieldset className="mb-3">
        <legend className="mb-1 text-[11px] font-medium text-text-3">Type</legend>
        <div className="flex gap-2">
          {TYPES.map((option) => (
            <label key={option.value} className="flex items-center gap-1 text-11-5 text-text-3">
              <input
                type="radio"
                name="work-item-type"
                value={option.value}
                checked={type === option.value}
                onChange={() => {
                  setType(option.value);
                  // An epic takes no parent at all, so clear anything chosen.
                  if (option.value === "epic") {
                    setEpicId("");
                    setFeatureId("");
                  }
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {type !== "epic" && (
        <FormField label="Parent epic" htmlFor="epic">
          <select
            id="epic"
            value={epicId}
            onChange={(e) => setEpicId(e.target.value)}
            className="h-8 rounded-5 border border-border bg-bg-input px-2 text-12 text-text-1"
          >
            <option value="">None</option>
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.title}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {type === "task" && (
        <FormField label="Parent feature" htmlFor="feature">
          <select
            id="feature"
            value={featureId}
            onChange={(e) => setFeatureId(e.target.value)}
            className="h-8 rounded-5 border border-border bg-bg-input px-2 text-12 text-text-1"
          >
            <option value="">None</option>
            {features.map((feature) => (
              <option key={feature.id} value={feature.id}>
                {feature.title}
              </option>
            ))}
          </select>
        </FormField>
      )}
    </Modal>
  );
}
