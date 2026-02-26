import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { buildSync } from "esbuild";
import Info from "unplugin-info/vite";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { analyzer } from "vite-bundle-analyzer";
import { createHtmlPlugin } from "vite-plugin-html";
import { VitePWA } from "vite-plugin-pwa";
import svgr from "vite-plugin-svgr";

const isTauri = process.env.TAURI_VITE === "1";
const tauriDevHost = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());

    const shouldAnalyze = process.env.ANALYZE === "true";

    const plugins: PluginOption[] = [
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
        resolve: {
            alias: {
                "@": resolve("./src"),
            },
        },
        worker: {
            format: "es",
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
