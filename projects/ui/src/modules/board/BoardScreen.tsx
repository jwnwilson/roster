import { useSearchParams } from "react-router-dom";

import { Topbar } from "../../app/Topbar";
import { useProjects, useWorkItems } from "../../lib/api/hooks";
import { useCreateModal } from "../create/useCreateModal";
import { BoardView } from "./BoardView";
import { ListView } from "./ListView";

/** Screens A and B share a topbar and differ only in how they lay the same work
 *  items out, so one screen owns both and the view switcher moves between them.
 *  The choice lives in the URL, so a board link and a list link are different
 *  links (handoff §Screen B: `/projects?view=board` is the default). */
export function BoardScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("project") ?? undefined;
  const view = searchParams.get("view") === "list" ? "list" : "board";

  const { openWorkItem } = useCreateModal();
  const { data: projects } = useProjects();
  const { data: items } = useWorkItems(projectId);

  const project = projects?.results.find((candidate) => candidate.id === projectId);

  return (
    <>
      <Topbar
        title={project?.name ?? "Projects"}
        count={items?.results.length ?? 0}
        view={view}
        onViewChange={(next) => {
          const params = new URLSearchParams(searchParams);
          params.set("view", next);
          setSearchParams(params);
        }}
        onNew={() => projectId && openWorkItem(projectId)}
        newDisabled={!projectId}
        artifactPath={project ? `${project.folder_path}/.roster/artifacts` : undefined}
      />
      {view === "list" ? <ListView projectId={projectId} /> : <BoardView projectId={projectId} />}
    </>
  );
}
