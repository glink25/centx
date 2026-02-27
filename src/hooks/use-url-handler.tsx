import { useEffect } from "react";
import { toast } from "sonner";
import { xmlTextToBills } from "@/components/assistant/text-to-bill";
import { useIntl } from "@/locale";
import { useLedgerStore } from "@/store/ledger";

/**
 * 处理通过 URL 进入的逻辑（标准 URL 启动 或 Tauri deep-link 传入的 URL）
 * 支持格式: .../add-bills?text=xxx 或 .../open/add-bills?text=xxx（deep-link 会带 /open 前缀）
 */
async function processIncomingUrl(
    urlString: string,
    t: ReturnType<typeof useIntl>,
) {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        return;
    }
    let pathname = url.pathname;
    // deep-link 可能为 /open/xxx，统一去掉 /open 前缀
    if (pathname.startsWith("/open")) {
        pathname = pathname.slice("/open".length) || "/";
    }
    const searchParams = url.searchParams;

    // App 内 OAuth 回调（通过 deep-link 回到应用）：与 index.html 一致，写入 _oauth_res 后刷新到首页，由 afterLogin 解析 token
    if (pathname === "/oauth-callback" || pathname === "/oauth-callback/") {
        if (searchParams.has("github_authorized")) {
            localStorage.setItem(
                "_oauth_res",
                JSON.stringify({ type: "github", url: urlString }),
            );
            localStorage.setItem("SYNC_ENDPOINT", "github");
            setTimeout(() => location.replace(window.origin), 1);
            return;
        }
        if (searchParams.has("gitee_authorized")) {
            localStorage.setItem(
                "_oauth_res",
                JSON.stringify({ type: "gitee", url: urlString }),
            );
            localStorage.setItem("SYNC_ENDPOINT", "gitee");
            setTimeout(() => location.replace(window.origin), 1);
            return;
        }
    }

    if (pathname === "/add-bills" || pathname === "/add-bills/") {
        const text = decodeURIComponent(searchParams.get("text") ?? "");
        if (typeof window !== "undefined") {
            window.history.replaceState({}, "", "/");
        }
        if (text) {
            try {
                const bills = await xmlTextToBills(text);
                if (bills.length > 0) {
                    await useLedgerStore.getState().addBills(bills);
                    toast.success(
                        t("voice-add-success", { count: bills.length }),
                    );
                } else {
                    toast.error(t("voice-recognition-failed", { error: "" }));
                }
            } catch (error) {
                console.error("处理 URL 参数失败:", error);
                toast.error(
                    t("voice-recognition-failed", {
                        error: error instanceof Error ? error.message : "",
                    }),
                );
            }
        }
    }
}

/**
 * 处理标准 URL 链接唤起（含 Tauri deep-link 事件）
 * 支持格式: https://cent.linkai.work/open/... 或 dailycent://open/...（全平台统一 scheme 降级）
 */
export function useUrlHandler() {
    const t = useIntl();

    useEffect(() => {
        const run = (urlString: string) => processIncomingUrl(urlString, t);

        // 启动时按当前页面 URL 处理一次
        run(window.location.href);

        // Tauri deep-link：监听由 utils/deep-link 派发的事件
        const onDeepLink = (e: Event) => {
            const url = (e as CustomEvent<string>).detail;
            if (url) run(url);
        };
        window.addEventListener("tauri-deep-link", onDeepLink);
        return () => window.removeEventListener("tauri-deep-link", onDeepLink);
    }, [t]);
}
