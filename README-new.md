<center>

![logo](/assets/logo.png)

# OpenCode Go Provider for Copilot

</center>

> **本插件与 OpenCode 或 Anomaly 无关，也未获得其官方维护或认可。**

将 [OpenCode Go](https://opencode.ai/go) 以及可选的 Zen 免费模型集成到 GitHub Copilot Chat 的 VS Code 扩展。

### 使用

1. **设置 API Key**：`Ctrl+Shift+P` → `OpenCodeGo: Set OpenCode Go API Key`
2. **显示模型**：在模型选择器中点击设置图标 → **语言模型** 面板 → 将需要使用的模型显示
3. **选择模型**：在 Copilot Chat 底部模型选择器中选择 "OpenCode Go" 或 "OpenCode Zen" 下的模型
4. **开始对话**

### 启用 OpenCode Zen 免费模型

该功能默认关闭，通过 `opencodego.enableZenFreeModels` 设置启用（默认关闭）。开启后，将从 Zen API 获取免费模型并添加到模型选择器中，名称带 `Zen/` 前缀（如 `Zen/DeepSeek V4 Flash Free`）。更改设置后需要重新加载 VS Code 才能生效。

### Token 用量指示器

安装后，使用 OpenCode Go 提供的模型时，状态栏会显示当前上下文用量与累计输入/输出 Token 量。DeepSeek 和通过 OpenAI 格式返回缓存用量的模型还会显示**累计缓存命中量**与**缓存命中率**。

> 提示: 非 DeepSeek 的模型是否显示缓存数据取决于模型接口是否通过 OpenAI 格式返回缓存数据，这并不代表此模型是否支持缓存。模型对于缓存的支持情况取决于 OpenCode Go。

![token_counter](/assets/screenshots/token_counter.png)

### Git 提交消息

在源代码管理（SCM）面板中点击魔法棒按钮，自动生成 Git 提交消息。

可在配置里配置使用的模型、语言、参考的最近提交数量以及是否附加上下文文件。

### 调整模型温度

通过 `Ctrl+Shift+P` → `OpenCodeGo: Set Model Temperature Preset` 快速切换温度预设。

内置 4 个预设档位：

| 档位 | 温度 |
|------|------|
| 精确 | 0.0 |
| 均衡 | 1.0 |
| 创意 | 1.2 |
| 极具创意 | 1.7 |

选择 **Custom（自定义）** 可手动输入温度和可选的 top_p 值。

也可在 `settings.json` 中直接配置 `opencodego.temperature` 和 `opencodego.top_p`（需将 `opencodego.modelPreset` 设为 `"custom"`）。

### 配置

可在 `settings.json` 中配置：

```json
{
  "opencodego.commitLanguage": "auto",
  "opencodego.commitModel": "deepseek-v4-flash",
  "opencodego.commitMessagePrompt": "",
  "opencodego.requestTimeout": 600000,
  "opencodego.recentCommitsCount": 10,
  "opencodego.commitIncludeCommitDiff": false,
  "opencodego.commitAttachContextFiles": true
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `opencodego.commitLanguage` | `auto` | 提交消息语言。设为 `auto` 时将根据历史提交自动检测语言（无历史时默认英语）。 |
| `opencodego.commitModel` | `deepseek-v4-flash` | 用于生成提交消息的模型 |
| `opencodego.commitMessagePrompt` | `""` | 生成提交消息的自定义系统提示词 |
| `opencodego.requestTimeout` | `600000` | 单个 API 请求的最大等待时间（毫秒）。默认 600000（10 分钟）。生成长内容超时时可增大此值。 |
| `opencodego.recentCommitsCount` | `10` | 生成提交消息时参考的近期提交数量，用于学习仓库提交风格。设为 0 可禁用。 |
| `opencodego.commitIncludeCommitDiff` | `false` | 在风格参考中包含历史提交的实际代码变更（diff），帮助模型生成更符合项目提交风格的消息。 |
| `opencodego.enableZenFreeModels` | `false` | 启用 OpenCode Zen 免费模型并添加到模型选择器中。暂不支持用于 Git 提交消息生成。更改后需重载 VS Code 生效。 |
| `opencodego.commitAttachContextFiles` | `true` | 将仓库根目录的 AGENTS.md 和 README.md 作为额外上下文附加到提交消息生成中，帮助模型更好地理解项目。 |

> 支持切换思考模式的模型（如 DeepSeek、Qwen）提供`禁用思考`/`高`/`极高`等推理强度选项。

### 编译

```bash
npm install
npm run compile
npm run build      # 打包为 extension.vsix
```

### 许可

MIT License。本项目参考了 [oai-compatible-copilot](https://github.com/JohnnyZ93/oai-compatible-copilot) 的代码。