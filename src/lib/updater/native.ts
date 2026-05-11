import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { usePreferenceStore } from "@/store/preference";
import { isInApp } from "@/utils/platform";

let started = false;
let pending: Update | null = null;
const listeners = new Set<(u: Update | null) => void>();

export const getPendingNativeUpdate = (): Update | null => pending;

export const subscribeNativeUpdate = (
    cb: (u: Update | null) => void,
): (() => void) => {
    listeners.add(cb);
    cb(pending);
    return () => {
        listeners.delete(cb);
    };
};

const setPending = (next: Update | null) => {
    pending = next;
    listeners.forEach((cb) => {
        try {
            cb(pending);
        } catch {}
    });
};

export const installPendingNativeUpdate = async (): Promise<void> => {
    if (!pending) return;
    try {
        await pending.install();
    } finally {
        await relaunch();
    }
};

const showReadyToast = (update: Update) => {
    toast.success(`新版本 ${update.version} 已下载`, {
        description: "重启应用以完成更新",
        duration: Number.POSITIVE_INFINITY,
        action: {
            label: "立即重启",
            onClick: () => {
                void installPendingNativeUpdate();
            },
        },
    });
};

const showProgressToast = (update: Update) => {
    const id = toast.loading(`正在下载新版本 ${update.version}…`, {
        duration: Number.POSITIVE_INFINITY,
    });
    return {
        update(percent: number) {
            toast.loading(`正在下载新版本 ${update.version}… ${percent}%`, {
                id,
                duration: Number.POSITIVE_INFINITY,
            });
        },
        dismiss() {
            toast.dismiss(id);
        },
    };
};

const downloadUpdate = async (
    update: Update,
    opts: { silent?: boolean },
): Promise<boolean> => {
    setPending(update);
    const progress = opts.silent ? null : showProgressToast(update);
    let total = 0;
    let received = 0;

    try {
        await update.download((event) => {
            if (event.event === "Started") {
                total = event.data.contentLength ?? 0;
                received = 0;
            } else if (event.event === "Progress") {
                received += event.data.chunkLength;
                if (progress && total > 0) {
                    progress.update(
                        Math.min(99, Math.floor((received / total) * 100)),
                    );
                }
            }
        });
    } catch (err) {
        progress?.dismiss();
        console.warn("[updater] download failed", err);
        setPending(null);
        return false;
    }

    progress?.dismiss();
    return true;
};

export type NativeCheckResult =
    | { kind: "no-update" }
    | { kind: "downloaded"; version: string }
    | { kind: "installed" }
    | { kind: "error"; message: string };

/** Manual check entry — used by settings UI. Always shows toasts. */
export const runNativeUpdateCheck = async (): Promise<NativeCheckResult> => {
    if (!isInApp) return { kind: "no-update" };
    let update: Update | null = null;
    try {
        update = await check();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "error", message };
    }
    if (!update) return { kind: "no-update" };

    const ok = await downloadUpdate(update, { silent: false });
    if (!ok) {
        return { kind: "error", message: "download failed" };
    }

    if (usePreferenceStore.getState().autoRestartOnUpdate) {
        await installPendingNativeUpdate();
        return { kind: "installed" };
    }
    showReadyToast(update);
    return { kind: "downloaded", version: update.version };
};

/** Background check on startup. */
export const startNativeUpdateCheck = async (): Promise<void> => {
    if (started || !isInApp) return;
    started = true;

    let update: Update | null = null;
    try {
        update = await check();
    } catch (err) {
        console.warn("[updater] check failed", err);
        return;
    }
    if (!update) return;

    const ok = await downloadUpdate(update, { silent: true });
    if (!ok) return;

    if (usePreferenceStore.getState().autoRestartOnUpdate) {
        await installPendingNativeUpdate();
        return;
    }
    showReadyToast(update);
};
