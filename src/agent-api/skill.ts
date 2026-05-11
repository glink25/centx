import { z } from "zod";
import type { Tool } from "@/assistant";

function toJsonSchemaSafe(schema: unknown): unknown {
    try {
        // zod v4 exposes z.toJSONSchema for ZodType instances
        return (
            z as unknown as { toJSONSchema: (s: unknown) => unknown }
        ).toJSONSchema(schema as never);
    } catch {
        return null;
    }
}

export function buildToolList(tools: Tool[]) {
    return tools.map((t) => ({
        name: t.name,
        describe: t.describe,
        argSchema: t.argSchema ? toJsonSchemaSafe(t.argSchema) : null,
        returnSchema: t.returnSchema ? toJsonSchemaSafe(t.returnSchema) : null,
    }));
}

export type SkillContext = {
    url: string;
    token: string;
};

export function buildSkillMarkdown(tools: Tool[], ctx: SkillContext): string {
    const { url, token } = ctx;
    const parts: string[] = [
        "# Cent Ledger Agent API Skill",
        "",
        "Cent (本地记账应用) 提供了一组本地 HTTP 接口，让你可以查询并分析用户的账本数据。",
        "",
        "## 连接信息",
        "",
        "请将以下连接信息保存在 skill 中，后续每次调用都需要使用：",
        "",
        `- **服务地址 (Base URL)**：\`${url}\``,
        `- **访问 Token**：\`${token}\``,
        "- **鉴权方式**：所有请求需带 Header `Authorization: Bearer <Token>`",
        "",
        "Token 并非高敏感密钥，可保存在 skill 文档中以便下次会话沿用；若用户在 app 中重新生成 Token，请重新获取本 skill 更新即可。",
        "",
        "## 调用约定",
        "",
        `- 工具调用：\`POST ${url}/tools/<tool_name>\``,
        '- 请求体：`{ "args": <符合 argSchema 的对象> }`；无参工具可省略或传 `{}`。',
        '- 成功响应：`{ "ok": true, "data": <符合 returnSchema 的对象> }`。',
        '- 失败响应：`{ "ok": false, "error": "..." }`。',
        `- 也可通过 \`GET ${url}/tools\` 获取机器可读的工具列表（含 JSON Schema）。`,
        "",
        "## 调用示例",
        "",
        "```bash",
        `curl -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\`,
        `  -d '{"args": {}}' ${url}/tools/getAccountMeta`,
        "```",
        "",
        "## 可用工具",
        "",
    ];
    for (const t of tools) {
        parts.push(`### \`${t.name}\``, "", t.describe || "_无描述_", "");
        const argJson = t.argSchema ? toJsonSchemaSafe(t.argSchema) : null;
        if (argJson) {
            parts.push(
                "**参数 (JSON Schema)**:",
                "",
                "```json",
                JSON.stringify(argJson, null, 2),
                "```",
                "",
            );
        } else {
            parts.push("_此工具无参数。_", "");
        }
        const retJson = t.returnSchema
            ? toJsonSchemaSafe(t.returnSchema)
            : null;
        if (retJson) {
            parts.push(
                "**返回 (JSON Schema)**:",
                "",
                "```json",
                JSON.stringify(retJson, null, 2),
                "```",
                "",
            );
        }
    }
    return parts.join("\n");
}
