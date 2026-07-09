import { mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, {
	test: {
		environment: "jsdom",
		setupFiles: ["./vitest.setup.ts"],
	},
});
