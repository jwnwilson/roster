import { describe, expect, it } from "vitest";

import { STATUSES, groupByStatus } from "./groupByStatus";
import type { WorkItem } from "../../lib/api/types";

const item = (id: string, status: WorkItem["status"]): WorkItem => ({
  id, key: `ROS-${id}`, project_id: "p1", type: "task", title: id, status,
  priority: "medium", epic_id: null, feature_id: null, spec: null,
  agent_name: null, sequence: 1, created_at: null, updated_at: null,
});

describe("groupByStatus", () => {
  it("keeps every column even when it is empty", () => {
    expect(Object.keys(groupByStatus([]))).toEqual([...STATUSES]);
  });

  it("puts each item in the column matching its status", () => {
    const grouped = groupByStatus([item("a", "todo"), item("b", "done"), item("c", "todo")]);

    expect(grouped.todo.map((i) => i.id)).toEqual(["a", "c"]);
    expect(grouped.done.map((i) => i.id)).toEqual(["b"]);
  });

  it("preserves the order items arrived in", () => {
    const grouped = groupByStatus([item("z", "todo"), item("a", "todo")]);

    expect(grouped.todo.map((i) => i.id)).toEqual(["z", "a"]);
  });
});
