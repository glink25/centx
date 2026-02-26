import { isInApp } from "@/utils/platform";

/**
 * 注册 Tauri deep-link / universal link 监听
 * 仅在 Tauri 环境中生效，收到链接时派发 tauri-deep-link 自定义事件，由 useUrlHandler 等消费
 */
export function registerDeepLink(): void {
    if (!isInApp) {
        return;
    }
    import("@tauri-apps/plugin-deep-link")
        .then(({ onOpenUrl }) => {
            onOpenUrl((urls) => {
                const url = urls?.[0];
                if (url) {
                    window.dispatchEvent(
                        new CustomEvent("tauri-deep-link", { detail: url }),
                    );
                }
            });
        })
        .catch((err) => {
            console.warn("[deep-link] 注册失败:", err);
        });
}
