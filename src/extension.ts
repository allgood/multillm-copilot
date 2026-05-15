import * as vscode from "vscode";
import { OpenCodeGoChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { logger } from "./logger";
import { l10n } from "./localize";
import { abortCommitGeneration, generateCommitMsg } from "./gitCommit/commitMessageGenerator";
import { TokenizerManager } from "./tokenizer/tokenizerManager";

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    logger.init();

    // Initialize TokenizerManager with extension path
    TokenizerManager.initialize(context.extensionPath);

    const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
    const provider = new OpenCodeGoChatModelProvider(context.secrets, tokenCountStatusBarItem);

    // Register the OpenCode Go provider under the vendor id used in package.json
    vscode.lm.registerLanguageModelChatProvider("opencodego", provider);

    // Management command to configure API key
    context.subscriptions.push(
        vscode.commands.registerCommand("opencodego.setApiKey", async () => {
            const existing = await context.secrets.get("opencodego.apiKey");
            const apiKey = await vscode.window.showInputBox({
                title: l10n("OpenCode Go Provider API Key"),
                prompt: existing ? l10n("Update your OpenCode Go API key") : l10n("Enter your OpenCode Go API key"),
                ignoreFocusOut: true,
                password: true,
                value: existing ?? "",
            });
            if (apiKey === undefined) {
                return; // user canceled
            }
            if (!apiKey.trim()) {
                await context.secrets.delete("opencodego.apiKey");
                vscode.window.showInformationMessage(l10n("OpenCode Go API key cleared."));
                return;
            }
            await context.secrets.store("opencodego.apiKey", apiKey.trim());
            vscode.window.showInformationMessage(l10n("OpenCode Go API key saved."));
        })
    );

    // Register the generateGitCommitMessage command handler
    context.subscriptions.push(
        vscode.commands.registerCommand("opencodego.generateGitCommitMessage", async (scm) => {
            generateCommitMsg(context.secrets, scm);
        }),
        vscode.commands.registerCommand("opencodego.abortGitCommitMessage", () => {
            abortCommitGeneration();
        })
    );

    // 注册模型预设选择命令：用户可通过命令面板选择预设档位（温度 + top_p）
    // 预设数据来自 opencodego.modelPresets 设置项，用户可自由增删改
    context.subscriptions.push(
        vscode.commands.registerCommand("opencodego.setModelPreset", async () => {
            const config = vscode.workspace.getConfiguration();
            type Preset = { id: string; label: string; temperature: number; top_p: number };
            // 读取用户自定义的预设列表
            const presets = config.get<Preset[]>("opencodego.modelPresets", []);
            // 读取当前选中的预设 ID 和手动输入的温度/top_p
            const currentPreset = config.get<string>("opencodego.modelPreset", "custom");
            const currentTemp = config.get<number | null>("opencodego.temperature", null);
            const currentTopP = config.get<number | null>("opencodego.top_p", null);

            // 根据语言环境设置 UI 文字
            const isChineseLang = vscode.env.language.toLowerCase().startsWith("zh");

            // 构建 QuickPick 选项列表：每个预设显示为「名称（温度, top_p）」
            const presetItems = (presets || []).map((p) => ({
                label: `${p.label}（${p.temperature}, ${p.top_p !== undefined ? p.top_p : "—"}）`,
                id: p.id,
                temperature: p.temperature,
                top_p: p.top_p,
            }));

            // 手动输入选项
            const customItem: vscode.QuickPickItem = {
                label: "$(pencil) " + (isChineseLang
                    ? "自定义（手动输入 温度,top_p）"
                    : "Custom (manual input temp,top_p)"),
            };

            // 当前值显示字符串
            const currentTempStr = currentTemp !== null ? String(currentTemp) : "—";
            const currentTopPStr = currentTopP !== null ? String(currentTopP) : "—";

            const items: vscode.QuickPickItem[] = [
                ...presetItems,
                { label: "", kind: vscode.QuickPickItemKind.Separator },
                customItem,
                // 底部分隔线，只显示当前值，不可选
                {
                    label: isChineseLang
                        ? `当前温度 ${currentTempStr}，top_p ${currentTopPStr}`
                        : `Current temp: ${currentTempStr}, top_p: ${currentTopPStr}`,
                    kind: vscode.QuickPickItemKind.Separator,
                },
            ];

            // 构建标题，同样显示当前值
            const title = (isChineseLang ? "设置模型预设" : "Set Model Preset")
                + (isChineseLang
                    ? ` — 当前温度 ${currentTempStr}，top_p ${currentTopPStr}`
                    : ` — Current temp: ${currentTempStr}, top_p: ${currentTopPStr}`);

            const picked = await vscode.window.showQuickPick(items, {
                title,
                placeHolder: isChineseLang ? "选择一个档位（温度, top_p）" : "Select a preset (temp, top_p)",
                ignoreFocusOut: true,
            });

            if (picked) {
                // 通过 label 反向查找选中了哪个预设
                const matchedPreset = (presets || []).find((p) => {
                    const itemLabel = `${p.label}（${p.temperature}, ${p.top_p}）`;
                    return itemLabel === picked.label;
                });

                if (matchedPreset) {
                    // 选中了预设档位：同时保存温度和 top_p（旧版预设可能无 top_p，默认补 1.0）
                    const safeTopP = matchedPreset.top_p !== undefined ? matchedPreset.top_p : 1.0;
                    await config.update("opencodego.modelPreset", matchedPreset.id, vscode.ConfigurationTarget.Global);
                    await config.update("opencodego.temperature", matchedPreset.temperature, vscode.ConfigurationTarget.Global);
                    await config.update("opencodego.top_p", safeTopP, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(
                        isChineseLang
                            ? `已设为 温度 ${matchedPreset.temperature}，top_p ${matchedPreset.top_p}（${matchedPreset.label}）`
                            : `Set to temp: ${matchedPreset.temperature}, top_p: ${matchedPreset.top_p} (${matchedPreset.label})`
                    );
                } else {
                    // 选择了自定义：弹出输入框，接受「温度,top_p」格式
                    const currentVal = currentTemp !== null && currentTopP !== null
                        ? `${currentTemp},${currentTopP}`
                        : "";
                    const inputValue = await vscode.window.showInputBox({
                        title: isChineseLang ? "输入温度和 top_p" : "Enter temperature and top_p",
                        prompt: isChineseLang
                            ? "输入 温度,top_p（英文逗号分隔），如：0.7,0.95"
                            : "Enter temp,top_p (comma separated), e.g.: 0.7,0.95",
                        value: currentVal,
                        validateInput: (val: string) => {
                            const parts = val.split(",");
                            if (parts.length !== 2) {
                                return isChineseLang
                                    ? "请输入两个数值，用英文逗号分隔"
                                    : "Please enter two numbers separated by a comma";
                            }
                            const temp = parseFloat(parts[0].trim());
                            const topP = parseFloat(parts[1].trim());
                            if (isNaN(temp) || temp < 0 || temp > 2) {
                                return isChineseLang
                                    ? "温度必须在 0.0 到 2.0 之间"
                                    : "Temperature must be between 0.0 and 2.0";
                            }
                            if (isNaN(topP) || topP < 0 || topP > 1) {
                                return isChineseLang
                                    ? "top_p 必须在 0.0 到 1.0 之间"
                                    : "top_p must be between 0.0 and 1.0";
                            }
                            return null;
                        },
                        ignoreFocusOut: true,
                    });
                    if (inputValue !== undefined) {
                        const parts = inputValue.split(",");
                        const tempNum = parseFloat(parts[0].trim());
                        const topPNum = parseFloat(parts[1].trim());
                        await config.update("opencodego.modelPreset", "custom", vscode.ConfigurationTarget.Global);
                        await config.update("opencodego.temperature", tempNum, vscode.ConfigurationTarget.Global);
                        await config.update("opencodego.top_p", topPNum, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage(
                            isChineseLang
                                ? `已设为 温度 ${tempNum}，top_p ${topPNum}（自定义）`
                                : `Set to temp: ${tempNum}, top_p: ${topPNum} (custom)`
                        );
                    }
                }
            }
        })
    );

    // Dispose logger on deactivate
    context.subscriptions.push({
        dispose: () => logger.dispose(),
    });
}

export function deactivate() { }
