import {
    cancel,
    type OauthConfig,
    onUrl,
    start,
} from "@fabianlars/tauri-plugin-oauth";
import { openUrl } from "@tauri-apps/plugin-opener";

const LOOPBACK_TIMEOUT_MS = 300_000;

/** 浏览器回调页里用于唤起 App，与 `dailycent://` deep-link 前缀一致 */
const APP_OPEN_FROM_BROWSER_HREF = "dailycent://";

/**
 * OAuth 回环成功后返回给系统浏览器的 HTML（插件会把 OAuth 回调脚本插入 `<head>`；勿省略 `<head>` / `<body>`）。
 * 英文提示 + 可点的 scheme 链接 + 载入后自动触发点击以唤起 App。
 */
function oauthLoopbackSuccessResponseHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in successful</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;padding:1.5rem;line-height:1.6;max-width:36rem;margin:0 auto;color:#111;}
a{color:#0366d6;}
</style>
</head>
<body>
<p><strong>Sign-in successful.</strong></p>
<p>Please return to the Cent app to continue. If the app does not open automatically, use the link below.</p>
<p><a id="cent-open-app" href="${APP_OPEN_FROM_BROWSER_HREF}">Open Cent</a></p>
<script>
(function () {
  var el = document.getElementById("cent-open-app");
  if (el) {
    el.click();
  }
})();
</script>
</body>
</html>`;
}

function loopbackConfigFromEnv(): OauthConfig | undefined {
    const raw = import.meta.env.VITE_OAUTH_LOOPBACK_PORT;
    if (raw === undefined || raw === "") {
        return undefined;
    }
    const n = Number.parseInt(String(raw), 10);
    if (Number.isNaN(n)) {
        return undefined;
    }
    return { ports: [n] };
}

function isTrustedLoopbackCallback(url: string, expectedPort: number): boolean {
    try {
        const u = new URL(url);
        const hostOk = u.hostname === "127.0.0.1" || u.hostname === "localhost";
        const portOk = u.port === String(expectedPort);
        return hostOk && portOk;
    } catch {
        return false;
    }
}

export type TauriOAuthLoopbackResult = "success" | "fallback";

/**
 * 桌面端：临时监听 127.0.0.1，将 OAuth redirect_uri 指向本地 HTTP；失败则退回外链 + deeplink。
 */
export async function runTauriOAuthLoopback(options: {
    buildAuthorizeUrl: (loopbackRedirectUri: string) => string;
    onLoopbackUrl: (callbackUrl: string) => void;
    fallbackAuthorizeUrl: string;
}): Promise<TauriOAuthLoopbackResult> {
    const oauthConfig: OauthConfig = {
        ...loopbackConfigFromEnv(),
        response: oauthLoopbackSuccessResponseHtml(),
    };
    let port: number;
    try {
        port = await start(oauthConfig);
    } catch {
        await openUrl(options.fallbackAuthorizeUrl);
        return "fallback";
    }

    return await new Promise<TauriOAuthLoopbackResult>((resolve) => {
        let settled = false;
        let unlisten: (() => void) | undefined;
        const timer = window.setTimeout(() => {
            void finalize("fallback");
        }, LOOPBACK_TIMEOUT_MS);

        const finalize = async (result: TauriOAuthLoopbackResult) => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            try {
                unlisten?.();
            } catch {
                /* noop */
            }
            try {
                await cancel(port);
            } catch {
                /* noop */
            }
            if (result === "fallback") {
                await openUrl(options.fallbackAuthorizeUrl);
            }
            resolve(result);
        };

        void (async () => {
            try {
                unlisten = await onUrl((url) => {
                    if (!isTrustedLoopbackCallback(url, port)) {
                        return;
                    }
                    void (async () => {
                        try {
                            options.onLoopbackUrl(url);
                            await finalize("success");
                        } catch {
                            await finalize("fallback");
                        }
                    })();
                });
            } catch {
                await finalize("fallback");
                return;
            }

            const redirectUri = `http://127.0.0.1:${port}/`;
            try {
                await openUrl(options.buildAuthorizeUrl(redirectUri));
            } catch {
                await finalize("fallback");
            }
        })();
    });
}
