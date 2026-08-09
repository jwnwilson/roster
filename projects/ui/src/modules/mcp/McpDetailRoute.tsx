import { useParams } from "react-router-dom";

import { McpDetailScreen } from "./McpDetailScreen";

/** Reads the server name from the route so the screen stays a pure function of
 *  its props and can be tested without a router. */
export function McpDetailRoute() {
  const { name } = useParams();
  return <McpDetailScreen name={name} />;
}
