import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { QueryProvider } from "../lib/api/queryClient";
import { routes } from "./routes";

const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryProvider>
      <RouterProvider router={router} />
    </QueryProvider>
  );
}
