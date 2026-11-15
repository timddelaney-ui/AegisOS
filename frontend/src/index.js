import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { RigProvider } from "./context/RigContext";
import { ActiveJobProvider } from "./context/ActiveJobContext";
import "./index.css";
import { hydrateKv, startFieldSync } from "./lib/fieldStore";
import { applyStoredTheme } from "./lib/cabinTheme";

applyStoredTheme();

const root = ReactDOM.createRoot(document.getElementById("root"));
const render = () => root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ActiveJobProvider>
        <RigProvider>
          <App />
        </RigProvider>
        </ActiveJobProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Restore IndexedDB snapshots into localStorage BEFORE first render so every
// useState initializer sees the last saved field state (cap the wait at 1.5 s).
Promise.race([hydrateKv(), new Promise((r) => setTimeout(r, 1500))]).finally(() => {
  render();
  startFieldSync();
});
