import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { CentAIConfig } from "@/components/assistant/tools";
import { useAgentApiStore } from "@/store/agent-api";
import { buildSkillMarkdown, buildToolList } from "./skill";

type AgentApiStatus = { running: boolean; port: number; url: string };

async function currentSkillContext() {
    let url = "";
    try {
        const s = await invoke<AgentApiStatus>("agent_api_status");
        if (s.running && s.url) url = s.url;
        else if (s.port) url = `http://127.0.0.1:${s.port}`;
    } catch {
        /* fall through */
    }
    if (!url) {
        const { port } = useAgentApiStore.getState();
        url = `http://127.0.0.1:${port}`;
    }
    const token = useAgentApiStore.getState().token ?? "";
    return { url, token };
}

type IncomingRequest = {
    request_id: string;
    kind: "tool" | "skill" | "list";
    tool_name?: string;
    args?: unknown;
};

let unlisten: UnlistenFn | null = null;

async function respond(
    requestId: string,
    ok: boolean,
    data: unknown,
    error?: string,
) {
    await invoke("agent_api_respond", {
        requestId,
        ok,
        data: data ?? null,
        error: error ?? null,
    });
}

async function handle(req: IncomingRequest) {
    const { request_id, kind } = req;
    try {
        if (kind === "skill") {
            const ctx = await currentSkillContext();
            const md = buildSkillMarkdown(CentAIConfig.tools, ctx);
            await respond(request_id, true, {
                content: md,
                content_type: "text/markdown; charset=utf-8",
            });
            return;
        }
        if (kind === "list") {
            await respond(request_id, true, {
                tools: buildToolList(CentAIConfig.tools),
            });
            return;
        }
        if (kind === "tool") {
            const tool = CentAIConfig.tools.find(
                (t) => t.name === req.tool_name,
            );
            if (!tool) {
                await respond(
                    request_id,
                    false,
                    null,
                    `Tool not found: ${req.tool_name}`,
                );
                return;
            }
            let parsed: unknown = req.args;
            if (tool.argSchema) {
                const r = tool.argSchema.safeParse(req.args ?? {});
                if (!r.success) {
                    await respond(
                        request_id,
                        false,
                        null,
                        `Invalid args: ${JSON.stringify(r.error)}`,
                    );
                    return;
                }
                parsed = r.data;
            }
            const out = await tool.handler(parsed as never, { history: [] });
            await respond(request_id, true, out ?? null);
            return;
        }
        await respond(request_id, false, null, `Unknown kind: ${String(kind)}`);
    } catch (err) {
        await respond(
            request_id,
            false,
            null,
            err instanceof Error ? err.message : String(err),
        );
    }
}

export async function startAgentApiBridge() {
    if (unlisten) return;
    unlisten = await listen<IncomingRequest>("agent-api://request", (e) => {
        // Fire and forget — each request is independent.
        void handle(e.payload);
    });
}

export async function stopAgentApiBridge() {
    if (unlisten) {
        unlisten();
        unlisten = null;
    }
}
