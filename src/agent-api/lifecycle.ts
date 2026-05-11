import { invoke } from "@tauri-apps/api/core";
import { useAgentApiStore } from "@/store/agent-api";
import { isInApp } from "@/utils/platform";
import { startAgentApiBridge } from "./bridge";

export type AgentApiStatus = {
    running: boolean;
    port: number;
    url: string;
};

let supportedCache: boolean | null = null;

export async function isAgentApiSupported(): Promise<boolean> {
    if (!isInApp) return false;
    if (supportedCache !== null) return supportedCache;
    try {
        supportedCache = await invoke<boolean>("agent_api_supported");
    } catch {
        supportedCache = false;
    }
    return supportedCache;
}

export async function startAgentApi(
    token: string,
    port?: number,
): Promise<AgentApiStatus> {
    const status = await invoke<AgentApiStatus>("agent_api_start", {
        port,
        token,
    });
    useAgentApiStore.setState({ port: status.port });
    return status;
}

export async function stopAgentApi(): Promise<void> {
    await invoke("agent_api_stop");
}

export async function getAgentApiStatus(): Promise<AgentApiStatus> {
    return await invoke<AgentApiStatus>("agent_api_status");
}

export async function bootAgentApi() {
    if (!(await isAgentApiSupported())) return;
    await startAgentApiBridge();
    const { enabled, token, port } = useAgentApiStore.getState();
    if (enabled && token) {
        try {
            await startAgentApi(token, port);
        } catch (e) {
            console.error("[agent-api] auto-start failed", e);
        }
    }
}
