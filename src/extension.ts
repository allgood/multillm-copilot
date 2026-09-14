import * as vscode from "vscode";
import { MultiLLMChatModelProvider } from "./provider";
import { initStatusBar, refreshGoUsageNow } from "./statusBar";
import { formatUsageSummary, getUsageFetchStatus } from "./goUsage";
import { logger } from "./logger";
import { l10n, l10nFormat } from "./localize";
import type { ModelPreset } from "./types";
import { VersionManager } from "./versionManager";
import { abortCommitGeneration, generateCommitMsg } from "./gitCommit/commitMessageGenerator";
import { TokenizerManager } from "./tokenizer/tokenizerManager";
import { getProviders, getProviderApiKey, storeProviderApiKey, deleteProviderApiKey, rescanProviderModels } from "./providers";
import { manageProvidersCommand } from "./providerEditor";
import { prepareLanguageModelChatInformation, resetAutoDiscoveryState } from "./provideModel";
import { initSessionRouting, resetSessionRouting } from "./sessionRouting";
import { validateBaseUrl } from "./utils";

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    logger.init();
    logger.info("extension.activate", { version: VersionManager.getVersion() });

    // Initialize TokenizerManager with extension path
    TokenizerManager.initialize(context.extensionPath);

    const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context, context.secrets);
    const provider = new MultiLLMChatModelProvider(context.secrets, tokenCountStatusBarItem);

    // Restore the persisted session ID registry (3-day TTL) before any
    // request can resolve a session ID.
    initSessionRouting(context.globalState);

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

    // ── OpenCode Go plan usage ───────────────────────────────────────

    // Command to check / refresh the OpenCode Go plan usage.
    // Also bound to clicking the status bar item (see statusBar.ts).
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.checkUsage", async () => {
            const apiKey = await getProviderApiKey("opencode-go", context.secrets);
            if (!apiKey) {
                vscode.window.showWarningMessage(l10n("No API key configured. Please run the 'OpenCode Go: Set API Key' command first."));
                return;
            }
            const usage = await refreshGoUsageNow();
            if (!usage) {
                if (getUsageFetchStatus() === "unauthorized") {
                    vscode.window.showErrorMessage(l10n("OpenCode Go usage is unavailable (no active Go plan)."));
                } else {
                    vscode.window.showErrorMessage(l10n("Failed to fetch OpenCode Go usage. See output for details."));
                }
                return;
            }
            vscode.window.showInformationMessage(`OpenCode Go: ${formatUsageSummary(usage)}`);
        })
    );

    // ── Session routing ──────────────────────────────────────────────

    // Command to drop all registered session IDs so the next request of every
    // conversation is routed as a fresh session (escape hatch when session
    // affinity pins a conversation to a degraded backend).
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.resetSessionRouting", () => {
            const cleared = resetSessionRouting();
            logger.info("sessionRouting.reset", { cleared });
            vscode.window.showInformationMessage(
                l10nFormat("Session routing reset. The next request of each conversation will use a new session ID. ({0} cleared)", cleared)
            );
        })
    );

    // ── Inference base URL override (proxy) ──────────────────────────

    // Command to set a custom inference Base URL (proxy). The compatibility
    // notice is shown as the QuickPick prompt (wrapped text above the list);
    // only after explicitly selecting "I Understand" does the Base URL input
    // box appear.
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.setInferenceBaseUrl", async () => {
            interface BaseUrlNoticeItem extends vscode.QuickPickItem {
                ack?: boolean;
            }

            const ackItem: BaseUrlNoticeItem = {
                label: l10n("I Understand"),
                ack: true,
            };
            const cancelItem: BaseUrlNoticeItem = {
                label: l10n("Cancel"),
            };

            const picked = await vscode.window.showQuickPick<BaseUrlNoticeItem>(
                [ackItem, cancelItem],
                {
                    title: l10n("Set Proxy Base URL"),
                    placeHolder: l10n("Select 'I Understand' to continue, or press Esc to cancel"),
                    prompt: l10n("This feature is not for connecting to third-party providers — it is for routing requests through a local proxy service. All inference requests (chat and Git commit generation) are sent to this address. The proxy must be fully compatible with the official endpoint: same protocols and paths (/chat/completions, /responses, /v1/messages), same model IDs and headers (Authorization, x-opencode-session). Streaming (SSE) responses must pass through unchanged. Usage and model list requests still use the official endpoint. If you encounter problems after using a proxy, make sure the problem is not caused by the proxy before submitting an issue."),
                    ignoreFocusOut: true,
                }
            );
            if (!picked?.ack) {
                return; // user canceled or dismissed the notice
            }

            const config = vscode.workspace.getConfiguration();
            const current = config.get<string>("multiLLM.inferenceBaseUrl", "");
            const input = await vscode.window.showInputBox({
                title: l10n("Set Proxy Base URL"),
                prompt: l10n("Enter the proxy base URL (e.g. https://proxy.example.com/zen/go/v1). Leave empty to clear the override and use the official endpoint."),
                value: current,
                ignoreFocusOut: true,
                validateInput: (value: string) => {
                    const trimmed = value.trim();
                    if (!trimmed) {
                        return undefined; // empty input clears the override
                    }
                    return validateBaseUrl(trimmed);
                },
            });
            if (input === undefined) {
                return; // user canceled
            }

            const trimmed = input.trim();
            if (!trimmed) {
                await config.update("multiLLM.inferenceBaseUrl", undefined, vscode.ConfigurationTarget.Global);
                logger.info("settings.inferenceBaseUrl.cleared", {});
                vscode.window.showInformationMessage(l10n("Inference base URL override cleared. The official endpoint will be used."));
                return;
            }

            await config.update("multiLLM.inferenceBaseUrl", trimmed, vscode.ConfigurationTarget.Global);
            logger.info("settings.inferenceBaseUrl.set", { baseUrl: trimmed });
            vscode.window.showInformationMessage(l10nFormat("Inference base URL set to: {0}", trimmed));
        })
    );

    // ── Rescan models ────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.rescanModels", async () => {
            const providers = getProviders();
            if (providers.length === 0) {
                vscode.window.showInformationMessage(l10n("No providers configured. Add providers in settings."));
                return;
            }

            interface RescanQuickPickItem extends vscode.QuickPickItem {
                providerId?: string;
            }

            const allItem: RescanQuickPickItem = {
                label: "$(refresh) " + l10n("All Providers"),
                description: l10n("Rescan dynamic models for all providers"),
            };

            const items: RescanQuickPickItem[] = [
                allItem,
                { label: "", kind: vscode.QuickPickItemKind.Separator },
                ...providers.map((p) => ({
                    label: p.label,
                    description: p.modelsBaseUrl
                        ? l10nFormat("Dynamic models URL: {0}", p.modelsBaseUrl)
                        : l10n("Static models only"),
                    providerId: p.id,
                })),
            ];

            const picked = await vscode.window.showQuickPick(items, {
                title: l10n("Rescan Models"),
                placeHolder: l10n("Select a provider to rescan"),
                ignoreFocusOut: true,
            });
            if (!picked) { return; }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: l10n("Rescanning models..."),
                cancellable: false,
            }, async () => {
                // Drop every cached model source so the rescan fetches fresh data.
                resetAutoDiscoveryState();
                const results = await rescanProviderModels(context.secrets, picked.providerId);
                const totalModels = results.reduce((sum, r) => sum + r.modelCount, 0);
                const failures = results.filter((r) => r.error);

                if (failures.length > 0) {
                    const details = failures.map((f) => `${f.providerId}: ${f.error}`).join("\n");
                    vscode.window.showWarningMessage(
                        l10nFormat(
                            "Rescanned {0} providers, found {1} models. {2} failed.",
                            String(results.length),
                            String(totalModels),
                            String(failures.length)
                        ) + "\n" + details,
                        { modal: false }
                    );
                } else {
                    vscode.window.showInformationMessage(
                        l10nFormat(
                            "Rescanned {0} providers, found {1} models.",
                            String(results.length),
                            String(totalModels)
                        )
                    );
                }
            });
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

    // Warm up model discovery on every activation (non-blocking, fire-and-forget).
    // VS Code may fire several activation events at startup; the short refresh
    // interval in prepareLanguageModelChatInformation dedupes concurrent calls
    // so the API is not spammed. On failure it degrades silently to the
    // configured model list.
    void prepareLanguageModelChatInformation(
        { silent: true },
        new vscode.CancellationTokenSource().token,
        context.secrets
    ).catch((error) => {
        logger.error("models.warmup.failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    });

    // Dispose logger on deactivate
    context.subscriptions.push({
        dispose: () => logger.dispose(),
    });
}

export function deactivate() { }
