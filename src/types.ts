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
    apiMode?: string;
    /** Whether this model supports switching thinking on/off ("switchable"), always has it ("always"), only disabled/adaptive ("adaptive"), or uses reasoning_effort only ("reasoning_effort") */
    thinkingMode?: "switchable" | "always" | "adaptive" | "reasoning_effort";
    /** Custom HTTP headers */
    headers?: Record<string, string>;

}

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
