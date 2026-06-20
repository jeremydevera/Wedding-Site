// main.jsx — Vite entry: load styles, mount <App/>, then the drag helper.
import "@/styles/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// load the (optional) drag-to-arrange helper after the app has mounted
import("@/lib/drag-arrange.js");
