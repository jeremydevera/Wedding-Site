// main.jsx — Vite entry: load styles, mount <App/>, then the drag helper.
import "@/styles/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// load the (optional) drag-to-arrange helper after the app has mounted
import("@/lib/drag-arrange.js");

// self-updating tabs: poll for new deploys and refresh (public auto, admin via
// a banner) so clients get every release WITHOUT clearing caches or reopening.
import("@/lib/update-check.js").then((m) => m.initUpdateCheck()).catch(() => {});
