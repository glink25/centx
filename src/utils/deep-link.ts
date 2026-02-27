import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { toast } from "sonner";
import { isInApp } from "@/utils/platform";

/** 全平台统一的 URL scheme，用于 Universal Link 降级（仅通过 url-scheme 即可打开 App） */
export const DAILYCENT_SCHEME = "dailycent";

/** Universal Link 域名 + /open 前缀，与 DEEP_LINK_SERVER.md 及 tauri.conf 一致 */
const CENT_OPEN_PREFIX = "https://cent.linkai.work/open";

/**
 * 将 Universal Link 或路径转为 dailycent:// 降级链接，供不支持 Universal Link 的环境（如部分浏览器、微信内）使用
 * @param urlOrPath - 完整 Universal Link（如 https://cent.linkai.work/open/add-bills?text=1）或路径（如 /open/add-bills 或 /add-bills）
 * @returns dailycent://open/... 形式，可直接用于 a[href] 或 location 唤起 App
 */
export function toDailyCentDeepLink(urlOrPath: string): string {
    const s = urlOrPath.trim();
    if (!s) return `${DAILYCENT_SCHEME}://open/`;
    if (s.startsWith(CENT_OPEN_PREFIX)) {
        const rest = s.slice(CENT_OPEN_PREFIX.length) || "/";
        return `${DAILYCENT_SCHEME}://open${rest.startsWith("/") ? rest : "/" + rest}`;
    }
    if (s.startsWith("/open")) {
        return `${DAILYCENT_SCHEME}://open${s.slice(4) || "/"}`;
    }
    if (s.startsWith("/")) {
        return `${DAILYCENT_SCHEME}://open${s}`;
    }
    try {
        const u = new URL(s);
        if (
            u.origin === "https://cent.linkai.work" &&
            u.pathname.startsWith("/open")
        ) {
            return `${DAILYCENT_SCHEME}://open${u.pathname.slice(4) || "/"}${u.search}`;
        }
    } catch {
        // 非 URL，当作路径
    }
    return `${DAILYCENT_SCHEME}://open/${s}`;
}

/**
 * 注册 Tauri deep-link / universal link 监听
 * 仅在 Tauri 环境中生效，收到链接时派发 tauri-deep-link 自定义事件，由 useUrlHandler 等消费
 */
export function registerDeepLink(): void {
    if (!isInApp) {
        return;
    }
    console.log("registerDeepLink");
    onOpenUrl((urls) => {
        console.log("urls", urls);
        const url = urls?.[0];
        if (url) {
            window.dispatchEvent(
                new CustomEvent("tauri-deep-link", { detail: url }),
            );
        }
    });
}
