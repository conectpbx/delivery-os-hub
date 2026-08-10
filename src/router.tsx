import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { setupQueryPersistence } from "./lib/query-persist";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 1000 * 60 * 60 * 24 * 7,
        staleTime: 1000 * 30,
        retry: 1,
      },
    },
  });

  setupQueryPersistence(queryClient);


  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
