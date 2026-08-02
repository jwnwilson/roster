import { useSearchParams } from "react-router-dom";

import { BoardView } from "./BoardView";

/** Reads the selected project from the URL so the view stays a pure function of
 *  its props and can be tested without a router. */
export function BoardRoute() {
  const [searchParams] = useSearchParams();
  return <BoardView projectId={searchParams.get("project") ?? undefined} />;
}
