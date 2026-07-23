import * as vscode from "vscode";
import {
    CancellationToken,
    LanguageModelChatInformation,
    LanguageModelChatProvider,
    LanguageModelChatRequestMessage,
    LanguageModelResponsePart,
    PrepareLanguageModelChatModelOptions,
    ProvideLanguageModelChatResponseOptions,
    Progress,
} from "vscode";

import * as path from "path";

import type { ModelPreset, MultiLLMModelItem } from "./types";

import { createRetryConfig, executeWithRetry, convertToolsToOpenAI } from "./utils";

import { prepareLanguageModelChatInformation } from "./provideModel";
import { getModelConfig, parseCompositeModelId, getProviderApiKey, storeProviderApiKey } from "./providers";
import { l10nFormat } from "./localize";
import { countMessageTokens, textTokenLength } from "./provideToken";
import { updateContextStatusBar, recordUsage, updateCumulativeTooltip, updateStatusBarWithApiPrompt } from "./statusBar";
import { OpenaiApi } from "./openai/openaiApi";
import { AnthropicApi } from "./anthropic/anthropicApi";
import type { AnthropicRequestBody } from "./anthropic/anthropicTypes";
import { CommonApi, type StreamUsage } from "./commonApi";
import { callVisionModel, callVisionModelMulti } from "./vision/imageProxy";
import { ASK_IMAGE_TOOL_NAME, ASK_IMAGE_TOOL_DEF, ASK_WITH_MULTI_IMAGE_TOOL_NAME, ASK_WITH_MULTI_IMAGE_TOOL_DEF } from "./vision/types";
import type { InterceptedToolCall, StoredImage } from "./vision/types";
import { logger } from "./logger";
import { l10n } from "./localize";

/**
 * Native Copilot Token Indicator
 *
 * Reports token usage to the Copilot Chat's built-in token indicator by emitting
 * a LanguageModelDataPart with MIME type 'usage'.
 */
function reportNativeUsage(
    usage: StreamUsage,
    progress: Progress<LanguageModelResponsePart>
): void {
    progress.report(
        new vscode.LanguageModelDataPart(
            new TextEncoder().encode(JSON.stringify({
                prompt_tokens: usage.promptTokens,
                completion_tokens: usage.completionTokens,
                total_tokens: usage.promptTokens + usage.completionTokens,
                prompt_tokens_details: {
                    cached_tokens: usage.cacheHitTokens ?? 0,
                },
            })),
            "usage"
        )
    );
}

function getRequestedReasoningEffort(options: ProvideLanguageModelChatResponseOptions): string | undefined {
    const modelConfigurationEffort = options.modelConfiguration?.reasoningEffort;
    if (typeof modelConfigurationEffort === "string") {
        return modelConfigurationEffort;
    }

    const modelOptions = (options as unknown as { modelOptions?: Record<string, unknown> }).modelOptions;
    const modelOptionsThinking = modelOptions?.thinking as { type?: unknown } | undefined;
    if (modelOptionsThinking?.type === false) {
        return "disabled";
    }

    const modelOptionsEffort = modelOptions?.reasoning_effort ?? modelOptions?.reasoningEffort;
    return typeof modelOptionsEffort === "string" ? modelOptionsEffort : undefined;
}

/**
 * VS Code Chat provider backed by user-configured multi-provider APIs.
 */
export class MultiLLMChatModelProvider implements LanguageModelChatProvider {
    /** Track last request completion time for delay calculation. */
    private _lastRequestTime: number | null = null;

    constructor(
        private readonly secrets: vscode.SecretStorage,
        private readonly statusBarItem: vscode.StatusBarItem
    ) { }

    /**
     * Create an undici fetch function with custom bodyTimeout.
     */
    private _createFetchWithTimeout(requestTimeoutMs: number): typeof fetch {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const undici = require(path.join(vscode.env.appRoot, "node_modules", "undici"));
            const agent = new undici.Agent({ bodyTimeout: requestTimeoutMs });
            return (url: RequestInfo | URL, init?: RequestInit) => {
                return undici.fetch(url, { ...init, dispatcher: agent });
            };
        } catch {
            return fetch;
        }
    }

    async provideLanguageModelChatInformation(
        options: PrepareLanguageModelChatModelOptions,
        _token: CancellationToken
    ): Promise<LanguageModelChatInformation[]> {
        return prepareLanguageModelChatInformation(options, _token, this.secrets);
    }

    async provideTokenCount(
        _model: LanguageModelChatInformation,
        text: string | LanguageModelChatRequestMessage,
        _token: CancellationToken
    ): Promise<number> {
        return countMessageTokens(text, { includeReasoningInRequest: true });
    }

    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: readonly LanguageModelChatRequestMessage[],
        options: ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart>,
        token: CancellationToken
    ): Promise<void> {
        let usageReportedDuringStream = false;
        const collectedOutputText: string[] = [];
        const trackingProgress: Progress<LanguageModelResponsePart> = {
            report: (part) => {
                try {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        collectedOutputText.push(part.value);
                    }
                    progress.report(part);
                } catch (e) {
                    console.error("[MultiLLM] Progress.report failed", {
                        modelId: model.id,
                        error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
                    });
                }
            },
        };
        const requestStartTime = Date.now();

        let abortController = new AbortController();
        let requestTimeoutMs = 600000;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let dispatchFetch: typeof fetch;

        try {
            const config = vscode.workspace.getConfiguration();

            // Resolve model config from provider system
            const um = getModelConfig(model.id);

            // Apply reasoning effort
            if (um) {
                const effort = getRequestedReasoningEffort(options);
                if (effort) {
                    if (effort === "disabled") {
                        if (um.thinkingMode !== "always") {
                            um.enable_thinking = false;
                            um.include_reasoning_in_request = false;
                            um.reasoning_effort = undefined;
                        }
                    } else {
                        um.enable_thinking = true;
                        um.include_reasoning_in_request = true;
                        if (effort !== "enabled") {
                            um.reasoning_effort = effort;
                        }
                    }
                }
            }

            // Inject temperature & top_p from presets or custom settings
            if (um) {
                if (um.supportsTemperature !== false) {
                    const tempPreset = config.get<string>("multiLLM.modelPreset", "custom");
                    if (tempPreset !== "custom") {
                        const presets = config.get<ModelPreset[]>("multiLLM.modelPresets", []);
                        const matchedPreset = presets.find((p) => p.id === tempPreset);
                        if (matchedPreset) {
                            um.temperature = matchedPreset.temperature;
                        }
                    } else {
                        const userTemperature = config.get<number | null>("multiLLM.temperature", null);
                        if (userTemperature !== null) {
                            um.temperature = userTemperature;
                        }
                        const userTopP = config.get<number | null>("multiLLM.top_p", null);
                        if (userTopP !== null) {
                            um.top_p = userTopP;
                        } else {
                            // Keep top_p undefined so the model uses its default
                            um.top_p = undefined;
                        }
                    }
                } else {
                    // Model does not support temperature; ensure it's not sent
                    um.temperature = undefined;
                    um.top_p = undefined;
                }
            }

            // Determine API mode and base URL from model config
            const apiMode = um?.apiMode || "openai";
            const baseUrl = um?.baseUrl;
            if (!baseUrl || !baseUrl.startsWith("http")) {
                throw new Error(l10n("Invalid base URL configuration."));
            }

            logger.info("request.start", {
                modelId: model.id,
                messageCount: messages.length,
                apiMode,
                baseUrl,
            });

            // Prepare model configuration
            const modelConfig = {
                includeReasoningInRequest: um?.include_reasoning_in_request ?? true,
                vision: um?.vision ?? false,
            };

            // Advanced Token indicator setting
            const enableThirdPartyIndicator = config.get<boolean>("multiLLM.enableThirdPartyTokenIndicator", true);

            // Calculate client-side token estimate
            const estimatedInputTokens = await updateContextStatusBar(messages, options.tools, model, this.statusBarItem, modelConfig);

            // Apply delay between consecutive requests
            const modelDelay = um?.delay;
            const globalDelay = config.get<number>("multiLLM.delay", 0);
            const delayMs = modelDelay !== undefined ? modelDelay : globalDelay;

            if (delayMs > 0 && this._lastRequestTime !== null) {
                const elapsed = Date.now() - this._lastRequestTime;
                if (elapsed < delayMs) {
                    const remainingDelay = delayMs - elapsed;
                    logger.debug("request.delay", { delayMs, elapsed, remainingDelay });
                    await new Promise<void>((resolve) => {
                        const timeout = setTimeout(() => { clearTimeout(timeout); resolve(); }, remainingDelay);
                    });
                }
            }

            // Get API key for this model's provider
            const { providerId } = parseCompositeModelId(model.id);
            const modelApiKey = await this.getModelApiKey(providerId);
            if (!modelApiKey) {
                throw new Error(l10n("API key not found for this provider. Please set it in settings."));
            }

            const BASE_URL = baseUrl;

            // Retry config
            const retryConfig = createRetryConfig();

            // Request timeout
            requestTimeoutMs = config.get<number>("multiLLM.requestTimeout", 600000);
            abortController = new AbortController();
            timeoutId = setTimeout(() => abortController.abort(), requestTimeoutMs);
            if (token.onCancellationRequested) {
                token.onCancellationRequested(() => {
                    if (!abortController.signal.aborted) {
                        abortController.abort();
                    }
                });
            }

            dispatchFetch = this._createFetchWithTimeout(requestTimeoutMs);

            // Prepare headers
            const requestHeaders = CommonApi.prepareHeaders(modelApiKey, apiMode, um?.headers);
            logger.debug("request.headers", {
                headers: logger.sanitizeHeaders(requestHeaders as Record<string, string>),
            });

            if (apiMode === "anthropic") {
                // ── Anthropic API mode ──
                const anthropicApi = new AnthropicApi(model.id);
                anthropicApi.onUsage = (usage) => {
                    usageReportedDuringStream = true;
                    reportNativeUsage(usage, progress);
                    if (enableThirdPartyIndicator) {
                        recordUsage(usage);
                        updateCumulativeTooltip(this.statusBarItem);
                        updateStatusBarWithApiPrompt(usage.promptTokens, model.maxInputTokens || 128000, this.statusBarItem);
                    }
                };
                const anthropicMessages = anthropicApi.convertMessages(messages, modelConfig);

                let requestBody: AnthropicRequestBody = {
                    model: um?.id ?? model.id,
                    messages: anthropicMessages,
                    stream: true,
                };
                requestBody = anthropicApi.prepareRequestBody(requestBody, um, options);

                const normalizedBaseUrl = BASE_URL.replace(/\/+$/, "");
                const url = normalizedBaseUrl.endsWith("/v1")
                    ? `${normalizedBaseUrl}/messages`
                    : `${normalizedBaseUrl}/v1/messages`;

                // Log the full request body for debugging
                console.error("[MultiLLM] Anthropic request body:", JSON.stringify(requestBody, null, 2));

                const response = await executeWithRetry(async () => {
                    const res = await dispatchFetch(url, {
                        method: "POST",
                        headers: requestHeaders,
                        body: JSON.stringify(requestBody),
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error("[MultiLLM] API error response", errorText);
                        if (errorText.includes("image is sensitive")) {
                            throw new Error(`IMAGE_SENSITIVE: ${errorText}`);
                        }
                        throw new Error(
                            `API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`
                        );
                    }

                    return res;
                }, retryConfig);

                if (!response.body) {
                    throw new Error("No response body from API");
                }
                await anthropicApi.processStreamingResponse(response.body, trackingProgress, token);

                // Handle vision proxy interception
                clearTimeout(timeoutId);
                await this._handleInterceptedToolCall({
                    api: anthropicApi,
                    apiMode: "anthropic",
                    model: model,
                    um: um,
                    modelApiKey: modelApiKey,
                    baseUrl: BASE_URL,
                    dispatchFetch: dispatchFetch,
                    requestHeaders: requestHeaders,
                    retryConfig: retryConfig,
                    abortController: abortController,
                    trackingProgress: trackingProgress,
                    token: token,
                    options: options,
                });
            } else {
                // ── OpenAI API mode ──
                const openaiApi = new OpenaiApi(model.id);
                openaiApi.onUsage = (usage) => {
                    usageReportedDuringStream = true;
                    reportNativeUsage(usage, progress);
                    if (enableThirdPartyIndicator) {
                        recordUsage(usage);
                        updateCumulativeTooltip(this.statusBarItem);
                        updateStatusBarWithApiPrompt(usage.promptTokens, model.maxInputTokens || 128000, this.statusBarItem);
                    }
                };
                const openaiMessages = openaiApi.convertMessages(messages, modelConfig);

                let requestBody: Record<string, unknown> = {
                    model: um?.id ?? model.id,
                    messages: openaiMessages,
                    stream: true,
                    stream_options: { include_usage: true },
                };

                requestBody = openaiApi.prepareRequestBody(requestBody, um, options);

                const url = `${BASE_URL.replace(/\/+$/, "")}/chat/completions`;

                const response = await executeWithRetry(async () => {
                    const res = await dispatchFetch(url, {
                        method: "POST",
                        headers: requestHeaders,
                        body: JSON.stringify(requestBody),
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error("[MultiLLM] API error response", errorText);
                        if (errorText.includes("image is sensitive")) {
                            throw new Error(`IMAGE_SENSITIVE: ${errorText}`);
                        }
                        throw new Error(
                            `API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`
                        );
                    }

                    return res;
                }, retryConfig);

                if (!response.body) {
                    throw new Error("No response body from API");
                }

                await openaiApi.processStreamingResponse(response.body, trackingProgress, token);

                // Handle vision proxy interception
                clearTimeout(timeoutId);
                await this._handleInterceptedToolCall({
                    api: openaiApi,
                    apiMode: "openai",
                    model: model,
                    um: um,
                    modelApiKey: modelApiKey,
                    baseUrl: BASE_URL,
                    dispatchFetch: dispatchFetch,
                    requestHeaders: requestHeaders,
                    retryConfig: retryConfig,
                    abortController: abortController,
                    trackingProgress: trackingProgress,
                    token: token,
                    options: options,
                });
            }

            // Fallback: client-side token estimate
            if (!usageReportedDuringStream) {
                const outputText = collectedOutputText.join("");
                const estimatedOutputTokens = outputText ? await textTokenLength(outputText) : 0;
                const fallbackUsage: StreamUsage = {
                    promptTokens: estimatedInputTokens,
                    completionTokens: estimatedOutputTokens,
                };
                reportNativeUsage(fallbackUsage, progress);
                if (enableThirdPartyIndicator) {
                    recordUsage(fallbackUsage);
                    updateCumulativeTooltip(this.statusBarItem);
                }
            }
        } catch (err) {
            const errMessage = err instanceof Error ? err.message : String(err);
            const isUserCancelled = token.isCancellationRequested;
            const isTimeout = abortController.signal.aborted && !isUserCancelled;
            const isForceTerminated =
                !isTimeout &&
                !isUserCancelled &&
                (errMessage.includes("terminated") ||
                 errMessage.includes("aborted") ||
                 (err instanceof Error && err.name === "AbortError"));

            if (isUserCancelled) {
                throw err;
            }

            if (isTimeout || isForceTerminated) {
                logger.error("request.timeout", {
                    modelId: model.id,
                    timeoutMs: requestTimeoutMs,
                    durationMs: Date.now() - requestStartTime,
                    reason: isForceTerminated ? "connection_terminated" : "timeout",
                });
                if (isForceTerminated) {
                    throw new Error(l10n("The connection was closed by the server. The generation took too long. Please try again or request shorter content."));
                }
                throw new Error(l10n("Request timed out. The generation took too long. You can increase the timeout in settings (multiLLM.requestTimeout)."));
            }

            // Detect image content moderation rejection
            if (errMessage.includes("IMAGE_SENSITIVE:")) {
                logger.error("request.error", {
                    modelId: model.id,
                    error: "image_sensitive",
                    errorMessage: errMessage,
                });
                throw new Error(l10n("The image you sent was flagged as sensitive by the content moderation system. Please try a different image."));
            }

            console.error("[MultiLLM] Chat request failed", {
                modelId: model.id,
                messageCount: messages.length,
                error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
            });
            logger.error("request.error", {
                modelId: model.id,
                messageCount: messages.length,
                errorName: err instanceof Error ? err.name : String(err),
                errorMessage: err instanceof Error ? err.message : String(err),
            });
            throw err;
        } finally {
            clearTimeout(timeoutId);
            const durationMs = Date.now() - requestStartTime;
            logger.info("request.end", { modelId: model.id, durationMs });
            this._lastRequestTime = Date.now();
        }
    }

    /**
     * Handle ask_image tool call interception with multi-round vision proxy.
     */
    private async _handleInterceptedToolCall(params: {
        api: CommonApi<any, any>;
        apiMode: string;
        model: LanguageModelChatInformation;
        um: MultiLLMModelItem | undefined;
        modelApiKey: string;
        baseUrl: string;
        dispatchFetch: typeof fetch;
        requestHeaders: Record<string, string>;
        retryConfig: ReturnType<typeof createRetryConfig>;
        abortController: AbortController;
        trackingProgress: Progress<LanguageModelResponsePart>;
        token: CancellationToken;
        options: ProvideLanguageModelChatResponseOptions;
    }): Promise<void> {
        const api = params.api;
        const storedMessages = (api as any)._originalApiMessages as any[] | undefined;
        const hasLocalImages = ((api as any)._localImages as any[])?.length > 0;

        if (!hasLocalImages) { return; }
        if (!storedMessages || storedMessages.length === 0) { return; }

        const config = vscode.workspace.getConfiguration();
        const visionModelId = config.get<string>("multiLLM.visionProxyModel", "qwen3.6-plus");
        const maxRounds = config.get<number>("multiLLM.visionMaxRounds", 5);

        let currentMessages: any[] = [...storedMessages];

        for (let round = 1; round <= maxRounds; round++) {
            const intercepted = api.interceptedToolCall;
            if (!intercepted) { break; }
            api.interceptedToolCall = null;

            logger.info("vision.intercepted", {
                round,
                toolName: intercepted.name,
                imageIndex: intercepted.args.imageIndex,
                imageIndices: intercepted.args.imageIndices,
                query: intercepted.args.query,
                apiMode: params.apiMode,
            });

            const visionPrompt = intercepted.args.query;

            // Show model's question in thinking block
            const questionThinkId = `vision_q_${Date.now()}_${round}`;
            params.trackingProgress.report(
                new vscode.LanguageModelThinkingPart(
                    l10nFormat("Querying vision model: \"{0}\"", visionPrompt ?? ""),
                    questionThinkId
                ) as unknown as LanguageModelResponsePart
            );
            params.trackingProgress.report(
                new vscode.LanguageModelThinkingPart("", questionThinkId) as unknown as LanguageModelResponsePart
            );

            const thinkBlockId = `vision_think_${Date.now()}_${round}`;
            const textBlockId = `vision_text_${Date.now()}_${round}`;

            const visionProgress = {
                onThinking: (text: string) => {
                    params.trackingProgress.report(
                        new vscode.LanguageModelThinkingPart(text, thinkBlockId) as unknown as LanguageModelResponsePart
                    );
                },
                onText: (text: string) => {
                    params.trackingProgress.report(
                        new vscode.LanguageModelThinkingPart(text, textBlockId) as unknown as LanguageModelResponsePart
                    );
                },
            };

            let description: string;
            try {
                if (intercepted.name === ASK_WITH_MULTI_IMAGE_TOOL_NAME) {
                    const indices = intercepted.args.imageIndices ?? [];
                    const images: StoredImage[] = [];
                    for (const idx of indices) {
                        const img = api.getStoredImage(idx);
                        if (img) images.push(img);
                    }
                    if (images.length < 2) {
                        logger.warn("vision.not-enough-images", { indices });
                        description = "[Not enough images for comparison]";
                    } else {
                        description = await callVisionModelMulti(images, visionModelId, visionPrompt, params.token, visionProgress);
                    }
                } else {
                    const storedImage = api.getStoredImage(intercepted.args.imageIndex ?? 0);
                    if (!storedImage) {
                        logger.warn("vision.image-not-found", { imageIndex: intercepted.args.imageIndex });
                        description = "[Image not found]";
                    } else {
                        description = await callVisionModel(
                            storedImage.data, storedImage.mimeType,
                            visionModelId, visionPrompt, params.token, visionProgress
                        );
                    }
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                logger.error("vision.call-failed", { error: errMsg, visionModelId });
                description = "[Image query unavailable]";
            }

            params.trackingProgress.report(
                new vscode.LanguageModelThinkingPart("", thinkBlockId) as unknown as LanguageModelResponsePart
            );
            params.trackingProgress.report(
                new vscode.LanguageModelThinkingPart("", textBlockId) as unknown as LanguageModelResponsePart
            );

            if (params.token.isCancellationRequested) { break; }

            const roundAbortController = new AbortController();
            const roundTimeoutMs = vscode.workspace.getConfiguration().get<number>("multiLLM.requestTimeout", 600000);
            const roundTimeoutId = setTimeout(() => {
                if (!roundAbortController.signal.aborted) {
                    roundAbortController.abort();
                }
            }, roundTimeoutMs);
            if (params.token.onCancellationRequested) {
                params.token.onCancellationRequested(() => {
                    if (!roundAbortController.signal.aborted) {
                        roundAbortController.abort();
                    }
                });
            }

            try {
                if (params.apiMode === "anthropic") {
                    currentMessages.push({
                        role: "assistant" as const,
                        content: [
                            { type: "tool_use" as const, id: intercepted.id, name: intercepted.name, input: intercepted.args },
                        ],
                    });
                    currentMessages.push({
                        role: "user" as const,
                        content: [
                            { type: "tool_result" as const, tool_use_id: intercepted.id, content: description },
                        ],
                    });

                    const body: Record<string, unknown> = {
                        model: params.um?.id ?? params.model.id,
                        messages: currentMessages,
                        stream: true,
                    };
                    if (params.um?.max_completion_tokens !== undefined) {
                        body.max_tokens = params.um.max_completion_tokens;
                    } else if (params.um?.max_tokens !== undefined) {
                        body.max_tokens = params.um.max_tokens;
                    }
                    if (params.um?.temperature !== undefined && params.um.temperature !== null) {
                        if (params.um.supportsTemperature !== false) {
                            body.temperature = params.um.temperature;
                        }
                    }
                    const systemContent = (params.api as any)._systemContent as string | undefined;
                    if (systemContent) { body.system = systemContent; }
                    if (params.um?.enable_thinking === true) {
                        if (params.um?.reasoning_effort === "adaptive") {
                            body.thinking = { type: "adaptive" };
                        } else {
                            body.thinking = { type: "enabled", budget_tokens: 8192 };
                        }
                    }

                    const anthropicToolList: Array<{ name: string; description?: string; input_schema?: object }> = [];
                    const toolConfig = convertToolsToOpenAI(params.options);
                    if (toolConfig.tools) {
                        for (const tool of toolConfig.tools) {
                            anthropicToolList.push({
                                name: tool.function.name,
                                description: tool.function.description,
                                input_schema: tool.function.parameters,
                            });
                        }
                    }
                    if (hasLocalImages) {
                        const singleDef = ASK_IMAGE_TOOL_DEF as unknown as { function: { name: string; description: string; parameters: object } };
                        anthropicToolList.push({
                            name: singleDef.function.name,
                            description: singleDef.function.description,
                            input_schema: singleDef.function.parameters,
                        });
                        if (((api as any)._localImages as any[])?.length >= 2) {
                            const multiDef = ASK_WITH_MULTI_IMAGE_TOOL_DEF as unknown as { function: { name: string; description: string; parameters: object } };
                            anthropicToolList.push({
                                name: multiDef.function.name,
                                description: multiDef.function.description,
                                input_schema: multiDef.function.parameters,
                            });
                        }
                    }
                    if (anthropicToolList.length > 0) { body.tools = anthropicToolList; }
                    // Allow the model to freely call ask_image again in this round
                    if (hasLocalImages) {
                        body.tool_choice = { type: "auto" };
                    }

                    const normalizedUrl = params.baseUrl.replace(/\/+$/, "");
                    const url = normalizedUrl.endsWith("/v1")
                        ? `${normalizedUrl}/messages`
                        : `${normalizedUrl}/v1/messages`;

                    const response = await executeWithRetry(async () => {
                        const res = await params.dispatchFetch(url, {
                            method: "POST",
                            headers: params.requestHeaders,
                            body: JSON.stringify(body),
                            signal: roundAbortController.signal,
                        });
                        if (!res.ok) {
                            const errorText = await res.text();
                            throw new Error(`API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}`);
                        }
                        return res;
                    }, params.retryConfig);

                    if (response.body) {
                        await api.processStreamingResponse(response.body, params.trackingProgress, params.token);
                    }
                } else {
                    // OpenAI format: append assistant tool_call + tool result
                    // Use the reasoning_content captured from the previous round's streaming response.
                    // DeepSeek thinking mode requires the original reasoning_content to be echoed back
                    // verbatim on every assistant message that follows a tool call — hardcoded strings
                    // or empty values cause the model to break (infinite tool loops or 400 errors).
                    const prevReasoning = (api as any)._capturedReasoningContent ?? "";
                    (api as any)._capturedReasoningContent = "";
                    currentMessages.push({
                        role: "assistant" as const,
                        reasoning_content: prevReasoning,
                        tool_calls: [
                            {
                                id: intercepted.id,
                                type: "function" as const,
                                function: {
                                    name: intercepted.name,
                                    arguments: JSON.stringify(intercepted.args),
                                },
                            },
                        ],
                    });
                    currentMessages.push({
                        role: "tool" as const,
                        tool_call_id: intercepted.id,
                        content: description,
                    });

                    const body: Record<string, unknown> = {
                        model: params.um?.id ?? params.model.id,
                        messages: currentMessages,
                        stream: true,
                        stream_options: { include_usage: true },
                    };
                    if (params.um?.temperature !== undefined && params.um.temperature !== null) {
                        if (params.um.supportsTemperature !== false) {
                            body.temperature = params.um.temperature;
                        }
                    }
                    if (params.um?.top_p !== undefined && params.um.top_p !== null) {
                        body.top_p = params.um.top_p;
                    }
                    if (params.um?.max_completion_tokens !== undefined) {
                        body.max_completion_tokens = params.um.max_completion_tokens;
                    }
                    if (params.um?.enable_thinking !== false && params.um?.reasoning_effort !== undefined && params.um.reasoning_effort !== 'adaptive') {
                        body.reasoning_effort = params.um.reasoning_effort;
                    }
                    if (params.um?.enable_thinking === true) {
                        body.thinking = { type: "enabled" };
                    } else {
                        body.thinking = { type: "disabled" };
                    }

                    const openaiToolList: any[] = [];
                    const toolConfig = convertToolsToOpenAI(params.options);
                    if (toolConfig.tools) { openaiToolList.push(...toolConfig.tools); }
                    if (hasLocalImages) {
                        openaiToolList.push(ASK_IMAGE_TOOL_DEF);
                        if (((api as any)._localImages as any[])?.length >= 2) {
                            openaiToolList.push(ASK_WITH_MULTI_IMAGE_TOOL_DEF);
                        }
                    }
                    if (openaiToolList.length > 0) {
                        body.tools = openaiToolList;
                    }
                    // Allow the model to freely call ask_image again in this round
                    if (hasLocalImages) {
                        body.tool_choice = "auto";
                    }

                    const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;
                    const response = await executeWithRetry(async () => {
                        const res = await params.dispatchFetch(url, {
                            method: "POST",
                            headers: params.requestHeaders,
                            body: JSON.stringify(body),
                            signal: roundAbortController.signal,
                        });
                        if (!res.ok) {
                            const errorText = await res.text();
                            throw new Error(`API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ""}`);
                        }
                        return res;
                    }, params.retryConfig);

                    if (response.body) {
                        await api.processStreamingResponse(response.body, params.trackingProgress, params.token);
                    }
                }
            } finally {
                clearTimeout(roundTimeoutId);
            }
        }
    }

    /**
     * Get API key for a provider, prompting user if missing.
     */
    private async getModelApiKey(providerId: string): Promise<string | undefined> {
        if (!providerId) {
            // Fallback: try old-style key for backward compat
            const oldKey = await this.secrets.get("opencodego.apiKey");
            if (oldKey) {
                return oldKey;
            }
        }

        let apiKey = await getProviderApiKey(providerId, this.secrets);

        if (!apiKey) {
            const { getProviders: getProvs } = await import("./providers.js");
            const providers = getProvs();
            const provider = providers.find((p: { id: string }) => p.id === providerId);
            const label = provider?.label || providerId;

            const entered = await vscode.window.showInputBox({
                title: l10nFormat("{0} API Key", label),
                prompt: l10n("Enter your API key"),
                ignoreFocusOut: true,
                password: true,
            });
            if (entered && entered.trim()) {
                apiKey = entered.trim();
                await storeProviderApiKey(providerId, apiKey, this.secrets);
            }
        }

        return apiKey;
    }
}
