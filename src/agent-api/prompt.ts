export function buildAgentPrompt(url: string, token: string): string {
    return [
        "我本地运行着一款叫 Cent 的记账应用，它通过本地 HTTP 接口暴露了一组账本操作 API，你可以借此帮我查询和分析账单。",
        "",
        `- 服务地址：${url}`,
        `- 访问 Token：${token}（请求头 \`Authorization: Bearer <Token>\`，请将 Token 一并保存）`,
        "",
        "请执行以下步骤：",
        "",
        `1. 获取 skill 文档（其中已写明上述服务地址、Token 以及所有可用工具的 JSON Schema）：`,
        "",
        "```bash",
        `curl -H "Authorization: Bearer ${token}" ${url}/skill`,
        "```",
        "",
        "2. 如果你的运行环境支持自定义 skill / 工具，请直接把返回的 Markdown 安装为 skill；否则把它作为长期参考材料保存到本次会话上下文中。skill 内已包含访问所需的 URL 与 Token，**后续对话无需再向我索要**。",
        "",
        "3. 之后回答我关于账本的问题时，按 skill 中的描述选择合适工具，通过 `POST <URL>/tools/<tool_name>` 调用即可。",
    ].join("\n");
}
