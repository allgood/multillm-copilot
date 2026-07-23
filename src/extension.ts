import * as vscode from "vscode";
import { MultiLLMChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { logger } from "./logger";
import { l10n, l10nFormat } from "./localize";
import type { ModelPreset } from "./types";
import { abortCommitGeneration, generateCommitMsg } from "./gitCommit/commitMessageGenerator";
import { TokenizerManager } from "./tokenizer/tokenizerManager";
import { getProviders, getProviderApiKey, storeProviderApiKey, deleteProviderApiKey, rescanProviderModels, getModelConfig, parseCompositeModelId, clearModelCache, getCachedDynamicModels, syncHardcodedModels, copyHardcodedProvidersToUserSettings } from "./providers";
import { manageProvidersCommand } from "./providerEditor";
import type { ProviderConfig, MultiLLMModelItem } from "./types";

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    logger.init();

    // Initialize TokenizerManager with extension path
    TokenizerManager.initialize(context.extensionPath);

    const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
    const provider = new MultiLLMChatModelProvider(context.secrets, tokenCountStatusBarItem);

    // Register the Multi-LLM provider under the vendor id used in package.json
    vscode.lm.registerLanguageModelChatProvider("multiLLM", provider);

    // Sync hardcoded models into user settings on startup.
    // This ensures that models marked _hardcoded: true are updated
    // when the extension's built-in defaults change.
    syncHardcodedModels().then((changed) => {
        if (changed) {
            logger.info("extension.hardcoded-sync", { message: "Hardcoded models synced to user settings." });
        }
    });

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

    // Command to open settings.json directly at the providers key
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.openSettingsJson", () => {
            vscode.commands.executeCommand("workbench.action.openSettingsJson");
            // After a short delay, reveal the multiLLM.providers key
            setTimeout(() => {
                vscode.commands.executeCommand("editor.actions.findWithArgs", {
                    searchString: "multiLLM.providers",
                    isRegex: false,
                    matchWholeWord: false,
                    isCaseSensitive: true,
                });
            }, 300);
        })
    );

    // Command to manage providers via GUI
    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.manageProviders", () => {
            manageProvidersCommand(context.secrets);
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

    // ── Inspect discovered model ───────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.inspectModel", async () => {
            const providers = getProviders();
            if (providers.length === 0) {
                vscode.window.showInformationMessage(l10n("No providers configured."));
                return;
            }

            // Collect all models from all providers
            interface ModelQuickPickItem extends vscode.QuickPickItem {
                compositeId: string;
                providerId: string;
            }

            const items: ModelQuickPickItem[] = [];

            for (const provider of providers) {
                const staticModelIds = new Set<string>();

                // Static models
                if (provider.models) {
                    for (const def of provider.models) {
                        const compositeId = `${provider.id}:${def.id}`;
                        items.push({
                            label: `$(symbol-class) ${def.name}`,
                            description: `${provider.label} — ${def.id}`,
                            detail: l10n("Static model"),
                            compositeId,
                            providerId: provider.id,
                        });
                        staticModelIds.add(def.id);
                    }
                }

                // Dynamic models (only those not in static)
                if (provider.modelsBaseUrl) {
                    const cachedModels = getCachedDynamicModels(provider.id);
                    if (cachedModels) {
                        for (const model of cachedModels) {
                            if (staticModelIds.has(model.id)) { continue; }
                            const compositeId = `${provider.id}:${model.id}`;
                            const isReasoning = model.capabilities?.reasoning ?? false;
                            const hasVision = model.capabilities?.vision ?? false;
                            const caps: string[] = [];
                            if (isReasoning) { caps.push("reasoning"); }
                            if (hasVision) { caps.push("vision"); }
                            items.push({
                                label: `$(cloud) ${model.id}`,
                                description: `${provider.label}${caps.length > 0 ? " — " + caps.join(", ") : ""}`,
                                detail: l10n("Discovered model"),
                                compositeId,
                                providerId: provider.id,
                            });
                        }
                    }
                }
            }

            if (items.length === 0) {
                vscode.window.showInformationMessage(l10n("No models found. Add providers or rescan models first."));
                return;
            }

            const picked = await vscode.window.showQuickPick(items, {
                title: l10n("Inspect Model Configuration"),
                placeHolder: l10n("Select a model to inspect its resolved configuration"),
                ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true,
            });
            if (!picked) { return; }

            const um = getModelConfig(picked.compositeId);
            if (!um) {
                vscode.window.showErrorMessage(l10n("Could not resolve model configuration."));
                return;
            }

            // Build a readable representation of the model config
            const lines: string[] = [];
            lines.push(`# ${um.displayName || um.id}`);
            lines.push("");
            lines.push("| Property | Value |");
            lines.push("|----------|-------|");
            lines.push(`| ID | \`${um.id}\` |`);
            lines.push(`| Provider | \`${um.owned_by}\` |`);
            lines.push(`| Base URL | \`${um.baseUrl || "—"}\` |`);
            lines.push(`| API Mode | \`${um.apiMode || "openai"}\` |`);
            lines.push(`| Vision | ${um.vision ? "✅" : "❌"} |`);
            lines.push(`| Context Length | ${(um.context_length ?? 128000).toLocaleString()} |`);
            const maxOut = um.max_tokens ?? um.max_completion_tokens;
            lines.push(`| Max Output Tokens | ${maxOut !== undefined ? maxOut.toLocaleString() : "*(not set — API default)*"} |`);
            lines.push(`| Thinking Enabled | ${um.enable_thinking ? "✅" : "❌"} |`);
            lines.push(`| Thinking Mode | \`${um.thinkingMode || "—"}\` |`);
            lines.push(`| Reasoning Effort | \`${um.reasoning_effort || "—"}\` |`);
            lines.push(`| Include Reasoning in Request | ${um.include_reasoning_in_request ? "✅" : "❌"} |`);
            lines.push(`| Temperature | ${um.temperature !== undefined && um.temperature !== null ? um.temperature : "*(not set)*"} |`);
            lines.push(`| Top P | ${um.top_p !== undefined && um.top_p !== null ? um.top_p : "*(not set)*"} |`);
            if (um.extra && Object.keys(um.extra).length > 0) {
                lines.push(`| Extra | \`${JSON.stringify(um.extra)}\` |`);
            }

            // Show in a webview for better readability
            const panel = vscode.window.createWebviewPanel(
                "multiLLM.modelInspector",
                l10nFormat("Model: {0}", um.displayName || um.id),
                vscode.ViewColumn.One,
                { enableScripts: false }
            );

            panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
        th { font-weight: 600; color: var(--vscode-editor-foreground); }
        td:first-child { white-space: nowrap; color: var(--vscode-symbolIcon-variableForeground); }
        td:last-child { color: var(--vscode-editor-foreground); }
        code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
        h1 { font-size: 1.3em; margin-bottom: 16px; }
        .note { margin-top: 20px; padding: 12px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textBlockQuote-border); color: var(--vscode-textBlockQuote-foreground); }
    </style>
</head>
<body>
    ${lines.map((l) => {
        if (l.startsWith("# ")) { return `<h1>${l.slice(2)}</h1>`; }
        if (l.startsWith("|")) { return l + "\n"; }
        return `<p>${l}</p>`;
    }).join("\n")}
    <div class="note">
        <strong>${l10n("Note")}:</strong> ${l10n("This is the resolved configuration used when sending requests to the API. Values marked as \"not set\" are omitted from the request body, letting the API use its own defaults.")}
    </div>
</body>
</html>`;
        })
    );

    // ── Copy hardcoded providers to user settings ────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.copyHardcodedModels", async () => {
            await copyHardcodedProvidersToUserSettings();
        })
    );

    // ── Inspect raw configuration ────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand("multiLLM.inspectConfig", async () => {
            const config = vscode.workspace.getConfiguration();
            const providers = config.get<ProviderConfig[]>("multiLLM.providers", []);
            const inspected = config.inspect<ProviderConfig[]>("multiLLM.providers");

            // Build a JSON tree showing the effective config
            const effectiveJson = JSON.stringify(providers, null, 2);
            const defaultJson = JSON.stringify(inspected?.defaultValue ?? [], null, 2);

            const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

            const panel = vscode.window.createWebviewPanel(
                "multiLLM.configInspector",
                l10n("Configuration Inspector"),
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            panel.webview.html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
        h2 { font-size: 1.1em; margin: 20px 0 8px; }
        h2:first-child { margin-top: 0; }
        .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.8em; margin-left: 6px; }
        .badge-hc { background: #6a9955; color: #fff; }
        .badge-user { background: #569cd6; color: #fff; }
        pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; line-height: 1.5; max-height: 60vh; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
        .tab-bar { display: flex; gap: 0; margin-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
        .tab { padding: 6px 16px; cursor: pointer; border: 1px solid transparent; border-bottom: none; border-radius: 4px 4px 0 0; font-size: 0.9em; }
        .tab.active { background: var(--vscode-tab-activeBackground); border-color: var(--vscode-panel-border); color: var(--vscode-tab-activeForeground); }
        .tab:not(.active) { color: var(--vscode-tab-inactiveForeground); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 0.85em; }
        .source-tag { font-size: 0.75em; padding: 1px 5px; border-radius: 3px; }
        .source-default { background: #6a9955; color: #fff; }
        .source-user { background: #569cd6; color: #fff; }
        .source-workspace { background: #ce9178; color: #fff; }
        .key { color: var(--vscode-symbolIcon-variableForeground); }
        .string { color: var(--vscode-symbolIcon-stringForeground); }
        .number { color: var(--vscode-symbolIcon-numberForeground); }
        .boolean { color: var(--vscode-symbolIcon-booleanForeground); }
        .null { color: var(--vscode-symbolIcon-nullForeground); }
        .comment { color: var(--vscode-symbolIcon-operatorForeground); font-style: italic; }
    </style>
</head>
<body>
    <h1>${l10n("Configuration Inspector")}</h1>
    <div class="legend">
        <span><span class="source-tag source-default">default</span> ${l10n("From package.json")}</span>
        <span><span class="source-tag source-user">user</span> ${l10n("From user settings")}</span>
        <span><span class="source-tag source-workspace">workspace</span> ${l10n("From workspace settings")}</span>
    </div>

    <div class="tab-bar">
        <div class="tab active" onclick="switchTab('effective')">${l10n("Effective Config")}</div>
        <div class="tab" onclick="switchTab('default')">${l10n("Hardcoded Default")}</div>
        <div class="tab" onclick="switchTab('raw')">${l10n("Raw Sources")}</div>
    </div>

    <div id="tab-effective" class="tab-content active">
        <pre><code>${esc(effectiveJson)}</code></pre>
    </div>
    <div id="tab-default" class="tab-content">
        <pre><code>${esc(defaultJson)}</code></pre>
    </div>
    <div id="tab-raw" class="tab-content">
        <pre><code>${esc(JSON.stringify({
            globalValue: inspected?.globalValue,
            workspaceValue: inspected?.workspaceValue,
            defaultValue: inspected?.defaultValue,
        }, null, 2))}</code></pre>
    </div>

    <script>
        function switchTab(name) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector('.tab[onclick="switchTab(\\'' + name + '\\')"]').classList.add('active');
            document.getElementById('tab-' + name).classList.add('active');
        }
    </script>
</body>
</html>`;
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
