import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import PopupLayout from "@/layouts/popup-layout";
import {
    installPendingNativeUpdate,
    runNativeUpdateCheck,
    subscribeNativeUpdate,
} from "@/lib/updater/native";
import {
    getWebOtaState,
    runWebOtaCheck,
    type WebOtaState,
} from "@/lib/updater/web";
import { useIntl } from "@/locale";
import { usePreference } from "@/store/preference";
import { isInApp } from "@/utils/platform";
import createConfirmProvider from "../confirm";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

function Form({ onCancel }: { onCancel?: () => void }) {
    const t = useIntl();
    const [autoRestart, setAutoRestart] = usePreference("autoRestartOnUpdate");
    const [nativeVersion, setNativeVersion] = useState<string>("");
    const [webState, setWebState] = useState<WebOtaState | null>(null);
    const [checkingNative, setCheckingNative] = useState(false);
    const [checkingWeb, setCheckingWeb] = useState(false);
    const [hasNativePending, setHasNativePending] = useState(false);

    useEffect(() => {
        if (!isInApp) return;
        getVersion()
            .then(setNativeVersion)
            .catch(() => {});
        getWebOtaState()
            .then(setWebState)
            .catch(() => {});
        const off = subscribeNativeUpdate((u) => setHasNativePending(!!u));
        return off;
    }, []);

    const refreshWebState = () =>
        getWebOtaState()
            .then(setWebState)
            .catch(() => {});

    const onCheckNative = async () => {
        setCheckingNative(true);
        try {
            await runNativeUpdateCheck();
        } finally {
            setCheckingNative(false);
        }
    };

    const onCheckWeb = async () => {
        setCheckingWeb(true);
        try {
            await runWebOtaCheck();
            await refreshWebState();
        } finally {
            setCheckingWeb(false);
        }
    };

    return (
        <PopupLayout
            title={t("app-update")}
            onBack={onCancel}
            className="h-full overflow-hidden"
        >
            <div className="flex-1 flex flex-col overflow-y-auto py-4 gap-4">
                <div className="flex flex-col divide-y">
                    <div className="w-full min-h-10 pb-2 flex justify-between items-center px-4 pt-2">
                        <div className="text-sm">
                            <div>{t("native-version")}</div>
                            <div className="text-xs opacity-60">
                                {nativeVersion || "—"}
                            </div>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onCheckNative}
                            disabled={checkingNative}
                        >
                            {checkingNative
                                ? t("checking")
                                : t("check-updates")}
                        </Button>
                    </div>
                    {hasNativePending && (
                        <div className="w-full pb-2 px-4 pt-2 flex justify-between items-center bg-amber-50 dark:bg-amber-950/30">
                            <div className="text-xs opacity-80">
                                {t("pending-version")}
                            </div>
                            <Button
                                size="sm"
                                onClick={() => {
                                    void installPendingNativeUpdate();
                                }}
                            >
                                {t("restart-now")}
                            </Button>
                        </div>
                    )}
                    <div className="w-full min-h-10 pb-2 flex justify-between items-center px-4 pt-2">
                        <div className="text-sm">
                            <div>{t("web-version")}</div>
                            <div className="text-xs opacity-60">
                                {webState?.active_version ?? "—"}
                                {webState && webState.trial_launches > 0 && (
                                    <span
                                        className="ml-2 text-amber-600"
                                        title={t("trial-running-tip")}
                                    >
                                        ({t("trial-running")}{" "}
                                        {webState.trial_launches}/3)
                                    </span>
                                )}
                            </div>
                            {webState?.previous_version && (
                                <div className="text-xs opacity-60">
                                    {t("previous-version")}:{" "}
                                    {webState.previous_version}
                                </div>
                            )}
                            {webState?.pending_version && (
                                <div className="text-xs text-amber-600">
                                    {t("pending-version")}:{" "}
                                    {webState.pending_version}
                                </div>
                            )}
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onCheckWeb}
                            disabled={checkingWeb}
                        >
                            {checkingWeb ? t("checking") : t("check-updates")}
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col divide-y">
                    <div className="w-full min-h-10 pb-2 flex justify-between items-center px-4 pt-2">
                        <div className="text-sm">
                            <div>{t("auto-restart-on-update")}</div>
                            <div className="text-xs opacity-60">
                                {t("auto-restart-on-update-tip")}
                            </div>
                        </div>
                        <Switch
                            checked={!!autoRestart}
                            onCheckedChange={setAutoRestart}
                        />
                    </div>
                </div>
            </div>
        </PopupLayout>
    );
}

const [UpdateSettingsProvider, showUpdateSettings] = createConfirmProvider(
    Form,
    {
        dialogTitle: "app-update",
        dialogModalClose: true,
        contentClassName:
            "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[55vh] sm:w-[90vw] sm:max-w-[500px]",
    },
);

export default function UpdateSettingsItem() {
    const t = useIntl();
    if (!isInApp) return null;
    return (
        <div className="update">
            <Button
                onClick={() => {
                    showUpdateSettings();
                }}
                variant="ghost"
                className="w-full py-4 rounded-none h-auto"
            >
                <div className="w-full px-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <i className="icon-[mdi--cloud-download-outline] size-5"></i>
                        {t("app-update")}
                    </div>
                    <i className="icon-[mdi--chevron-right] size-5"></i>
                </div>
            </Button>
            <UpdateSettingsProvider />
        </div>
    );
}
