import * as vscode from "vscode";
import { MultiLLMChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { logger } from "./logger";
import { l10n, l10nFormat } from "./localize";
import type { ModelPreset } from "./types";
import { abortCommitGeneration, generateCommitMsg } from "./gitCommit/commitMessageGenerator";
import { TokenizerManager } from "./tokenizer/tokenizerManager";
import { getProviders, getProviderApiKey, storeProviderApiKey, deleteProviderApiKey } from "./providers";
import { manageProvidersCommand } from "./providerEditor";
import type { ProviderConfig } from "./types";

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    logger.init();

    // Initialize TokenizerManager with extension path
    TokenizerManager.initialize(context.extensionPath);

    const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
    const provider = new MultiLLMChatModelProvider(context.secrets, tokenCountStatusBarItem);

    // Register the Multi-LLM provider under the vendor id used in package.json
    vscode.lm.registerLanguageModelChatProvider("multiLLM", provider);

    // ── API Key management ──────────────────────────────────────────

    // Set API key for a chosen provider
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.setApiKey", async () => {
            const providers = getProviders();
            if (providers.length === 0) {
                vscode.window.showInformationMessage(l10n("No providers configured. Add providers in settings."));
                return;
            }

            const items = providers.map((p) => ({
                label: p.label,
                description: p.baseUrl,
                providerId: p.id,
            }));

            const picked = await vscode.window.showQuickPick(items, {
                title: l10n("Select Provider"),
                placeHolder: l10n("Choose a provider to set API key for"),
                ignoreFocusOut: true,
            });
            if (!picked) { return; }

            const existing = await getProviderApiKey(picked.providerId, context.secrets);
            const apiKey = await vscode.window.showInputBox({
                title: l10nFormat("{0} API Key", picked.label),
                prompt: existing ? l10n("Update your API key") : l10n("Enter your API key"),
                ignoreFocusOut: true,
                password: true,
                value: existing ?? "",
            });
            if (apiKey === undefined) { return; }
            if (!apiKey.trim()) {
                await deleteProviderApiKey(picked.providerId, context.secrets);
                vscode.window.showInformationMessage(l10nFormat("{0} API key cleared.", picked.label));
                return;
            }
            await storeProviderApiKey(picked.providerId, apiKey.trim(), context.secrets);
            vscode.window.showInformationMessage(l10nFormat("{0} API key saved.", picked.label));
        })
    );

    // Command to open extension settings
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.openSettings", () => {
            vscode.commands.executeCommand("workbench.action.openSettings", "@ext:allgood.multi-llm-copilot-provider");
        })
    );

    // Command to manage providers via GUI
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.manageProviders", () => {
            manageProvidersCommand(context.secrets);
        })
    );

    // ── Git commit message generation ────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.generateGitCommitMessage", async (scm) => {
            generateCommitMsg(context.secrets, scm);
        }),
        vscode.commands.registerCommand("multiLLM.abortGitCommitMessage", () => {
            abortCommitGeneration();
        })
    );

    // ── Model preset selection ───────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.setModelPreset", async () => {
            const config = vscode.workspace.getConfiguration();
            const presets = config.get<ModelPreset[]>("multiLLM.modelPresets", []);
            const currentPresetId = config.get<string>("multiLLM.modelPreset", "custom");
            const currentTemp = config.get<number | null>("multiLLM.temperature", null);
            const currentTopP = config.get<number | null>("multiLLM.top_p", null);

            interface PresetQuickPickItem extends vscode.QuickPickItem {
                presetId?: string;
            }

            const presetItems: PresetQuickPickItem[] = presets.map((p) => ({
                label: `${l10n(p.label)} (${p.temperature})${p.id === currentPresetId ? l10n(" (current)") : ""}`,
                presetId: p.id,
            }));

            const isCustomActive = currentPresetId === "custom";
            const customLabel = "$(pencil) " + l10n("Custom (manual input)")
                + (isCustomActive
                    ? ` ${l10nFormat("(current, temperature: {0}, top_p: {1})", String(currentTemp ?? "—"), String(currentTopP ?? "—"))}`
                    : "");

            const customItem: PresetQuickPickItem = { label: customLabel };

            const items: PresetQuickPickItem[] = [
                ...presetItems,
                { label: "", kind: vscode.QuickPickItemKind.Separator },
                customItem,
            ];

            const picked = await vscode.window.showQuickPick(items, {
                title: l10n("Set Model Preset"),
                placeHolder: l10n("Select a preset"),
                ignoreFocusOut: true,
            });

            if (!picked) { return; }

            const presetId = picked.presetId;

            if (presetId) {
                const matchedPreset = presets.find((p) => p.id === presetId);
                if (matchedPreset) {
                    await config.update("multiLLM.modelPreset", matchedPreset.id, vscode.ConfigurationTarget.Global);
                    await config.update("multiLLM.temperature", matchedPreset.temperature, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(
                        l10nFormat("Set to temperature: {0} ({1})", String(matchedPreset.temperature), l10n(matchedPreset.label))
                    );
                }
            } else {
                const currentVal = currentTemp !== null && currentTopP !== null
                    ? `${currentTemp},${currentTopP}`
                    : "";
                const inputValue = await vscode.window.showInputBox({
                    title: l10n("Enter custom temperature"),
                    prompt: l10n("Enter a single number for temperature only (<=2), or two comma-separated numbers for temperature and top_p (temp<=2, top_p<=1), e.g.: 0.7 or 0.7,0.95"),
                    value: currentVal,
                    validateInput: (val: string) => {
                        const trimmed = val.trim();
                        if (!trimmed) {
                            return l10n("Please enter at least temperature value");
                        }
                        const parts = trimmed.split(",");
                        if (parts.length > 2) {
                            return l10n("Please enter at most two numbers separated by a comma");
                        }
                        const temp = parseFloat(parts[0].trim());
                        if (isNaN(temp) || temp < 0 || temp > 2) {
                            return l10n("Temperature must be between 0.0 and 2.0");
                        }
                        if (parts.length === 2) {
                            const topP = parseFloat(parts[1].trim());
                            if (isNaN(topP) || topP < 0 || topP > 1) {
                                return l10n("top_p must be between 0.0 and 1.0");
                            }
                        }
                        return null;
                    },
                    ignoreFocusOut: true,
                });
                if (inputValue !== undefined) {
                    const trimmed = inputValue.trim();
                    const parts = trimmed.split(",");
                    const tempNum = parseFloat(parts[0].trim());
                    await config.update("multiLLM.modelPreset", "custom", vscode.ConfigurationTarget.Global);
                    await config.update("multiLLM.temperature", tempNum, vscode.ConfigurationTarget.Global);
                    if (parts.length === 2) {
                        const topPNum = parseFloat(parts[1].trim());
                        await config.update("multiLLM.top_p", topPNum, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage(
                            l10nFormat("Set to temp: {0}, top_p: {1} (custom)", String(tempNum), String(topPNum))
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            l10nFormat("Set to temperature: {0} (custom)", String(tempNum))
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
