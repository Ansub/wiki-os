import { createBrowserRouter } from "react-router-dom";

export const router = createBrowserRouter([
  {
    path: "/setup",
    lazy: () => import("./routes/setup-route"),
  },
  {
    path: "/",
    lazy: () => import("./routes/home-route"),
  },
  {
    path: "/stats",
    lazy: () => import("./routes/stats-route"),
  },
  {
    path: "/graph",
    lazy: () => import("./routes/graph-route"),
  },
  {
    path: "/wiki/*",
    lazy: () => import("./routes/wiki-route"),
  },
  {
    path: "*",
    lazy: () => import("./routes/not-found-route"),
  },
]);
