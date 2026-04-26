import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "./styles.css";
import App from "./app.tsx";
import { ROUTER_BASE } from "./lib/path";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Router base={ROUTER_BASE}>
			<App />
		</Router>
	</StrictMode>,
);
