/** Request protocol used by an OpenCode model. */
export type ApiMode = "openai" | "openai-responses" | "anthropic";

/**
 * Provider configuration from user settings.
 */
export interface ProviderConfig {
    /** Unique provider ID (e.g. "openai", "anthropic", "opencode-go") */
    id: string;
    /** Display label for the provider */
    label: string;
    /** Base URL for the API endpoint */
    baseUrl: string;
    /** API format mode */
    apiMode?: "openai" | "anthropic" | "auto";
    /** API key (shallow reference — real key in SecretStorage) */
    apiKey?: string;
    /** Model picker group label */
    group?: string;
    /** Static model definitions (optional if using modelsBaseUrl) */
    models?: ProviderModelDef[];
    /** URL to fetch model list dynamically (GET /v1/models) */
    modelsBaseUrl?: string;
    /**
     * Whether to fetch and merge dynamic models from modelsBaseUrl.
     * Defaults to true for providers without static models, false for providers
     * that already define models, so discovered models never override hardcoded
     * definitions for included providers.
     */
    autoDiscovery?: boolean;
    /** Custom HTTP headers */
    headers?: Record<string, string>;
    /** Whether this provider is enabled */
    enabled?: boolean;
    /** Per-provider request delay in ms */
    delay?: number;
}

/**
 * A model definition inside a provider config.
 */
export interface ProviderModelDef {
    /** Model ID sent to the API */
    id: string;
    /** Display name in model picker */
    name: string;
    /** Whether the model supports image input */
    vision: boolean;
    /** Thinking mode */
    thinkingMode: "switchable" | "always" | "adaptive" | "reasoning_effort";
    /** Default context length */
    contextLength?: number;
    /** Default max output tokens */
    maxOutputTokens?: number;
    /** Supported reasoning effort levels */
    supportedReasoningEfforts?: string[];
    /** Default reasoning effort */
    defaultReasoningEffort?: string;
    /** Per-model API mode override */
    apiMode?: "openai" | "anthropic";
    /** Whether to include reasoning in request */
    includeReasoningInRequest?: boolean;
    /** Whether this model supports setting temperature/top_p. Default true. */
    supportsTemperature?: boolean;
    /** Extra body parameters */
    extra?: Record<string, unknown>;
}

/**
 * A single model entry for Multi-LLM.
 */
export interface MultiLLMModelItem {
    id: string;
    object?: string;
    created?: number;
    owned_by: string;
    configId?: string;
    displayName?: string;
    baseUrl?: string;
    context_length?: number;
    vision?: boolean;
    max_tokens?: number;
    // OpenAI new standard parameter
    max_completion_tokens?: number;
    reasoning_effort?: string;
    enable_thinking?: boolean;
    thinking_budget?: number;
    // Allow null so user can explicitly disable sending this parameter
    temperature?: number | null;
    top_p?: number | null;
    top_k?: number;
    min_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    reasoning?: {
        effort?: string;
        exclude?: boolean;
        max_tokens?: number;
        enabled?: boolean;
    };
    extra?: Record<string, unknown>;
    /**
     * Optional family specification for the model.
     */
    family?: string;
    /**
     * Whether to include reasoning_content in assistant messages sent to the API.
     */
    include_reasoning_in_request?: boolean;
    /**
     * Whether this model can be used for Git commit message generation.
     */
    useForCommitGeneration?: boolean;
    /**
     * Model-specific delay in milliseconds between consecutive requests.
     */
    delay?: number;
    /** API mode (for internal use) */
    apiMode?: ApiMode;
    /** Whether this model supports switching thinking on/off ("switchable"), always has it ("always"), only disabled/adaptive ("adaptive"), or uses reasoning_effort only ("reasoning_effort") */
    thinkingMode?: "switchable" | "always" | "adaptive" | "reasoning_effort";
    /** Whether this model supports setting temperature/top_p. Default true. */
    supportsTemperature?: boolean;
    /**
     * Whether the OpenAI Chat request body may include a top-level `thinking`
     * field. Default true; false for routes whose schema rejects it (e.g.
     * glm-5.3/glm-5.3-flash on OpenCode Go, where thinking is mandatory and
     * only `reasoning_effort` is accepted).
     */
    supportsThinkingParam?: boolean;
    /** Whether the catalog declares reasoning support. */
    supportsReasoning?: boolean;
    /** Whether the catalog declares an explicit off value for reasoning effort (`none`/`disabled`). Used by the OpenAI Responses adapter to avoid sending `reasoning.effort: "none"` to models that reject it. */
    supportsDisablingReasoning?: boolean;
    /** Custom HTTP headers */
    headers?: Record<string, string>;
    /** Cost information for this model */
    cost?: {
        cache_read: number;
        input: number;
        output: number;
    };
    /** Additional fields may be present in provider-specific entries */
    [key: string]: unknown;

}

/**
 * Upstream-compatible alias for the resolved model request config.
 * The multi-provider fork renamed this type to `MultiLLMModelItem`; the
 * catalog layer (ported from upstream) still refers to it by its original name.
 */
export type OpenCodeGoModelItem = MultiLLMModelItem;

/**
 * Response from the models endpoint.
 */
export interface ModelsResponse {
    object: string;
    data: ModelItem[];
}

export interface ModelItem {
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
}

/**
 * A model preset for temperature and top_p configuration.
 */
export interface ModelPreset {
    id: string;
    label: string;
    temperature: number;
    top_p: number;
}

/**
 * Retry configuration.
 */
export interface RetryConfig {
    enabled: boolean;
    maxAttempts: number;
    intervalMs: number;
    backoffFactor: number;
    maxIntervalMs: number;
    statusCodes: number[];
}
