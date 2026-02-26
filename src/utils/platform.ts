export const isInApp = !!(window as any).__TAURI__;

export const openOAuthLink = (url: string) => {
    if (!isInApp) {
        window.open(url, "_self");
        return;
    }
};
