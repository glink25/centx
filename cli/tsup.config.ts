import { resolve } from "node:path";
import { defineConfig } from "tsup";

const repoRoot = resolve(__dirname, "..");

export default defineConfig({
    entry: ["bin/cent-cli.ts"],
    outDir: "dist/bin",
    format: ["esm"],
    target: "node18",
    platform: "node",
    splitting: false,
    sourcemap: true,
    clean: true,
    shims: false,
    treeshake: true,
    banner: {
        js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
    },
    define: {
        "import.meta.env.VITE_LOGIN_API_HOST": JSON.stringify(""),
    },
    esbuildOptions(opts) {
        opts.alias = {
            ...(opts.alias ?? {}),
            "@": resolve(repoRoot, "src"),
            "@cli": resolve(__dirname, "src"),
            "@/components/modal": resolve(__dirname, "src/modal/index.ts"),
            "@/locale": resolve(__dirname, "src/shims/locale.ts"),
            "@/database/storage": resolve(__dirname, "src/shims/storage.ts"),
            uuid: resolve(__dirname, "src/shims/uuid.ts"),
        };
        opts.conditions = ["node", "import", "default"];
        // SKILL.md is bundled into the CLI as a string so `install-skill` works
        // from a fresh `npx -y cent-cli` with no extra files. See src/skill/content.ts.
        opts.loader = {
            ...(opts.loader ?? {}),
            ".md": "text",
        };
    },
    // Web src/ uses extensionless `dayjs/plugin/X` imports, which Node ESM
    // can't resolve since `dayjs`'s package.json doesn't expose them via
    // its `exports` map. Inline dayjs (+ plugins) so esbuild handles the
    // resolution at build time.
    noExternal: [/^dayjs(\/.*)?$/],
});
