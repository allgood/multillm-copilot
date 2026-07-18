import * as vscode from "vscode";
import type { LanguageModelChatInformation } from "vscode";
import type { ProviderConfig, ProviderModelDef, OpenCodeGoModelItem } from "./types";
import { l10n } from "./localize";
import { logger } from "./logger";

/**
 * Five-minute cache for dynamic model list fetches.
 */
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

interface ModelCacheEntry {
    models: DynamicModelInfo[];
    timestamp: number;
}

/**
 * Metadata parsed from public /v1/models endpoint (OpenAI extended format).
 */
export interface DynamicModelInfo {
    id: string;
    owned_by?: string;
    context_window?: number;
    max_output_tokens?: number;
    capabilities?: {
        vision?: boolean;
        reasoning?: boolean;
        tool_calls?: boolean;
        chat?: boolean;
    };
}

const modelCache = new Map<string, ModelCacheEntry>();

/**
 * Read all enabled providers from configuration.
 */
export function getProviders(): ProviderConfig[] {
    const config = vscode.workspace.getConfiguration();
    const providers = config.get<ProviderConfig[]>("multiLLM.providers", []);
    return providers.filter((p) => p.enabled !== false);
}

/**
 * Fetch model list from a provider's models endpoint.
 * Expected format: OpenAI /v1/models — { data: [{ id, context_window, max_output_tokens, capabilities }] }
 * Auth is optional — works with or without API key.
 */
async function fetchDynamicModels(baseUrl: string, apiKey?: string): Promise<DynamicModelInfo[]> {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {};
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(url, { headers });

    if (!response.ok) {
        throw new Error(`Models API error: [${response.status}] ${response.statusText}`);
    }

    const body = (await response.json()) as {
        data?: Array<{
            id: string;
            owned_by?: string;
            context_window?: number;
            max_output_tokens?: number;
            capabilities?: {
                vision?: boolean;
                reasoning?: boolean;
                tool_calls?: boolean;
                chat?: boolean;
            };
        }>;
    };
    return (body.data ?? []).map((m) => ({
        id: m.id,
        owned_by: m.owned_by,
        context_window: m.context_window,
        max_output_tokens: m.max_output_tokens,
        capabilities: m.capabilities,
    }));
}

/**
 * Resolve dynamic models for a provider, with 5-minute cache.
 */
async function resolveDynamicModels(provider: ProviderConfig, apiKey?: string): Promise<DynamicModelInfo[]> {
    if (!provider.modelsBaseUrl) {
        return [];
    }

    const now = Date.now();
    const cached = modelCache.get(provider.id);
    if (cached && now - cached.timestamp < MODEL_CACHE_TTL_MS) {
        return cached.models;
    }

    try {
        const models = await fetchDynamicModels(provider.modelsBaseUrl, apiKey);
        modelCache.set(provider.id, { models, timestamp: now });
        return models;
    } catch (error) {
        logger.warn("providers.dynamic-fetch-failed", {
            providerId: provider.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return modelCache.get(provider.id)?.models ?? [];
    }
}

/**
 * Build LanguageModelChatInformation list from a static provider model definition.
 */
function buildStaticModelInfo(
    def: ProviderModelDef,
    group: string,
    providerId: string,
): LanguageModelChatInformation {
    const maxInput = def.contextLength ?? 128000;
    const maxOutput = def.maxOutputTokens ?? 4096;

    const hasEfforts = def.supportedReasoningEfforts && def.supportedReasoningEfforts.length > 0;
    let enumValues: string[];
    if (hasEfforts) {
        enumValues = def.thinkingMode === "switchable"
            ? ["disabled", ...def.supportedReasoningEfforts!]
            : [...def.supportedReasoningEfforts!];
    } else {
        if (def.thinkingMode === "switchable") {
            enumValues = ["disabled", "enabled"];
        } else if (def.thinkingMode === "adaptive") {
            enumValues = ["disabled", "adaptive"];
        } else {
            enumValues = ["enabled"];
        }
    }

    const getLabel = (e: string): string => {
        switch (e) {
            case "disabled": return l10n("Disabled");
            case "adaptive": return l10n("Adaptive");
            case "enabled": return l10n("Thinking");
            case "low": return l10n("Low");
            case "medium": return l10n("Medium");
            case "high": return l10n("High");
            case "max": return l10n("Maximum");
            default: return e.charAt(0).toUpperCase() + e.slice(1);
        }
    };

    const getDesc = (e: string): string => {
        switch (e) {
            case "disabled": return l10n("Do not enable thinking");
            case "adaptive": return l10n("Automatically decide when to think");
            case "enabled": return l10n("Enable thinking");
            case "low": return l10n("Reduce thinking, faster response");
            case "medium": return l10n("Balance thinking and speed");
            case "high": return l10n("Deeper thinking, slower response");
            case "max": return l10n("Maximum thinking depth, slowest response");
            default: return e;
        }
    };

    const enumItemLabels = enumValues.map(getLabel);
    const enumDescriptions = enumValues.map(getDesc);

    const defaultEffort = (hasEfforts && def.defaultReasoningEffort)
        ? def.defaultReasoningEffort
        : enumValues[enumValues.length - 1];

    const info: LanguageModelChatInformation = {
        id: `${providerId}:${def.id}`,
        name: def.name,
        detail: group,
        tooltip: group,
        family: providerId,
        version: "1.0.0",
        maxInputTokens: maxInput,
        maxOutputTokens: maxOutput,
        isUserSelectable: true,
        capabilities: {
            toolCalling: true,
            imageInput: true,
        },
        configurationSchema: {
            properties: {
                reasoningEffort: {
                    type: "string",
                    title: l10n("Reasoning Effort"),
                    enum: enumValues,
                    enumItemLabels,
                    enumDescriptions,
                    default: defaultEffort,
                    group: "navigation",
                },
            },
        },
    };

    return info as LanguageModelChatInformation;
}

/**
 * Build a LanguageModelChatInformation for a dynamic model using API-provided metadata.
 */
function buildDynamicModelInfo(
    model: DynamicModelInfo,
    group: string,
    providerId: string,
): LanguageModelChatInformation {
    const vision = model.capabilities?.vision ?? false;
    const supportsReasoning = model.capabilities?.reasoning ?? false;
    const ctx = model.context_window ?? 128000;
    const maxOut = model.max_output_tokens ?? 4096;
    const name = model.id;

    let enumValues: string[];
    let enumItemLabels: string[];
    let enumDescriptions: string[];
    let defaultEffort: string;

    if (supportsReasoning) {
        enumValues = ["disabled", "enabled"];
        enumItemLabels = [l10n("Disabled"), l10n("Thinking")];
        enumDescriptions = [l10n("Do not enable thinking"), l10n("Enable thinking")];
        defaultEffort = "disabled";
    } else {
        enumValues = ["disabled"];
        enumItemLabels = [l10n("Disabled")];
        enumDescriptions = [l10n("Do not enable thinking")];
        defaultEffort = "disabled";
    }

    return {
        id: `${providerId}:${model.id}`,
        name,
        detail: group,
        tooltip: group,
        family: providerId,
        version: "1.0.0",
        maxInputTokens: ctx,
        maxOutputTokens: maxOut,
        isUserSelectable: true,
        capabilities: {
            toolCalling: model.capabilities?.tool_calls ?? true,
            imageInput: true,
        },
        configurationSchema: {
            properties: {
                reasoningEffort: {
                    type: "string",
                    title: l10n("Reasoning Effort"),
                    enum: enumValues,
                    enumItemLabels,
                    enumDescriptions,
                    default: defaultEffort,
                    group: "navigation",
                },
            },
        },
    } as LanguageModelChatInformation;
}

/**
 * Get all model infos across all providers (merged list for model picker).
 */
export async function getAllModelInfos(
    secrets: vscode.SecretStorage,
): Promise<LanguageModelChatInformation[]> {
    const providers = getProviders();
    const infos: LanguageModelChatInformation[] = [];
    const seenIds = new Set<string>();

    for (const provider of providers) {
        const group = provider.group || provider.label;
        const providerBaseUrl = provider.baseUrl;
        const staticModelIds = new Set<string>();

        // Static models
        if (provider.models) {
            for (const def of provider.models) {
                const info = buildStaticModelInfo(def, group, provider.id);
                const infoId = (info as { id: string }).id;
                if (!seenIds.has(infoId)) {
                    seenIds.add(infoId);
                    infos.push(info);
                }
                staticModelIds.add(def.id);
            }
        }

        // Dynamic models (only those not already defined statically)
        if (provider.modelsBaseUrl) {
            const apiKey = await getProviderApiKey(provider.id, secrets);
            const dynamicModels = await resolveDynamicModels(provider, apiKey);
            for (const model of dynamicModels) {
                if (staticModelIds.has(model.id)) {
                    continue;
                }
                const info = buildDynamicModelInfo(model, group, provider.id);
                const infoId = (info as { id: string }).id;
                if (!seenIds.has(infoId)) {
                    seenIds.add(infoId);
                    infos.push(info);
                }
            }
        }
    }

    logger.info("models.loaded", { count: infos.length, providers: providers.map((p) => p.id).join(",") });
    return infos;
}

// ─── Secret Storage helpers ────────────────────────────────────────────

function secretKey(providerId: string): string {
    return `multiLLM.provider.${providerId}.apiKey`;
}

/**
 * Get stored API key for a provider.
 */
export async function getProviderApiKey(
    providerId: string,
    secrets: vscode.SecretStorage,
): Promise<string | undefined> {
    return secrets.get(secretKey(providerId));
}

/**
 * Store API key for a provider.
 */
export async function storeProviderApiKey(
    providerId: string,
    apiKey: string,
    secrets: vscode.SecretStorage,
): Promise<void> {
    await secrets.store(secretKey(providerId), apiKey);
}

/**
 * Delete API key for a provider.
 */
export async function deleteProviderApiKey(
    providerId: string,
    secrets: vscode.SecretStorage,
): Promise<void> {
    await secrets.delete(secretKey(providerId));
}

// ─── Model config resolution ───────────────────────────────────────────

/**
 * Parse a composite model ID back to provider ID + base model ID.
 * Format: "providerId:modelId"
 */
export function parseCompositeModelId(compositeId: string): { providerId: string; modelId: string } {
    const colonIdx = compositeId.indexOf(":");
    if (colonIdx === -1) {
        return { providerId: "", modelId: compositeId };
    }
    return { providerId: compositeId.slice(0, colonIdx), modelId: compositeId.slice(colonIdx + 1) };
}

/**
 * Build an OpenCodeGoModelItem from a composite model ID by looking up the
 * provider config and the model definition within it.
 * Returns undefined if the model ID does not match any known provider/model.
 */
export function getModelConfig(compositeId: string): OpenCodeGoModelItem | undefined {
    const { providerId, modelId } = parseCompositeModelId(compositeId);
    if (!providerId) {
        return undefined;
    }

    const providers = getProviders();
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) {
        return undefined;
    }

    // Try static model definition first
    if (provider.models) {
        const def = provider.models.find((m) => m.id === modelId);
        if (def) {
            return defToModelItem(def, provider);
        }
    }

    // Try dynamic model (generic fallback)
    return {
        id: modelId,
        owned_by: providerId,
        displayName: modelId,
        baseUrl: provider.baseUrl,
        vision: false,
        context_length: 128000,
        max_completion_tokens: 4096,
        apiMode: provider.apiMode === "auto" ? "openai" : (provider.apiMode ?? "openai"),
        enable_thinking: false,
        include_reasoning_in_request: true,
        thinkingMode: "switchable",
        headers: provider.headers,
        delay: provider.delay,
        family: providerId,
    };
}

function defToModelItem(def: ProviderModelDef, provider: ProviderConfig): OpenCodeGoModelItem {
    const apiMode = def.apiMode
        ?? (provider.apiMode === "auto" ? "openai" : (provider.apiMode ?? "openai"));

    return {
        id: def.id,
        owned_by: provider.id,
        displayName: def.name,
        baseUrl: provider.baseUrl,
        vision: def.vision,
        context_length: def.contextLength ?? 128000,
        max_completion_tokens: def.maxOutputTokens ?? 4096,
        apiMode,
        enable_thinking: true,
        include_reasoning_in_request: def.includeReasoningInRequest ?? true,
        thinkingMode: def.thinkingMode,
        reasoning_effort: def.defaultReasoningEffort,
        extra: def.extra,
        headers: provider.headers,
        delay: provider.delay,
        family: provider.id,
    };
}
