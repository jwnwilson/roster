import { useParams } from "react-router-dom";

import { DetailScreen } from "./DetailScreen";

/** Reads the ids from the route so the screen stays a pure function of its props
 *  and can be tested without a router. */
export function DetailRoute() {
  const { projectId, itemId } = useParams();
  return <DetailScreen projectId={projectId} itemId={itemId} />;
}
