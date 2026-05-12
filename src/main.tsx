import "./utils/shim";
import "@/utils/fetch-proxy";

import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

import Login from "./components/login";
import { initIntl, LocaleProvider } from "./locale/index";
import { usePreferenceStore } from "./store/preference";
import { registerDeepLink } from "./utils/deep-link";
import { register as registerLaunchQueue } from "./utils/launch-queue";
import { lazyWithReload } from "./utils/lazy";
import { isInApp } from "./utils/platform";

const Rooot = lazyWithReload(() => import("./route"));

const isMacOSApp =
    isInApp && /Mac/i.test(navigator.platform || navigator.userAgent);
if (isMacOSApp) {
    document.documentElement.classList.add("is-macos-app");
}

const lang = usePreferenceStore.getState().locale;
initIntl(lang).then(() => {
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <LocaleProvider>
                {isMacOSApp && (
                    <div
                        data-tauri-drag-region
                        className="fixed top-0 left-0 right-0 h-[var(--titlebar-height)] z-[9999] pointer-events-auto"
                    />
                )}
                <Suspense>
                    <Rooot />
                </Suspense>
                <Login />
            </LocaleProvider>
        </StrictMode>,
    );
});

registerLaunchQueue();
registerDeepLink();

import("./agent-api/lifecycle").then(({ bootAgentApi }) => {
    void bootAgentApi();
});

import("./lib/updater/native").then(({ startNativeUpdateCheck }) => {
    void startNativeUpdateCheck();
});

import("./lib/updater/web").then(
    ({ startWebOtaCheck, scheduleMarkHealthy }) => {
        scheduleMarkHealthy();
        void startWebOtaCheck();
    },
);
