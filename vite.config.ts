import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";

const basePath = process.env.VITE_BASE_PATH || process.env.APP_BASE_PATH || "/email/";

export default defineConfig({
	base: basePath,
	plugins: [react(), tailwind()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/web"),
		},
	},
	server: {
		allowedHosts: true,
	}
});
