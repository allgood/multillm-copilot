import * as vscode from "vscode";
import { l10n, l10nFormat } from "./localize";
import { getProviders, getProviderApiKey, storeProviderApiKey, deleteProviderApiKey } from "./providers";
import type { ProviderConfig, ProviderModelDef } from "./types";

// ─── Constants ─────────────────────────────────────────────────────────

const SEP = { label: "", kind: vscode.QuickPickItemKind.Separator };

// ─── Helpers ───────────────────────────────────────────────────────────

function getConfig() {
    return vscode.workspace.getConfiguration();
}

function readAllProviders(): ProviderConfig[] {
    return getConfig().get<ProviderConfig[]>("multiLLM.providers", []);
}

async function writeAllProviders(providers: ProviderConfig[]): Promise<void> {
    await getConfig().update(
        "multiLLM.providers",
        providers,
        vscode.ConfigurationTarget.Global,
    );
}

function validateProviderId(id: string, existingProviders: ProviderConfig[], skipId?: string): string | null {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id)) {
        return l10n("Provider ID must be lowercase letters, numbers, and hyphens (cannot start/end with hyphen).");
    }
    if (existingProviders.some((p) => p.id === id && p.id !== skipId)) {
        return l10n("Provider ID already exists.");
    }
    return null;
}

// ─── Main entry point ──────────────────────────────────────────────────

export async function manageProvidersCommand(secrets: vscode.SecretStorage): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const providers = readAllProviders();
        const choice = await showMainMenu(providers, secrets);
        if (!choice) {
            return; // user dismissed
        }
        if (choice === "__showSettings") {
            vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "multiLLM.providers",
            );
            return;
        }
        if (choice === "__add") {
            const created = await showProviderWizard();
            if (created) {
                providers.push(created);
                await writeAllProviders(providers);
                vscode.window.showInformationMessage(
                    l10nFormat("{0} provider saved.", created.label),
                );
            }
            continue;
        }
        // providerId:action
        const [providerId, action] = choice.split(":", 2);
        const idx = providers.findIndex((p) => p.id === providerId);
        if (idx === -1) { continue; }

        switch (action) {
            case "edit": {
                const edited = await showProviderWizard(providers[idx]);
                if (edited) {
                    providers[idx] = edited;
                    await writeAllProviders(providers);
                    vscode.window.showInformationMessage(
                        l10nFormat("{0} provider saved.", edited.label),
                    );
                }
                break;
            }
            case "delete": {
                const confirm = await vscode.window.showWarningMessage(
                    l10nFormat("Delete provider \"{0}\"? This will also remove its API key and model definitions.", providers[idx].label),
                    { modal: true },
                    l10n("Delete"),
                );
                if (confirm === l10n("Delete")) {
                    await deleteProviderApiKey(providerId, secrets);
                    providers.splice(idx, 1);
                    await writeAllProviders(providers);
                    vscode.window.showInformationMessage(
                        l10nFormat("{0} provider deleted.", providers[idx]?.label ?? providerId),
                    );
                }
                break;
            }
            case "models": {
                await showModelSubMenu(providerId, providers, secrets);
                break;
            }
            case "apikey": {
                await promptApiKey(providerId, providers[idx].label, secrets);
                break;
            }
            case "toggle": {
                providers[idx].enabled = !(providers[idx].enabled !== false);
                await writeAllProviders(providers);
                vscode.window.showInformationMessage(
                    l10nFormat("{0} provider {1}.", providers[idx].label,
                        providers[idx].enabled !== false ? l10n("enabled") : l10n("disabled")),
                );
                break;
            }
        }
    }
}

// ─── Main menu ─────────────────────────────────────────────────────────

interface MainMenuPick extends vscode.QuickPickItem {
    value?: string;
}

async function showMainMenu(
    providers: ProviderConfig[],
    secrets: vscode.SecretStorage,
): Promise<string | undefined> {
    const items: MainMenuPick[] = [];

    items.push({
        label: `$(add) ${l10n("Add Provider")}`,
        detail: l10n("Create a new LLM provider"),
        value: "__add",
    });

    if (providers.length > 0) {
        items.push(SEP as unknown as MainMenuPick);
    }

    for (const p of providers) {
        const enabled = p.enabled !== false;
        const statusIcon = enabled ? "$(check)" : "$(circle-slash)";
        const modelCount = p.models?.length ?? 0;
        const hasKey = !!(await getProviderApiKey(p.id, secrets));

        const label = `${statusIcon} ${p.label} (${p.id})`;
        const detail = `${p.baseUrl} · ${p.apiMode ?? "openai"} · ${modelCount} models · ${hasKey ? l10n("key set") : l10n("no key")}`;

        items.push(
            {
                label: `$(edit) ${l10n("Edit")}: ${p.label}`,
                detail,
                value: `${p.id}:edit`,
            },
            {
                label: `$(list-tree) ${l10n("Models")}: ${p.label}`,
                detail: modelCount > 0
                    ? l10nFormat("{0} models defined", String(modelCount))
                    : l10n("No static models"),
                value: `${p.id}:models`,
            },
            {
                label: `$(key) ${l10n("API Key")}: ${p.label}`,
                detail: hasKey ? l10n("API key is set (click to change)") : l10n("No API key set"),
                value: `${p.id}:apikey`,
            },
            {
                label: enabled
                    ? `$(circle-slash) ${l10n("Disable")}: ${p.label}`
                    : `$(check) ${l10n("Enable")}: ${p.label}`,
                detail: enabled ? l10n("Currently enabled") : l10n("Currently disabled"),
                value: `${p.id}:toggle`,
            },
            {
                label: `$(trash) ${l10n("Delete")}: ${p.label}`,
                detail: "",
                value: `${p.id}:delete`,
            },
            SEP as unknown as MainMenuPick,
        );
    }

    items.push({
        label: `$(settings-gear) ${l10n("Open Settings JSON")}`,
        detail: l10n("Edit providers directly in settings.json"),
        value: "__showSettings",
    });

    const picked = await vscode.window.showQuickPick(items, {
        title: l10n("Manage Providers"),
        placeHolder: l10n("Select an action"),
        ignoreFocusOut: true,
        matchOnDetail: true,
    });

    return picked?.value;
}

// ─── Provider wizard ───────────────────────────────────────────────────

async function showProviderWizard(existing?: ProviderConfig): Promise<ProviderConfig | null> {
    const isEdit = !!existing;
    const existingProviders = readAllProviders();
    const skipId = existing?.id;

    // Step 1: Provider ID
    const id = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Provider") : l10n("Add Provider"),
        prompt: l10n("Provider ID (lowercase, hyphens allowed)"),
        value: existing?.id ?? "",
        validateInput: (v) => validateProviderId(v.toLowerCase().trim(), existingProviders, skipId),
        ignoreFocusOut: true,
    });
    if (id === undefined) { return null; }

    // Step 2: Display Label
    const label = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Provider") : l10n("Add Provider"),
        prompt: l10n("Display label shown in the UI"),
        value: existing?.label ?? "",
        validateInput: (v) => v.trim() ? null : l10n("Label is required."),
        ignoreFocusOut: true,
    });
    if (label === undefined) { return null; }

    // Step 3: Base URL
    const baseUrl = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Provider") : l10n("Add Provider"),
        prompt: l10n("Base URL (must start with http/https)"),
        value: existing?.baseUrl ?? "https://",
        validateInput: (v) => v.startsWith("http") ? null : l10n("Base URL must start with http."),
        ignoreFocusOut: true,
    });
    if (baseUrl === undefined) { return null; }

    // Step 4: API Mode
    const apiModePick = await vscode.window.showQuickPick(
        [
            { label: "openai", description: l10n("OpenAI-compatible /chat/completions") },
            { label: "anthropic", description: l10n("Anthropic /v1/messages") },
            { label: "auto", description: l10n("Auto-detect from URL or model config") },
        ],
        {
            title: isEdit ? l10n("Edit Provider") : l10n("Add Provider"),
            placeHolder: l10n("Select API mode"),
            ignoreFocusOut: true,
        },
    );
    if (!apiModePick) { return null; }

    // Step 5: Group (optional)
    const group = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Provider") : l10n("Add Provider"),
        prompt: l10n("Group (model picker family, defaults to label)"),
        value: existing?.group ?? existing?.label ?? label.trim(),
        ignoreFocusOut: true,
    });
    if (group === undefined) { return null; }

    // Step 6: Models discovery URL (optional)
    const modelsBaseUrl = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Provider") : l10n("Add Provider"),
        prompt: l10n("Models discovery URL (GET /v1/models, leave empty to skip)"),
        value: existing?.modelsBaseUrl ?? "",
        ignoreFocusOut: true,
    });
    if (modelsBaseUrl === undefined) { return null; }

    return {
        id: id.toLowerCase().trim(),
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        apiMode: apiModePick.label as "openai" | "anthropic" | "auto",
        group: group.trim() || undefined,
        modelsBaseUrl: modelsBaseUrl.trim() || undefined,
        models: existing?.models ?? [],
        enabled: existing?.enabled ?? true,
    };
}

// ─── API Key prompt ────────────────────────────────────────────────────

async function promptApiKey(
    providerId: string,
    label: string,
    secrets: vscode.SecretStorage,
): Promise<void> {
    const existing = await getProviderApiKey(providerId, secrets);
    const apiKey = await vscode.window.showInputBox({
        title: l10nFormat("{0} API Key", label),
        prompt: existing ? l10n("Update your API key (clear to remove)") : l10n("Enter your API key"),
        value: existing ?? "",
        password: true,
        ignoreFocusOut: true,
    });
    if (apiKey === undefined) { return; }
    if (!apiKey.trim()) {
        await deleteProviderApiKey(providerId, secrets);
        vscode.window.showInformationMessage(l10nFormat("{0} API key cleared.", label));
    } else {
        await storeProviderApiKey(providerId, apiKey.trim(), secrets);
        vscode.window.showInformationMessage(l10nFormat("{0} API key saved.", label));
    }
}

// ─── Model sub-menu ────────────────────────────────────────────────────

interface ModelPickItem extends vscode.QuickPickItem {
    value?: string;
}

async function showModelSubMenu(
    providerId: string,
    providers: ProviderConfig[],
    secrets: vscode.SecretStorage,
): Promise<void> {
    const idx = providers.findIndex((p) => p.id === providerId);
    if (idx === -1) { return; }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const provider = providers[idx];
        const models = provider.models ?? [];
        const items: ModelPickItem[] = [];

        items.push({
            label: `$(add) ${l10n("Add Model")}`,
            detail: l10n("Add a static model definition"),
            value: "__add",
        });

        if (models.length > 0) {
            items.push(SEP as unknown as ModelPickItem);
        }

        for (let i = 0; i < models.length; i++) {
            const m = models[i];
            items.push({
                label: `$(symbol-method) ${m.name} (${m.id})`,
                detail: `vision:${m.vision ? "yes" : "no"} · thinking:${m.thinkingMode} · ctx:${m.contextLength ?? "—"} · maxOut:${m.maxOutputTokens ?? "—"}`,
                value: `${i}:edit`,
            });
            items.push({
                label: `$(trash) ${l10n("Delete")}: ${m.name}`,
                detail: "",
                value: `${i}:delete`,
            });
        }

        items.push(SEP as unknown as ModelPickItem);
        items.push({
            label: `$(arrow-left) ${l10n("Back")}`,
            detail: l10n("Return to provider menu"),
            value: "__back",
        });

        const picked = await vscode.window.showQuickPick(items, {
            title: l10nFormat("{0} Models", provider.label),
            placeHolder: l10n("Select an action"),
            ignoreFocusOut: true,
            matchOnDetail: true,
        });

        if (!picked?.value) { return; }
        if (picked.value === "__back") { return; }

        if (picked.value === "__add") {
            const created = await showModelWizard();
            if (created) {
                if (!provider.models) { provider.models = []; }
                provider.models.push(created);
                await writeAllProviders(providers);
                vscode.window.showInformationMessage(
                    l10nFormat("{0} model saved.", created.name),
                );
            }
            continue;
        }

        const [modelIdxStr, action] = picked.value.split(":", 2);
        const modelIdx = parseInt(modelIdxStr, 10);
        if (isNaN(modelIdx) || modelIdx < 0 || modelIdx >= models.length) { continue; }

        if (action === "edit") {
            const edited = await showModelWizard(models[modelIdx]);
            if (edited) {
                provider.models![modelIdx] = edited;
                await writeAllProviders(providers);
                vscode.window.showInformationMessage(
                    l10nFormat("{0} model saved.", edited.name),
                );
            }
        } else if (action === "delete") {
            const confirm = await vscode.window.showWarningMessage(
                l10nFormat("Delete model \"{0}\"?", models[modelIdx].name),
                { modal: true },
                l10n("Delete"),
            );
            if (confirm === l10n("Delete")) {
                const deletedName = models[modelIdx].name;
                provider.models!.splice(modelIdx, 1);
                await writeAllProviders(providers);
                vscode.window.showInformationMessage(
                    l10nFormat("{0} model deleted.", deletedName),
                );
            }
        }
    }
}

// ─── Model wizard ──────────────────────────────────────────────────────

async function showModelWizard(existing?: ProviderModelDef): Promise<ProviderModelDef | null> {
    const isEdit = !!existing;

    // Step 1: Model ID
    const id = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Model") : l10n("Add Model"),
        prompt: l10n("Model ID (the ID sent to the API, e.g. gpt-4o)"),
        value: existing?.id ?? "",
        validateInput: (v) => v.trim() ? null : l10n("Model ID is required."),
        ignoreFocusOut: true,
    });
    if (id === undefined) { return null; }

    // Step 2: Display Name
    const name = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Model") : l10n("Add Model"),
        prompt: l10n("Display name shown in the model picker"),
        value: existing?.name ?? "",
        validateInput: (v) => v.trim() ? null : l10n("Display name is required."),
        ignoreFocusOut: true,
    });
    if (name === undefined) { return null; }

    // Step 3: Vision support
    const visionPick = await vscode.window.showQuickPick(
        [
            { label: l10n("Yes"), description: l10n("Model supports image input") },
            { label: l10n("No"), description: l10n("Images will use vision proxy (ask_image tool)") },
        ],
        {
            title: isEdit ? l10n("Edit Model") : l10n("Add Model"),
            placeHolder: l10n("Does this model support vision?"),
            ignoreFocusOut: true,
        },
    );
    if (!visionPick) { return null; }
    const vision = visionPick.label === l10n("Yes");

    // Step 4: Thinking mode
    const thinkingPick = await vscode.window.showQuickPick(
        [
            { label: "switchable", description: l10n("User can enable or disable thinking") },
            { label: "always", description: l10n("Thinking always enabled (model requires it)") },
            { label: "adaptive", description: l10n("User can choose disabled or automatic") },
            { label: "reasoning_effort", description: l10n("Use reasoning_effort only (no thinking field)") },
        ],
        {
            title: isEdit ? l10n("Edit Model") : l10n("Add Model"),
            placeHolder: l10n("Select thinking mode"),
            ignoreFocusOut: true,
            matchOnDescription: true,
        },
    );
    if (!thinkingPick) { return null; }
    const thinkingMode = thinkingPick.label as "switchable" | "always" | "adaptive" | "reasoning_effort";

    // Step 5: Context length
    const ctxStr = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Model") : l10n("Add Model"),
        prompt: l10n("Context length (max input tokens)"),
        value: String(existing?.contextLength ?? 128000),
        validateInput: (v) => {
            const n = parseInt(v, 10);
            return (!isNaN(n) && n > 0) ? null : l10n("Must be a positive number.");
        },
        ignoreFocusOut: true,
    });
    if (ctxStr === undefined) { return null; }
    const contextLength = parseInt(ctxStr, 10);

    // Step 6: Max output tokens
    const maxOutStr = await vscode.window.showInputBox({
        title: isEdit ? l10n("Edit Model") : l10n("Add Model"),
        prompt: l10n("Max output tokens"),
        value: String(existing?.maxOutputTokens ?? 4096),
        validateInput: (v) => {
            const n = parseInt(v, 10);
            return (!isNaN(n) && n > 0) ? null : l10n("Must be a positive number.");
        },
        ignoreFocusOut: true,
    });
    if (maxOutStr === undefined) { return null; }
    const maxOutputTokens = parseInt(maxOutStr, 10);

    return {
        id: id.trim(),
        name: name.trim(),
        vision,
        thinkingMode,
        contextLength,
        maxOutputTokens,
    };
}
