export const isInApp = !!(window as any).__TAURI__;

/** 在浏览器内用 _self 跳转，在 App 内用系统浏览器打开（OAuth 完成后通过 deep-link 回到 App） */
export const openOAuthLink = (url: string): void => {
    if (!isInApp) {
        window.open(url, "_self");
        return;
    }
    import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
        openUrl(url);
    });
};
