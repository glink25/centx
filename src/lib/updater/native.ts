import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { isInApp } from "@/utils/platform";

let started = false;
let pending: Update | null = null;

export const getPendingNativeUpdate = (): Update | null => pending;

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

export const startNativeUpdateCheck = async (
    opts: { silent?: boolean } = {},
): Promise<void> => {
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

    pending = update;
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
        pending = null;
        return;
    }

    progress?.dismiss();
    showReadyToast(update);
};
