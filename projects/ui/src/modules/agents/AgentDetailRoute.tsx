import { useParams } from "react-router-dom";

import { AgentDetailScreen } from "./AgentDetailScreen";

/** Reads the folder name from the route so the screen stays a pure function of
 *  its props and can be tested without a router. */
export function AgentDetailRoute() {
  const { name } = useParams();
  return <AgentDetailScreen name={name} />;
}
