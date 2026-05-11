import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    type AgentApiStatus,
    getAgentApiStatus,
    isAgentApiSupported,
    startAgentApi,
    stopAgentApi,
} from "@/agent-api/lifecycle";
import { buildAgentPrompt } from "@/agent-api/prompt";
import PopupLayout from "@/layouts/popup-layout";
import { useIntl } from "@/locale";
import { generateAgentApiToken, useAgentApiStore } from "@/store/agent-api";
import { cn } from "@/utils";
import { copyTextToClipboard } from "@/utils/clipboard";
import createConfirmProvider from "../confirm";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

function Form({ onCancel }: { onCancel?: () => void }) {
    const t = useIntl();
    const { enabled, token, port } = useAgentApiStore();
    const [status, setStatus] = useState<AgentApiStatus>({
        running: false,
        port,
        url: "",
    });
    const [showToken, setShowToken] = useState(false);
    const [busy, setBusy] = useState(false);

    const refreshStatus = useCallback(async () => {
        try {
            const s = await getAgentApiStatus();
            setStatus(s);
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    const url = status.running ? status.url : `http://127.0.0.1:${port}`;

    const handleToggle = useCallback(
        async (next: boolean) => {
            if (busy) return;
            setBusy(true);
            try {
                if (next) {
                    let tk = token;
                    if (!tk) {
                        tk = generateAgentApiToken();
                        useAgentApiStore.setState({ token: tk });
                    }
                    const s = await startAgentApi(tk, port);
                    useAgentApiStore.setState({ enabled: true });
                    setStatus(s);
                } else {
                    await stopAgentApi();
                    useAgentApiStore.setState({ enabled: false });
                    await refreshStatus();
                }
            } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [busy, token, port, refreshStatus],
    );

    const handleRotateAndCopy = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const tk = generateAgentApiToken();
            useAgentApiStore.setState({ token: tk, enabled: true });
            // Restart with new token; always read latest port from store to
            // avoid stale closures after the server fell back to another port.
            const currentPort = useAgentApiStore.getState().port;
            const s = await startAgentApi(tk, currentPort);
            setStatus(s);
            const prompt = buildAgentPrompt(s.url, tk);
            await copyTextToClipboard(prompt);
            toast.success(t("agent-api-prompt-copied"));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [busy, t]);

    const handleCopyToken = useCallback(async () => {
        if (!token) return;
        await copyTextToClipboard(token);
        toast.success(t("agent-api-token-copied"));
    }, [token, t]);

    const handleCopyUrl = useCallback(async () => {
        await copyTextToClipboard(url);
        toast.success(t("agent-api-url-copied"));
    }, [url, t]);

    const maskedToken = token
        ? `${"•".repeat(Math.max(0, token.length - 6))}${token.slice(-6)}`
        : "";

    return (
        <PopupLayout
            title={t("agent-api")}
            onBack={onCancel}
            className="h-full overflow-hidden"
        >
            <div className="flex-1 flex flex-col gap-4 px-4 py-4 overflow-y-auto">
                <div className="text-xs opacity-70">
                    {t("agent-api-description")}
                </div>

                <div className="flex items-center justify-between border rounded-md px-3 py-2">
                    <div className="flex flex-col">
                        <div className="text-sm font-medium">
                            {t("agent-api-enable")}
                        </div>
                        <div className="text-xs opacity-60">
                            {status.running
                                ? t("agent-api-status-running")
                                : t("agent-api-status-stopped")}
                        </div>
                    </div>
                    <Switch
                        checked={enabled}
                        disabled={busy}
                        onCheckedChange={handleToggle}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <div className="text-sm py-1">
                        {t("agent-api-server-url")}
                    </div>
                    <div className="flex items-center gap-2">
                        <div
                            className={cn(
                                "flex-1 px-2 py-1 border rounded text-xs font-mono break-all",
                                !status.running && "opacity-50",
                            )}
                        >
                            {url}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCopyUrl}
                        >
                            <i className="icon-[mdi--content-copy] size-4"></i>
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <div className="text-sm py-1">{t("agent-api-token")}</div>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 px-2 py-1 border rounded text-xs font-mono break-all">
                            {token
                                ? showToken
                                    ? token
                                    : maskedToken
                                : t("agent-api-no-token")}
                        </div>
                        {token && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowToken((v) => !v)}
                            >
                                <i
                                    className={cn(
                                        "size-4",
                                        showToken
                                            ? "icon-[mdi--eye-off]"
                                            : "icon-[mdi--eye]",
                                    )}
                                ></i>
                            </Button>
                        )}
                        {token && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyToken}
                            >
                                <i className="icon-[mdi--content-copy] size-4"></i>
                            </Button>
                        )}
                    </div>
                </div>

                <Button
                    variant="default"
                    onClick={handleRotateAndCopy}
                    disabled={busy}
                >
                    <i className="icon-[mdi--key-plus] size-4 mr-1"></i>
                    {t("agent-api-rotate-and-copy")}
                </Button>

                <div className="text-xs opacity-60">
                    {t("agent-api-warning-localhost")}
                </div>
            </div>
        </PopupLayout>
    );
}

const [AgentApiProvider, showAgentApi] = createConfirmProvider(Form, {
    dialogTitle: "agent-api",
    dialogModalClose: true,
    contentClassName:
        "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[55vh] sm:w-[90vw] sm:max-w-[500px]",
});

export default function AgentApiSettingsItem() {
    const t = useIntl();
    const [supported, setSupported] = useState<boolean | null>(null);

    useEffect(() => {
        isAgentApiSupported().then(setSupported);
    }, []);

    if (supported === false) return null;

    return (
        <div className="agent-api">
            <Button
                onClick={() => showAgentApi()}
                variant="ghost"
                className="w-full py-4 rounded-none h-auto"
                disabled={supported === null}
            >
                <div className="w-full px-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <i className="icon-[mdi--api] size-5"></i>
                        {t("agent-api")}
                    </div>
                    <i className="icon-[mdi--chevron-right] size-5"></i>
                </div>
            </Button>
            <AgentApiProvider />
        </div>
    );
}
