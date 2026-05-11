import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { isInApp } from "@/utils/platform";

export type WebOtaState = {
    active_version: string | null;
    previous_version: string | null;
    pending_version: string | null;
    trial_launches: number;
};

export type CheckOutcome =
    | { kind: "no_update" }
    | { kind: "skipped"; reason: string }
    | { kind: "downloaded"; web_version: string };

let started = false;

export const checkWebOta = async (): Promise<CheckOutcome> => {
    return invoke<CheckOutcome>("web_ota_check");
};

export const getWebOtaState = async (): Promise<WebOtaState> => {
    return invoke<WebOtaState>("web_ota_state");
};

const HEALTHY_DELAY_MS = 5000;
let healthyScheduled = false;

/**
 * After the app has rendered without crashing for HEALTHY_DELAY_MS, tell Rust
 * the current active web bundle is stable. If we never reach this call (e.g.
 * white screen, immediate throw), the trial counter increments next launch
 * and eventually triggers a rollback.
 */
export const scheduleMarkHealthy = (): void => {
    if (healthyScheduled || !isInApp) return;
    healthyScheduled = true;
    setTimeout(() => {
        invoke("web_ota_mark_healthy").catch((err) => {
            console.warn("[web-ota] mark_healthy failed", err);
        });
    }, HEALTHY_DELAY_MS);
};

const reportResult = (result: CheckOutcome) => {
    if (result.kind === "downloaded") {
        toast.success(`前端 ${result.web_version} 已下载`, {
            description: "下次启动应用时自动生效",
            duration: 8000,
        });
    } else if (result.kind === "skipped") {
        console.info("[web-ota] skipped:", result.reason);
    }
};

export const startWebOtaCheck = async (): Promise<void> => {
    if (started || !isInApp) return;
    started = true;
    try {
        const result = await checkWebOta();
        reportResult(result);
    } catch (err) {
        console.warn("[web-ota] check failed", err);
    }
};

/** Manual check from settings UI — surfaces "no update" too. */
export const runWebOtaCheck = async (): Promise<CheckOutcome | null> => {
    if (!isInApp) return null;
    try {
        const result = await checkWebOta();
        reportResult(result);
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`前端更新检查失败：${message}`);
        return null;
    }
};
