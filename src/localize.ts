import * as vscode from "vscode";

const zhCN: Record<string, string> = {
    // statusBar
    "Token Count": "Token 计数",
    "Token Usage": "Token 使用量",
    "Current model token usage": "当前模型 token 使用量",
    "Ready": "就绪",

    // extension.ts - API key prompts
    "Select Provider": "选择提供商",
    "Choose a provider to set API key for": "选择要设置 API 密钥的提供商",
    "No providers configured. Add providers in settings.": "未配置任何提供商。请在设置中添加提供商。",
    "{0} API Key": "{0} API 密钥",
    "Update your API key": "更新您的 API 密钥",
    "Enter your API key": "输入您的 API 密钥",
    "{0} API key cleared.": "{0} API 密钥已清除。",
    "{0} API key saved.": "{0} API 密钥已保存。",

    // provider.ts
    "API key not found for this provider. Please set it in settings.": "未找到此提供商的 API 密钥。请在设置中配置。",
    "Invalid base URL configuration.": "无效的 Base URL 配置。",

    // statusBar cache tooltip
    "Cache": "缓存",
    "({0} cached, {1}%)": "(已缓存 {0}, 命中率 {1}%)",
    "No changes found in any workspace repositories.": "在任何工作区仓库中均未发现更改。",
    "Git extension not found": "未找到 Git 扩展",
    "No Git repositories available": "没有可用的 Git 仓库",
    "Repository not found for provided SCM": "未找到指定 SCM 对应的仓库",
    "Failed to generate commit message:": "生成提交消息失败：",
    "[Commit Generation Failed]": "[提交生成失败]",
    "empty API response": "API 返回为空",
    "No commit model configured. Set multiLLM.commitModel in settings.": "未配置提交消息模型。请在设置中设置 multiLLM.commitModel。",
    "API key not found for commit generation. Please configure it in settings.": "未找到用于提交消息生成的 API 密钥。请在设置中配置。",

    // Timeout errors
    "Request timed out. The generation took too long. You can increase the timeout in settings (multiLLM.requestTimeout).":
        "请求超时，生成内容过长。您可以在设置中增加超时时间（multiLLM.requestTimeout）。",
    "The connection was closed by the server. The generation took too long. Please try again or request shorter content.":
        "服务端连接被关闭，生成内容过长时间过长。请重试或请求较短的内容。",

    // reasoning effort labels
    "Disabled": "禁用思考",
    "Adaptive": "自动",
    "Thinking": "思考",
    "Low": "低",
    "Medium": "中",
    "High": "高",
    "Maximum": "极高",

    // reasoning effort descriptions
    "Do not enable thinking": "不启用思考",
    "Automatically decide when to think": "自动决定何时思考",
    "Enable thinking": "启用思考",
    "Reduce thinking, faster response": "减少思考，响应更快",
    "Balance thinking and speed": "平衡思考与速度",
    "Deeper thinking, slower response": "更深入的思考，但速度较慢",
    "Maximum thinking depth, slowest response": "最大思考深度，速度最慢",

    // reasoning effort title
    "Reasoning Effort": "推理强度",

    // vision proxy
    "Querying vision model: \"{0}\"": "正在根据图片提问：{0}",
    "The image you sent was flagged as sensitive by the content moderation system. Please try a different image.": "您发送的图片被内容审核系统判定为敏感，请尝试更换图片。",

    // extension.ts - model preset
    "Custom (manual input)": "自定义 (手动输入)",
    " (current)": " (当前)",
    "(current, temperature: {0}, top_p: {1})": "(当前, 温度: {0}, top_p: {1})",
    "Set Model Preset": "设置模型预设",
    "Select a preset": "选择一个档位",
    "Enter custom temperature": "输入自定义温度",
    "Enter a single number for temperature only (<=2), or two comma-separated numbers for temperature and top_p (temp<=2, top_p<=1), e.g.: 0.7 or 0.7,0.95": "输入一个数字只设温度 (<=2), 输入两个数字用英文逗号分隔同时设温度和 top_p (温度<=2, top_p<=1), 如: 0.7 或 0.7,0.95",
    "Please enter at least temperature value": "请至少输入一个温度值",
    "Please enter at most two numbers separated by a comma": "最多输入两个数值, 用英文逗号分隔",
    "Temperature must be between 0.0 and 2.0": "温度必须在 0.0 到 2.0 之间",
    "top_p must be between 0.0 and 1.0": "top_p 必须在 0.0 到 1.0 之间",
    "Precise": "精确",
    "Balanced": "均衡",
    "Creative": "创意",
    "Extra Creative": "极具创意",
    "Set to temperature: {0} ({1})": "已设为温度 {0} ({1})",
    "Set to temperature: {0} (custom)": "已设为温度 {0} (自定义)",
    "Set to temp: {0}, top_p: {1} (custom)": "已设为温度 {0}, top_p {1} (自定义)",
    "{0} provider saved.": "{0} 提供商已保存。",
    "{0} provider deleted.": "{0} 提供商已删除。",
    "{0} provider {1}.": "{0} 提供商已{1}。",
    "enabled": "启用",
    "disabled": "禁用",

    // providerEditor.ts — main menu
    "Manage Providers": "管理提供商",
    "Add Provider": "添加提供商",
    "Edit": "编辑",
    "Models": "模型",
    "API Key": "API 密钥",
    "Enable": "启用",
    "Disable": "禁用",
    "Delete": "删除",
    "Open Settings JSON": "打开设置 JSON",
    "Edit providers directly in settings.json": "直接在 settings.json 中编辑提供商",
    "Select an action": "选择一个操作",
    "Create a new LLM provider": "创建新的 LLM 提供商",
    "{0} models defined": "已定义 {0} 个模型",
    "No static models": "暂无静态模型",
    "API key is set (click to change)": "API 密钥已设置（点击修改）",
    "No API key set": "未设置 API 密钥",
    "Currently enabled": "当前已启用",
    "Currently disabled": "当前已禁用",
    "key set": "已设置密钥",
    "no key": "未设置密钥",

    // providerEditor.ts — provider wizard
    "Edit Provider": "编辑提供商",
    "Provider ID (lowercase, hyphens allowed)": "提供商 ID（小写字母，允许连字符）",
    "Provider ID must be lowercase letters, numbers, and hyphens (cannot start/end with hyphen).": "提供商 ID 必须为小写字母、数字和连字符（不能以连字符开头或结尾）。",
    "Provider ID already exists.": "提供商 ID 已存在。",
    "Display label shown in the UI": "显示在 UI 中的标签",
    "Label is required.": "标签不能为空。",
    "Base URL (must start with http/https)": "Base URL（必须以 http/https 开头）",
    "Base URL must start with http.": "Base URL 必须以 http 开头。",
    "OpenAI-compatible /chat/completions": "OpenAI 兼容 /chat/completions",
    "Anthropic /v1/messages": "Anthropic /v1/messages",
    "Auto-detect from URL or model config": "从 URL 或模型配置自动检测",
    "Select API mode": "选择 API 模式",
    "Group (model picker family, defaults to label)": "分组（模型选择器中的系列名称，默认为标签）",
    "Delete provider \"{0}\"? This will also remove its API key and model definitions.": "确定删除提供商 \"{0}\"？此操作同时删除该提供商的 API 密钥和模型定义。",
    "Update your API key (clear to remove)": "更新 API 密钥（清空即可删除）",
    "Provider API key cleared.": "提供商 API 密钥已清除。",
    "Provider API key saved.": "提供商 API 密钥已保存。",

    // providerEditor.ts — model sub-menu
    "{0} Models": "{0} 的模型",
    "Add Model": "添加模型",
    "Add a static model definition": "添加静态模型定义",
    "Back": "返回",
    "Return to provider menu": "返回提供商菜单",
    "{0} model saved.": "{0} 模型已保存。",
    "{0} model deleted.": "{0} 模型已删除。",
    "Delete model \"{0}\"?": "确定删除模型 \"{0}\"？",

    // providerEditor.ts — model wizard
    "Edit Model": "编辑模型",
    "Model ID (the ID sent to the API, e.g. gpt-4o)": "模型 ID（发送到 API 的 ID，如 gpt-4o）",
    "Model ID is required.": "模型 ID 不能为空。",
    "Display name shown in the model picker": "在模型选择器中显示的显示名称",
    "Display name is required.": "显示名称不能为空。",
    "Does this model support vision?": "此模型是否支持图片输入？",
    "Yes": "是",
    "No": "否",
    "Model supports image input": "模型支持图片输入",
    "Images will use vision proxy (ask_image tool)": "图片将使用视觉代理（ask_image 工具）",
    "Select thinking mode": "选择思考模式",
    "User can enable or disable thinking": "用户可以选择启用或禁用思考",
    "Thinking always enabled (model requires it)": "始终启用思考（模型要求）",
    "User can choose disabled or automatic": "用户可选择禁用或自动",
    "Context length (max input tokens)": "上下文长度（最大输入 token 数）",
    "Must be a positive number.": "必须为正整数。",
    "Max output tokens": "最大输出 token 数",
};

export function l10n(key: string): string {
    const language = vscode.env.language;
    if (language.toLowerCase() === "zh-cn" || language.toLowerCase().startsWith("zh")) {
        if (zhCN[key]) {
            return zhCN[key];
        }
    }
    return key;
}

export function l10nFormat(template: string, ...args: (string | number)[]): string {
    let str = l10n(template);
    for (let i = 0; i < args.length; i++) {
        str = str.replace(`{${i}}`, String(args[i]));
    }
    return str;
}
