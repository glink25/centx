import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { relayrMiddleware } from "./relayr-middleware";

// 保存原始 fetch
const originalFetch = self.fetch.bind(self);

export type Handler = (
    url: RequestInfo | URL,
    options: RequestInit,
    next: typeof originalFetch,
) => Promise<Response>;

// 存储所有已注册的代理（按顺序执行）
const proxyHandlers: Handler[] = [];

/**
 * 注册一个 fetch 代理
 * @param handler 代理函数，接收 (url, options, next)
 * @returns dispose() 函数，用于移除该代理
 */
function registerProxy(handler: Handler) {
    proxyHandlers.push(handler);
    console.log(
        `[fetch-proxy] registered proxy, total = ${proxyHandlers.length}`,
    );

    // 返回取消注册函数
    return () => {
        const index = proxyHandlers.indexOf(handler);
        if (index !== -1) {
            proxyHandlers.splice(index, 1);
            console.log(
                `[fetch-proxy] proxy removed, total = ${proxyHandlers.length}`,
            );
        }
    };
}

// 组合代理链：像中间件一样层层包裹
function composeFetchChain(
    handlers: Handler[],
    baseFetch: typeof originalFetch,
) {
    return handlers.reduceRight(
        (next, handler) => (url, options) => handler(url, options, next as any),
        baseFetch,
    );
}

const isSafariFamily = () => {
    const ua = navigator.userAgent.toLowerCase();
    // 核心逻辑：包含 applewebkit 但不包含 chrome 或 chromium
    return (
        ua.includes("applewebkit") &&
        !ua.includes("chrome") &&
        !ua.includes("chromium")
    );
};
const isSafari = isSafariFamily();
// 替换全局 fetch
self.fetch = async (url: RequestInfo | URL, options: RequestInit = {}) => {
    // 由于webview实现差异，在iOS中 tauri-plugin-cors-fetch可以正常工作，但在Android中不行，需要使用http插件代替
    // 但是如果在iOS中也使用http插件替换原生fetch，则会导致页面卡死，所以必须分开处理
    const fetcher = isSafari ? originalFetch : tauriFetch;
    if (proxyHandlers.length === 0) {
        return fetcher(url, options);
    }

    const composed = composeFetchChain(proxyHandlers, fetcher);
    return (composed as any)(url, options);
};

// 注册中间件
registerProxy(relayrMiddleware);

// 导出 registerProxy
export { registerProxy };
