import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { buildSync } from "esbuild";
import Info from "unplugin-info/vite";
import { defineConfig, loadEnv, type Plugin, type PluginOption } from "vite";
import { analyzer } from "vite-bundle-analyzer";
import { createHtmlPlugin } from "vite-plugin-html";
import { VitePWA } from "vite-plugin-pwa";
import svgr from "vite-plugin-svgr";

const isTauri = process.env.TAURI_VITE === "1";
const tauriDevHost = process.env.TAURI_DEV_HOST;

/** jieba-wasm 未导出 .wasm；且 worker 子打包不会套用 resolve.alias，故用插件统一解析（含 ?url） */
const JIEBA_RS_WASM_BG = "jieba-rs-wasm-bg";
function jiebaRsWasmBgResolve(): Plugin {
    const wasmAbs = resolve(
        "./node_modules/jieba-wasm/pkg/web/jieba_rs_wasm_bg.wasm",
    );
    return {
        name: "jieba-rs-wasm-bg-resolve",
        enforce: "pre",
        resolveId(id) {
            if (
                id === JIEBA_RS_WASM_BG ||
                id.startsWith(`${JIEBA_RS_WASM_BG}?`)
            ) {
                return `${wasmAbs}${id.slice(JIEBA_RS_WASM_BG.length)}`;
            }
        },
    };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());

    const shouldAnalyze = process.env.ANALYZE === "true";

    const plugins: PluginOption[] = [
        jiebaRsWasmBgResolve(),
        Info(),
        createHtmlPlugin({
            inject: {
                data: {
                    VITE_GTAG_SCRIPT: env.VITE_GTAG_SCRIPT || "",
                    injectPresetScript: buildSync({
                        entryPoints: ["src/inline/load-preset.ts"],
                        bundle: true,
                        minify: true,
                        write: false,
                        format: "iife",
                    }).outputFiles[0].text,
                },
            },
        }),
        react(),
        svgr(),
        tailwindcss(),
        // Tauri 桌面端不需要 PWA
        ...(isTauri
            ? []
            : [
                  VitePWA({
                      strategies: "injectManifest",
                      srcDir: "src",
                      filename: "sw.ts",
                      registerType: "autoUpdate",
                      injectRegister: "auto",
                      includeAssets: ["favicon.ico", "apple-touch-icon.png"],
                      manifest: {
                          name: "Cent - 日计",
                          short_name: "Cent",
                          description: "Accounting your life - 记录每一天",
                          theme_color: "#ffffff",
                          icons: [
                              {
                                  src: "icon.png",
                                  sizes: "192x192",
                                  type: "image/png",
                              },
                              {
                                  src: "icon.png",
                                  sizes: "512x512",
                                  type: "image/png",
                              },
                          ],
                          protocol_handlers: [
                              {
                                  protocol: "cent-accounting",
                                  url: "/add-bills?text=%s",
                                  client_mode: "focus-existing",
                              } as any,
                          ],
                          launch_handler: {
                              client_mode: ["navigate-existing", "auto"],
                          },
                      },
                  }),
              ]),
    ];

    if (shouldAnalyze) {
        plugins.push(analyzer());
    }

    const baseServer = {
        proxy: {
            "/google-api": {
                target: "https://generativelanguage.googleapis.com",
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/google-api/, ""),
            },
        },
    };

    return {
        plugins,
        build: {
            rollupOptions: {
                output: {
                    manualChunks: (id) => {
                        if (id.includes("zod")) {
                            return "zod";
                        }
                        if (id.includes("@dnd-kit")) {
                            return "dndkit";
                        }
                        if (id.includes("echarts")) {
                            return "echarts";
                        }
                        if (id.includes("react-day-picker")) {
                            return "reactDayPicker";
                        }
                    },
                },
            },
        },
        resolve: {
            alias: {
                "@": resolve("./src"),
            },
        },
        worker: {
            format: "es",
            plugins: () => [jiebaRsWasmBgResolve()],
        },
        // Tauri 开发/构建时使用固定端口与 HMR，并保留原有 proxy
        ...(isTauri
            ? {
                  clearScreen: false,
                  server: {
                      ...baseServer,
                      port: 1420,
                      strictPort: true,
                      host: tauriDevHost || false,
                      hmr: tauriDevHost
                          ? {
                                protocol: "ws",
                                host: tauriDevHost,
                                port: 1421,
                            }
                          : undefined,
                      watch: {
                          ignored: ["**/src-tauri/**"],
                      },
                  },
              }
            : { server: baseServer }),
    };
});
