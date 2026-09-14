# OpenCode Go Copilot Provider — AGENTS.md

> **All changes must pass `npm run compile` / `npx tsc --noEmit` with zero errors.**  
> **After every code change, this document (`AGENTS.md`) must be updated to reflect the changes.**

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Detailed Logical Architecture](#2-detailed-logical-architecture)
3. [Source File Index](#3-source-file-index)
4. [Complete Function Reference](#4-complete-function-reference)
5. [Compilation & Build](#5-compilation--build)
6. [Development Conventions](#6-development-conventions)

---

## 1. Project Overview

### 1.1 Summary

**Multi-LLM Copilot Provider** is a VS Code extension that integrates any OpenAI-compatible, Anthropic-compatible, or OpenAI Responses-compatible LLM service into GitHub Copilot Chat. Users can select and use models from any configured provider (such as OpenCode Go's DeepSeek, GLM, Qwen, MiMo, MiniMax, Kimi series, or self-hosted OpenAI/Anthropic endpoints) within VS Code's Copilot Chat interface, enjoying features like intelligent code completion, chat conversations, and Git commit message generation.

### 1.2 Core Capabilities

| Capability | Description |
|------|------|
| **Chat Model Provider** | Implements the `LanguageModelChatProvider` interface, registering `multiLLM` as a vendor in VS Code |
| **Multi-Provider Support** | Providers are configured via the `multiLLM.providers` setting. Each provider defines a `baseUrl`, `apiMode` (`openai`/`anthropic`/`auto`), a static model list or a dynamic model endpoint (`modelsBaseUrl`), custom headers, and a request delay. Models are grouped in the picker by the provider's `group` field |
| **Multi-Model Support** | Each provider may declare static models (with context length, output limit, vision, thinking mode, reasoning efforts, temperature support) or discover models dynamically from an OpenAI `/v1/models` endpoint. Thinking mode is switched via a unified reasoning intensity selector |
| **Automatic Model Discovery** | Controlled by each provider's `autoDiscovery` field (defaults to enabled for providers without static models, disabled for providers that already define models so dynamic metadata never overrides hardcoded definitions). Dynamic model lists use a 5-minute in-memory cache and degrade silently to the last cache on API failure |
| **OpenCode Go Catalog Integration** | Built-in `models.dev` catalog layer (`catalog.json`, 1-minute TTL cache) resolves OpenCode Go / OpenCode Zen model metadata (context length, vision, thinking mode, reasoning efforts, API endpoint). The catalog fetch uses a three-tier fallback chain: official `models.dev` (10s timeout) → mirror (`multiLLM.modelsDevMirrorUrl`, default `https://modelsdev-mirror.onesoft.top/catalog.json`, 30s timeout, `platform: opencode-go-copilot` header plus optional `x-mirror-token`) → hardcoded catalog snapshot (`src/hardcodedModelList.ts`) |
| **Triple API Mode** | Supports the **OpenAI-compatible format** (`/chat/completions`), the **OpenAI Responses format** (`/responses`), and the **Anthropic format** (`/v1/messages`), selected by the model's `apiMode` |
| **Session Header (OpenCode Go)** | Sends the `x-opencode-session` header on inference requests (OpenCode Go requires it since 2026-09-05 for routing and prompt-cache optimization). Session IDs are managed by a registry persisted in `globalState` (3-day sliding TTL, LRU cap of 512 entries): the first turn uses a random UUID, registered after the turn completes under `hash(model + first user text + first assistant text)`; later turns resolve the same ID from the re-sent history. Upstream-provider failures trigger a session-ID rotation and one retry. `multiLLM.resetSessionRouting` clears the registry |
| **Streaming Inference** | Supports SSE (Server-Sent Events) streaming responses, outputting text and tool calls in real time |
| **Thinking / Reasoning** | Supports displaying the model's reasoning process ("thinking" state), including XML think block parsing |
| **Tool Calling** | Supports VS Code's `LanguageModelToolCallPart` mechanism |
| **Image Proxy (Tool-based)** | Injects the `ask_image` tool for non-vision models. The model can autonomously choose to call a vision model (default: `qwen-plus-latest`, resolved to the newest qwen*-plus model in the catalog) to answer specific questions about images, supporting a multi-round API request flow: "call tool → ask question → get answer → continue answering." Unlike the older `describe_image`, `ask_image` allows the model to ask specific questions about an image (e.g., "What color is the button?"), and the vision model answers specifically. Each completed internal vision call also emits a private-MIME `LanguageModelDataPart` so the next turn can rebuild the standard tool call + result pair. The vision model ID, query prompt, thinking mode, and max rounds are all configurable via settings; the vision proxy displays "Asking about image: [question]" within the same thinking block and appends the vision model's streaming output in real time |
| **MCP Tool Image Support** | Fully supports images returned by MCP tools (e.g. Chrome DevTools `take_screenshot`, photoshop-mcp): `type: image` / blob-bearing `resource` arrive as image data parts; `resource` / `resource_link` (no blob) arrive as `application/vnd.code.resource-link` data parts, which the extension resolves to actual image bytes via `vscode.workspace.fs.readFile`. Vision models receive the image directly; non-vision models store it in `_localImages` for the `ask_image` proxy. Unresolvable links are surfaced as text |
| **Token Counting** | Uses the `o200k_base` tiktoken tokenizer for precise token usage statistics |
| **Status Bar** | The status bar main text shows OpenCode Go plan usage; cumulative token usage and cache hit rate live in the tooltip |
| **Native Token Indicator** | Always enabled, reports token usage to Copilot Chat's native Token indicator. Implemented by sending a `LanguageModelDataPart` with MIME type `usage` (JSON encoded via TextEncoder), without needing a custom status bar. Depends on VS Code / Copilot Chat 1.116+ recognition of the `usage` data part for external models |
| **Advanced Token Indicator** | Controlled by the `multiLLM.enableThirdPartyTokenIndicator` setting (enabled by default) to show an advanced token counter in the VS Code status bar. When disabled, only the native indicator is shown |
| **Plan Usage Monitoring** | Fetches OpenCode Go plan usage from `GET /zen/go/v1/usage` (5-hour rolling / weekly / monthly windows plus a `useBalance` fallback flag). The status bar main text shows the 5H window usage (`$(symbol-numeric) Go 5H 65%`, or `Go --` when unavailable); the tooltip shows all three windows and the 5h reset countdown (`multiLLM.showUsageInTooltip`, enabled by default). Background polling uses `multiLLM.usageRefreshInterval` (default 5 minutes, 1-60). Clicking the status bar item or running `multiLLM.checkUsage` forces an immediate refresh. No polling without an API key; 401 and network failures degrade silently |
| **Git Commit Message Generation** | One-click generation of Conventional Commit-format Git commit messages, supporting `auto` language mode to automatically detect language from historical commits. The SCM title bar button can be hidden via `multiLLM.enableCommitGeneration` |
| **Multi-Repository Support** | Supports commit message generation for multiple Git repositories in multi-root workspaces |
| **Model Presets** | Supports quick switching of temperature/top_p presets (🎯 Precise / ⚖️ Balanced / 🔥 Creative) via the command palette, as well as manual custom input |
| **Internationalization** | Built-in bilingual interface in Simplified Chinese (zh-cn) and English |
| **Retry Mechanism** | Configurable exponential backoff retry strategy for network jitter and rate limiting (429) |
| **Request Delay** | Configurable inter-request delay to avoid triggering API rate limits |
| **Timeout Control** | Configurable request timeout (default: 10 minutes) |
| **Inference Base URL Override (Proxy)** | The `multiLLM.setInferenceBaseUrl` command overrides the base URL for inference requests (chat and Git commit generation) to a self-hosted proxy/gateway. The command first shows a compatibility notice in a QuickPick (protocol, paths, model IDs, and headers must match the official endpoint exactly) with "I Understand" / "Cancel" options; only after acknowledging does the input box appear. Leaving it empty clears the override. Stored in the machine-scoped `multiLLM.inferenceBaseUrl` setting; only inference requests are affected — usage and model list requests still use the official endpoint |
| **HTTP Safety Check** | Always validates the base URL: rejects non-HTTP(S) protocols; for plain `http:` only localhost, 127.0.0.1, ::1, 192.168.*, 10.*, 0.0.0.0 and other local/private addresses are allowed, remote endpoints must use HTTPS |
| **Immediate Cancellation** | When canceling a request, immediately interrupts stream reading via `reader.cancel()`, stopping background reception |
| **Vision Proxy Configuration** | Supports configuring the vision model, thinking mode, and max follow-up rounds via the `multiLLM.visionProxyModel`, `multiLLM.visionProxyThinking`, and `multiLLM.visionMaxRounds` settings. `multiLLM.visionProxyThinking` is off by default; when off, internal requests disable vision model thinking via `modelOptions.thinking={ type: false }` / `reasoning_effort="disabled"`, and the final OpenAI-compatible request body sends `thinking: { type: false }` |
| **Dynamic Model Rescan** | Running `Multi-LLM: Rescan Models` from the command palette forcibly re-fetches the `/v1/models` dynamic model list for any enabled provider (or all providers), bypassing the 5-minute cache and clearing the API model list and models.dev catalog caches, immediately refreshing model picker data |
| **Installation Welcome Page (Walkthrough)** | Automatically opens a guided wizard on first install when no API Key is configured, guiding the user to set their API Key and open the language model manager. Detected immediately after VS Code startup via the `onStartupFinished` activation event |

### 1.3 Model Catalog

> **Model lists are driven by the `multiLLM.providers` setting.** Each provider may declare static models (`models`) or a dynamic model endpoint (`modelsBaseUrl`). OpenCode Go / OpenCode Zen metadata is resolved by the built-in `models.dev` catalog layer (`catalog.json`, 1-minute cache); `src/modelOverrides.ts` only carries the few fields the catalog cannot express (e.g. Anthropic `apiMode`, `reasoning_split`).

#### Model Sources

| Provider | Source | Filter | Group (family) |
|------|---------|------|----------|
| Any (user-configured) | `multiLLM.providers[].models` (static) | none | the provider's `group` field |
| Any (user-configured) | `multiLLM.providers[].modelsBaseUrl` (dynamic, OpenAI `/v1/models` format) | never overrides a static model with the same ID | the provider's `group` field |
| `opencode-go` (OpenCode Go) | `catalog.json` → `providers["opencode-go"].models` | optionally filtered by the API `/models` list | `OpenCodeGo` |
| `opencode` (OpenCode Zen) | `catalog.json` → `providers["opencode"].models` | `-free` suffix + hardcoded set (`big-pickle`) | `OpenCode Zen` |

#### Default OpenCode Go Models

The default `multiLLM.providers` configuration ships with these OpenCode Go models. What is actually displayed depends on the configuration and API availability.

| Family | Model ID | Vision | Reasoning Intensity Selector | API Format |
|------|---------|------|----------------|----------|
| GLM | `glm-5.1`, `glm-5` | ❌ | `Thinking` (does not support thinking switch) | OpenAI |
| Kimi | `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code`¹ | ✅ | `Thinking` (does not support thinking switch) | OpenAI |
| DeepSeek | `deepseek-v4-pro`, `deepseek-v4-flash` | ❌ | `Disable thinking` / `High` / `Maximum` | OpenAI |
| MiMo | `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5-pro`, `mimo-v2.5` | mimo-v2-omni ✅ | `Disable thinking` / `Thinking` | OpenAI |
| MiniMax | `minimax-m3` | ✅ | `Disable thinking` / `Adaptive` | Anthropic |
| MiniMax | `minimax-m2.7`, `minimax-m2.5` | ❌ | `Thinking` (does not support thinking switch) | Anthropic |
| Qwen | `qwen3.7-max` | ❌ | `Disable thinking` / `Thinking` | Anthropic |
| Qwen | `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.5-plus` | ✅ | `Disable thinking` / `Thinking` | Anthropic |

> ¹ `kimi-k2.7-code` does not support setting Temperature/Top-p parameters.

#### OpenCode Zen Free Models (Optional)

Enabled via the `multiLLM.enableZenFreeModels` setting (disabled by default). Fetches the model list from the Zen API, filters by hardcoded IDs, and appends them to the model picker.

| Display Name | Model ID | Vision | Reasoning Intensity Selector | API Format | Notes |
|--------|---------|------|----------------|----------|------|
| Zen/Big Pickle Free | `big-pickle` | ❌ | `Thinking` (does not support thinking switch) | OpenAI | Time-limited free |
| Zen/DeepSeek V4 Flash Free | `deepseek-v4-flash-free` | ❌ | `Disable thinking` / `High` / `Very high` | OpenAI | Time-limited free |
| Zen/MiniMax M3 Free | `minimax-m3-free` | ✅ | `Disable thinking` / `Adaptive` | OpenAI | Time-limited free; 1M context, supports only `adaptive` / `disabled` thinking modes |
| Zen/MiniMax M2.5 Free | `minimax-m2.5-free` | ❌ | `Disable thinking` / `Thinking` | OpenAI | Time-limited free |
| Zen/Ring 2.6 1T Free | `ring-2.6-1t-free` | ❌ | `Disable thinking` / `Thinking` | OpenAI | Time-limited free |
| Zen/Nemotron 3 Super Free | `nemotron-3-super-free` | ❌ | `Disable thinking` / `Thinking` | OpenAI | Time-limited free |

In the model picker, OpenCode Go models are grouped under `OpenCode Go` (`family="OpenCodeGo"`), while Zen free models are grouped under `OpenCode Zen` (`family="OpenCode Zen"`) for differentiation.

> All models appear as **a single entry** in the model picker, with thinking mode switched via the **reasoning intensity selector** (Chinese labels).  
> - `thinkingMode="switchable"`: Users can choose `Disable thinking`, `Auto`, or enable thinking (configurable intensity)  
> - `thinkingMode="adaptive"`: Only `Disable thinking` and `Auto` options, no forced thinking enablement  
> - `thinkingMode="always"`: Reasoning is always enabled; the `Disable thinking` option is not shown in the selector (model characteristic)  
> 
> **About image input:** All models (including non-vision models) declare `imageInput` as `true` to ensure VS Code always passes image data. Non-vision models handle images through the internal `ask_image` tool proxy mechanism and do not support direct visual input.

---

## 2. Detailed Logical Architecture

### 2.1 Overall Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VS Code Copilot Chat                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  User sends message → LanguageModelChatProvider               │  │
│  │                    ↓                                          │  │
│  │  MultiLLMChatModelProvider (provider.ts)                      │  │
│  │   1. Get model config (getModelConfig / catalog fallback)     │  │
│  │   2. Get API Key (SecretStorage, per provider)                │  │
│  │   3. Calculate token usage (provideToken → statusBar)         │  │
│  │   3b. Optional: Report usage to Copilot Chat native indicator │  │
│  │       (LanguageModelDataPart, MIME type "usage", VS Code 1.116+)│ │
│  │   4. Apply request delay                                      │  │
│  │   5. Build request → API route selection                      │  │
│  │      ├─ apiMode="openai"           → OpenaiApi                │  │
│  │      ├─ apiMode="openai-responses" → ResponsesApi             │  │
│  │      └─ apiMode="anthropic"        → AnthropicApi             │  │
│  │   6. Send HTTP request (fetch with undici + timeout control)  │  │
│  │   7. Parse streaming response → Progress<LanguageModelResponsePart2>│
│  │      ├─ LanguageModelTextPart     (text)                      │  │
│  │      ├─ LanguageModelThinkingPart (reasoning process)         │  │
│  │      └─ LanguageModelToolCallPart (tool call)                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Git Commit Message Generation                     │
│  SCM title bar button → generateCommitMsg()                        │
│    → Get Git Diff (gitUtils.ts)                                    │
│    → Get recent commits as style reference                         │
│    → Build prompt → Call API (OpenaiApi/ResponsesApi/AnthropicApi) │
│    → Stream output to SCM InputBox                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Extension Activation Flow

```
activate(context)
  ├── logger.init()                         ← Create LogOutputChannel
  ├── TokenizerManager.initialize()         ← Load o200k_base.tiktoken
  ├── initStatusBar(context, secrets)       ← Create status bar entry + start Go usage polling
  ├── new MultiLLMChatModelProvider()       ← Create Provider instance
  ├── initSessionRouting(globalState)       ← Restore session ID registry (3-day TTL)
  ├── vscode.lm.registerLanguageModelChatProvider("multiLLM", provider)
  ├── Register commands:
  │   ├── multiLLM.setApiKey                ← Set API Key (pick provider first)
  │   ├── multiLLM.openSettings             ← Open extension settings page
  │   ├── multiLLM.manageProviders          ← GUI provider management
  │   ├── multiLLM.rescanModels             ← Force model list rescan
  │   ├── multiLLM.resetSessionRouting      ← Reset session routing
  │   ├── multiLLM.setInferenceBaseUrl      ← Set proxy base URL
  │   ├── multiLLM.generateGitCommitMessage ← Generate commit message
  │   ├── multiLLM.abortGitCommitMessage    ← Abort generation
  │   ├── multiLLM.setModelPreset           ← Set model preset
  │   └── multiLLM.checkUsage               ← Check/refresh Go plan usage
  ├── Warm up model discovery (fire-and-forget)
  ├── showWelcomeIfNeeded()                 ← Show welcome wizard on first install
  └── Register dispose cleanup
```

### 2.3 Chat Request Processing Flow

```
provideLanguageModelChatResponse(model, messages, options, progress, token)
  │
  ├── 1. Resolve model ID → getModelConfig(model.id)
  │       Format: "providerId:modelId" (composite ID)
  │       Looks up the provider config and model definition (static first, then dynamic cache)
  │       OpenCode Go / Zen models fall back to the catalog layer getCatalogModelConfig()
  │
  ├── 2. Apply user-configured reasoningEffort
  │       ├── "disabled" → Disable thinking (except for "always" models)
  │       ├── "adaptive" → Enable thinking, auto mode (send thinking: { type: "adaptive" })
  │       ├── "enabled" → Enable thinking, use default reasoning effort
  │       ├── "high"/"max" → Enable thinking, specify reasoning effort
  │
  ├── 2b. Inject temperature/top_p (model preset or custom settings)
  │       ├── preset mode → Inject preset temperature (no top_p, model uses default)
  │       └── custom mode → Inject user-customized temperature and top_p (if set)
  │
  ├── 2c. Inject vision config
  │       └── modelConfig.vision = um?.vision ?? false
  │
  ├── 3. Determine API mode (apiMode: "openai" | "openai-responses" | "anthropic")
  │
  ├── 3b. Resolve inference base URL: multiLLM.inferenceBaseUrl override > provider/model baseUrl
  │       └── Validated by validateBaseUrl() before dispatch (HTTP only for local/private, HTTPS for remote)
  │
  ├── 4. Log request start (including session ID and registry hit)
  │
  ├── 5. Update status bar token usage
  │
  ├── 6. Apply request delay
  │
  ├── 7. Ensure the API Key for the model's provider exists
  │
  ├── 8. Create request timeout AbortController
  │      └── Connect VS Code cancellation token → abort()
  │
  ├── 9. Create undici fetch (custom bodyTimeout)
  │
  ├── 9a. Build request headers → CommonApi.prepareHeaders()
  │       └── Inject `x-opencode-session` (OpenCode Go requires it since 2026-09-05
  │           for routing and prompt cache optimization). Session IDs are managed by
  │           the sessionRouting.ts registry: the first turn uses a random UUID
  │           (registered after the turn completes under hash(model + first user text
  │           + first assistant text)); later turns resolve the same ID from the
  │           re-sent history. The registry persists in globalState (restored on
  │           activation, 3-day sliding TTL). Vision proxy follow-up rounds reuse the
  │           same request headers.
  │
  ├── 9c. Upstream-provider failure session rotation (#123 fallback):
  │      └── _sendWithSessionFallback() wraps every request dispatch (all three
  │          apiModes + each vision proxy round): on an upstream error (5xx, or 400
  │          with api_error + upstream signature) rotateSessionId() issues a fresh
  │          session ID and retries once (session affinity can pin a conversation to
  │          a broken backend). Users can clear the registry via
  │          multiLLM.resetSessionRouting.
  │
  ├── 9b. After obtaining Response body reader, register cancellation callback
  │      └── token.onCancellationRequested / signal.addEventListener("abort")
  │      └── Call reader.cancel() to immediately interrupt stream
  │
  ├── 10. Route by apiMode:
  │     ├── OpenAI mode:
  │     │   ├── OpenaiApi.convertMessages()
  │     │   ├── OpenaiApi.prepareRequestBody()
  │     │   ├── POST /chat/completions
  │     │   ├── executeWithRetry()
  │     │   └── OpenaiApi.processStreamingResponse()
  │     │       ├── SSE line parsing ("data: ...")
  │     │       ├── processDelta() → Process each delta
  │     │       │   ├── Reasoning content (thinking/reasoning/reasoning_content)
  │     │       │   ├── XML think block parsing
  │     │       │   ├── Text content → LanguageModelTextPart
  │     │       │   └── Tool calls → LanguageModelToolCallPart
  │     │       └── Usage statistics (usage chunk)
  │     ├── OpenAI Responses mode:
  │     │   ├── ResponsesApi.convertMessages()
  │     │   ├── ResponsesApi.prepareRequestBody()
  │     │   ├── POST /responses
  │     │   ├── executeWithRetry()
  │     │   └── ResponsesApi.processStreamingResponse()
  │     │       ├── SSE event parsing
  │     │       ├── Text / reasoning deltas
  │     │       ├── Function call arguments
  │     │       └── Encrypted reasoning items captured for stateless replay
  │     └── Anthropic mode:
  │         ├── AnthropicApi.convertMessages()
  │         ├── AnthropicApi.prepareRequestBody()
  │         ├── POST /v1/messages
  │         ├── executeWithRetry()
  │         └── AnthropicApi.processStreamingResponse()
  │             ├── SSE line parsing ("data: ...")
  │             └── processAnthropicChunk()
  │                 ├── content_block_start → Block start
  │                 ├── content_block_delta → Incremental content
  │                 │   ├── text_delta → Text
  │                 │   ├── thinking_delta → Reasoning
  │                 │   └── input_json_delta → Tool arguments
  │                 └── content_block_stop/message_stop → End
  │
  ├── 11. Image proxy interception handling:
  │       └── _handleInterceptedToolCall()
  │           ├── Check interceptedToolCall (loop, up to visionMaxRounds times)
  │           ├── Emit same thinking block with vision model streaming output
  │           ├── Call callVisionModel() / callVisionModelMulti()
  │           ├── Create independent AbortController per round
  │           ├── Inject tools: VS Code native + ask_image (+ ask_with_multi_image)
  │           └── Loop for unlimited follow-up questions
  │
  ├── 12. Error handling:
  │        ├── User cancellation → re-throw directly
  │        ├── Timeout → friendly timeout message
  │        ├── Connection terminated → friendly termination message
  │        └── Other errors → throw as-is
  │
  └── 13. finally: Clean up timers, log request end
```

### 2.4 Thinking / Reasoning Content Processing

```
Reasoning content sources (OpenAI mode):
  ├── choice.thinking (object/string)
  ├── delta.reasoning_content (string)
  ├── delta.reasoning (object)
  ├── delta.thinking (object)
  └── reasoning_details[] (OpenRouter format)
      ├── reasoning.summary → summary field
      ├── reasoning.text → text field
      └── reasoning.encrypted → "[REDACTED]"

Processing mechanism:
  1. bufferThinkingContent(text) → Accumulate into _thinkingBuffer
  2. Flush every 100ms via timer → LanguageModelThinkingPart
  3. XML think blocks → processXmlThinkBlocks()
  4. When text content appears → reportEndThinking()
```

### 2.5 Tool Call Processing

```
Tool call flow (OpenAI mode):
  delta.tool_calls[]
    ├── index: tool call index
    ├── id: call ID
    ├── function.name: function name
    └── function.arguments: JSON arguments (may be fragmented)

Processing mechanism:
  1. _toolCallBuffers Map<index, {id, name, args}>
  2. Concatenate args from stream fragments
  3. tryEmitBufferedToolCall() → Emit when args parse as valid JSON
  4. flushToolCallBuffers() → Force emit remainder on finish_reason
  5. adjustReadFileParameters() → Auto-expand read_file line count
  ask_image interception: Not emitted via tryEmit/flush; sets interceptedToolCall
```

### 2.6 Image Proxy (ask_image Tool) Flow

```
Non-vision model receives message containing images:
  ├── 1. convertMessages()
  │      Model vision=false → Replace image with text reference
  │      Original image data stored in _localImages array
  │      Recursively scans images embedded in tool results
  ├── 2. prepareRequestBody()
  │      If _localImages → Inject ask_image tool definition
  │      Set tool_choice = "auto"
  ├── 3. First API request (ask_image + VS Code native tools)
  │      └── Model autonomously decides whether to call ask_image
  ├── 4. processDelta() / processAnthropicChunk() interception
  │      ask_image cached to interceptedToolCall (not emitted in progress)
  └── 5. _handleInterceptedToolCall() loop (multi-round follow-up)
         for round = 1 to visionMaxRounds:
           ├── Read interceptedToolCall
           ├── Emit LanguageModelThinkingPart
           ├── Call vision model with model's specific query
           ├── Emit a private-MIME vision history DataPart (tool call + result)
           ├── Build current round messages
           ├── Inject tools: VS Code native + ask_image
           ├── Send API request and process streaming
           ├── If model calls ask_image again → continue loop
           └── If model does not call ask_image → end
```

#### Multi-Round Request Characteristics

- **Unlimited follow-up**: Model can continue calling ask_image (up to `visionMaxRounds` times, default 5)
- **Tool coexistence**: Each round injects both VS Code native tools + ask_image
- **Image data lifecycle**: Images stored in `_localImages`, reclaimed by GC when request ends
- **OpenAI mode**: Uses `tool_calls` + `tool` role message format
- **OpenAI Responses mode**: Uses `function_call` + `function_call_output` input items, replaying captured encrypted reasoning items
- **Anthropic mode**: Uses `tool_use` + `tool_result` content block format
- **Parameter preservation**: Each round preserves temperature, top_p, thinking mode, etc.
- **DeepSeek compatibility**: Injects `reasoning_content` field into assistant tool_call messages
- **Cross-turn persistence**: Each completed vision call is emitted as a `application/vnd.multillm.vision-tool-history+json` DataPart so the next turn rebuilds the standard tool call + result pair

### 2.7 Git Commit Message Generation Flow

```
generateCommitMsg(secrets, scm?)
  ├── Detect Git extension and repositories
  ├── Get Git Diff (gitUtils.getGitDiff)
  │   ├── Prefer staged diff (git diff --cached)
  │   └── Fallback to unstaged diff (git diff)
  ├── Multi-repository handling:
  │   ├── 0 repos with changes → Notify user
  │   ├── 1 repo → Generate directly
  │   └── Multiple → QuickPick selection
  ├── Build Prompt:
  │   ├── System prompt (customizable)
  │   ├── Recent commit style reference
  │   │   ├── Default: commit titles only (git log --format=%s)
  │   │   └── Optional: include per-commit diff
  │   ├── Language detection: auto mode matches historical commit language
  │   ├── User's current input (SCM InputBox)
  │   └── Git Diff content
  ├── Call API:
  │   ├── OpenaiApi.createMessage() / ResponsesApi.createMessage() / AnthropicApi.createMessage()
  │   └── Stream output to SCM InputBox
  └── Cleanup: Remove ``` markers and <think> tags
```

---

## 3. Source File Index

### 3.1 Directory Structure

```
src/
├── apiModelList.ts                       # API model list fetching
├── catalogModels.ts                      # Unified catalog model resolution/build layer (Go + Zen)
├── commonApi.ts                          # API abstract base class
├── extension.ts                          # Extension entry (activate/deactivate)
├── goUsage.ts                            # OpenCode Go plan usage fetching and caching
├── hardcodedModelList.ts                 # Hardcoded catalog fallback snapshot
├── localize.ts                           # Internationalization / localization
├── logger.ts                             # Logging system
├── modelOverrides.ts                     # Per-model override table (fields the catalog cannot express)
├── modelsDev.ts                          # models.dev catalog fetching and querying
├── provideModel.ts                       # Model info provider functions (multi-provider + catalog)
├── provider.ts                           # Chat model provider (core main file)
├── providerEditor.ts                     # Provider configuration GUI editor
├── providers.ts                          # Multi-provider config, dynamic model cache, API key management
├── provideToken.ts                       # Token counting functions
├── sessionRouting.ts                     # x-opencode-session session ID registry/rotation
├── statusBar.ts                          # Status bar management
├── types.ts                              # TypeScript type definitions
├── utils.ts                              # General utility functions
├── versionManager.ts                     # Version info management
├── openai/
│   ├── openaiApi.ts                      # OpenAI-compatible API implementation
│   ├── openaiTypes.ts                    # OpenAI type definitions
│   ├── responsesApi.ts                   # OpenAI Responses API implementation
│   ├── responsesState.ts                 # Responses encrypted reasoning state DataPart codec
│   └── responsesTypes.ts                 # OpenAI Responses type definitions
├── anthropic/
│   ├── anthropicApi.ts                   # Anthropic API implementation
│   └── anthropicTypes.ts                 # Anthropic type definitions
├── gitCommit/
│   ├── commitMessageGenerator.ts         # Git commit message generation
│   └── gitUtils.ts                       # Git utility functions
├── tokenizer/
│   ├── tokenizerManager.ts               # Tokenizer management (o200k_base)
│   └── imageUtils.ts                     # Image dimension parsing
└── vision/
    ├── types.ts                          # Vision proxy type definitions
    ├── historyCodec.ts                   # Vision tool history serialization/validation and API message rebuild
    ├── historyPart.ts                    # VS Code vision history DataPart creation and parsing
    └── imageProxy.ts                     # Image proxy core (ask_image)
```

### 3.2 File Details

| File | Lines | Responsibility |
|------|------|------|
| `extension.ts` | ~430 | Extension activation/deactivation, registers Provider and 10 commands, first-install welcome page guidance |
| `providers.ts` | ~520 | Multi-provider config reading, dynamic model cache, API key management, model config resolution, forced rescan |
| `providerEditor.ts` | ~510 | Provider configuration GUI editor (add/edit/delete providers, model list, API key setup) |
| `provider.ts` | ~1150 | Implements `LanguageModelChatProvider`, handles full chat request flow and image proxy multi-round loop |
| `catalogModels.ts` | ~400 | Unified catalog resolution layer: `ModelMeta` merge chain (`MODEL_OVERRIDES` > catalog entry > defaults), `buildCatalogModelInfo()`, `getCatalogModelConfig()`, `resolveProviderForModelId()`/`isZenFreeModelId()`, `resolveVisionProxyModelId()` |
| `hardcodedModelList.ts` | ~4880 | Hardcoded catalog fallback snapshot with full metadata for opencode-go and opencode models; last resort when both the official catalog and mirror are unreachable |
| `modelOverrides.ts` | ~75 | Per-model override table `MODEL_OVERRIDES` (all fields optional) + `ModelMetaOverride` type; only carries what models.dev cannot express (Anthropic apiMode, adaptive, `reasoning_split`, etc.) |
| `types.ts` | ~110 | Types: `ApiMode`, `MultiLLMModelItem` (alias `OpenCodeGoModelItem`), `ProviderConfig`, `ProviderModelDef`, `ModelPreset`, `ModelsResponse`, `RetryConfig`, etc. |
| `apiModelList.ts` | ~120 | API model list fetching from the catalog-resolved base URL's `/models` endpoint, 1-minute cache, silent degradation |
| `goUsage.ts` | ~260 | OpenCode Go plan usage fetching from `GET /zen/go/v1/usage` (5h/weekly/monthly windows + `useBalance`), 5-minute TTL cache, tolerant field-name parsing, reset countdown/summary formatting |
| `modelsDev.ts` | ~560 | models.dev catalog fetching and querying: three-tier fallback chain (official → mirror → hardcoded), indexes global models and providers, short-ID matching, provider queries, `reasoning_options`/thinking mode/vision/budget inference, 1-minute cache |
| `commonApi.ts` | ~470 | `CommonApi<TMessage,TRequestBody>` abstract base class (image storage, tool call interception, User-Agent config) |
| `provideModel.ts` | ~35 | Model info provider functions: delegates to `providers.ts` `getAllModelInfos()`; `resetAutoDiscoveryState()` clears all model caches |
| `provideToken.ts` | ~105 | Token usage calculation |
| `utils.ts` | ~570 | Utility functions (retry, role mapping, base URL override/validation, OpenAI Chat/Responses tool conversion, resource-link resolution, etc.) |
| `statusBar.ts` | ~317 | Status bar creation, updates, cumulative counters, Go usage polling and tooltip section rendering |
| `logger.ts` | ~55 | Log output (LogOutputChannel) |
| `localize.ts` | ~140 | Chinese/English internationalization (including reasoning effort labels and base URL proxy text) |
| `versionManager.ts` | ~35 | Extension version info (uses the correct extension ID `allgood.multi-llm-copilot-provider`) |
| `sessionRouting.ts` | ~313 | `x-opencode-session` session ID registry: `initSessionRouting()`, `resolveSessionId()`, `registerSessionId()`, `rotateSessionId()`, `resetSessionRouting()`, `isUpstreamProviderFailureError()` |
| `openai/openaiApi.ts` | ~700 | OpenAI-format API implementation (message conversion / request building / streaming / image proxy) |
| `openai/openaiTypes.ts` | ~75 | OpenAI type definitions |
| `openai/responsesApi.ts` | ~550 | OpenAI Responses format API implementation: typed input items, flat tool definitions, request parameter mapping, Responses SSE text/reasoning/tool/usage parsing |
| `openai/responsesState.ts` | ~60 | Validates and encodes/decodes the `reasoning.encrypted_content` private DataPart so `store:false` Responses reasoning models can continue statelessly across requests |
| `openai/responsesTypes.ts` | ~122 | OpenAI Responses request, input item, tool, usage, and stream event type definitions |
| `anthropic/anthropicApi.ts` | ~690 | Anthropic-format API implementation (message conversion / request building / streaming / image proxy) |
| `anthropic/anthropicTypes.ts` | ~130 | Anthropic type definitions |
| `gitCommit/commitMessageGenerator.ts` | ~320 | Git commit message generation logic |
| `gitCommit/gitUtils.ts` | ~260 | Git command wrappers |
| `tokenizer/tokenizerManager.ts` | ~115 | o200k_base tokenizer management (with LRU cache) |
| `tokenizer/imageUtils.ts` | ~130 | Image dimension parsing (PNG/GIF/JPEG/WebP) |
| `vision/types.ts` | ~53 | Vision proxy type definitions |
| `vision/historyCodec.ts` | ~170 | Vision tool history DataPart MIME, validation/codec, and standard tool call/result rebuild for OpenAI Chat, OpenAI Responses, and Anthropic |
| `vision/historyPart.ts` | ~20 | Creates and parses the `application/vnd.multillm.vision-tool-history+json` DataPart |
| `vision/imageProxy.ts` | ~130 | Image proxy core: `callVisionModel`/`callVisionModelMulti`, vision model resolution, thinking mode config and text streaming |

---

## 4. Complete Function Reference

### 4.1 `src/extension.ts`

#### `activate(context: vscode.ExtensionContext): void`
Extension activation entry point. Initializes logger, tokenizer, and status bar; restores the session ID registry; registers the `LanguageModelChatProvider`; registers ten commands (Set API Key, Open Extension Settings, Manage Providers, Rescan Models, Reset Session Routing, Generate Git Commit Message, Abort Generation, Set Model Preset, Check Usage, Set Proxy Base URL); warms up model discovery (fire-and-forget); calls `showWelcomeIfNeeded()` on first install.

#### `showWelcomeIfNeeded(context: vscode.ExtensionContext): Promise<void>`
Checks whether the welcome page has already been shown (via `WELCOME_SHOWN_KEY` in `globalState`). If already marked or an API Key already exists, returns directly; otherwise opens the Walkthrough page and sets the marker. Silently handles exceptions.

#### `deactivate(): void`
Extension deactivation. Cleans up resources (logger dispose).

---

### 4.1.1 `multiLLM.rescanModels` Command

#### Command Behavior
Triggered by executing `Multi-LLM: Rescan Models` from the command palette. Flow:
1. Retrieves the list of currently enabled providers; prompts user to go to settings if empty.
2. Displays a QuickPick with an "All Providers" option at the top, followed by each enabled provider.
3. After user selection, displays a progress notification "Rescanning models...".
4. Calls `rescanProviderModels(secrets, providerId?)` to forcibly clear cache and re-fetch `/v1/models`.
5. On completion, shows results summary.

---

### 4.2 `src/providers.ts`

#### `clearModelCache(providerId?: string): void`
Clears the dynamic model cache. If `providerId` is provided, only clears that provider's cache; otherwise clears all caches.

#### `rescanProviderModels(secrets: vscode.SecretStorage, providerId?: string): Promise<{ providerId: string; modelCount: number; error?: string }[]>`
Forcibly rescans dynamic models for specified provider or all enabled providers. Clears old cache, fetches latest model list, updates cache on success, records error info on failure. Returns scan results for each provider.

#### `getAllModelInfos(secrets: vscode.SecretStorage): Promise<LanguageModelChatInformation[]>`
Aggregates model infos from all enabled providers. Iterates through providers, adds hardcoded models, conditionally merges dynamic models (dynamic models don't overwrite hardcoded models with same ID).

#### `getModelConfig(compositeId: string): MultiLLMModelItem | undefined`
Looks up runtime model config by composite ID `providerId/modelId`. Searches hardcoded models first, then dynamic cache (only when autoDiscovery is enabled), ensuring hardcoded models are not overridden.

#### `defToModelItem(def: ProviderModelDef, provider: ProviderConfig): MultiLLMModelItem`
Converts hardcoded `ProviderModelDef` into runtime `MultiLLMModelItem`. Passes through all relevant fields. `enable_thinking` defaults to `true`; actual enablement is dynamically determined by `provider.ts` based on user's selected reasoning effort.

---

### 4.3 `src/provider.ts`

#### `class MultiLLMChatModelProvider implements LanguageModelChatProvider`
Core Provider class. Manages request timing, API routing, model config resolution, streaming response processing, image proxy handling, and error management.

#### `provideLanguageModelChatInformation(options, _token): Promise<LanguageModelChatInformation[]>`
Gets available language models list. Delegates to `prepareLanguageModelChatInformation()`.

#### `provideTokenCount(_model, text, _token): Promise<number>`
Counts tokens in text or messages. Delegates to `countMessageTokens()`.

#### `provideLanguageModelChatResponse(model, messages, options, progress, token): Promise<void>`
Core method: handles chat requests with streaming responses. Includes model config resolution (provider config → catalog fallback), API Key validation, reasoning effort application, temperature/top_p injection, delay control, timeout management, API routing (OpenAI / OpenAI Responses / Anthropic), streaming parsing, image proxy interception handling, session ID registration, and error handling.

#### `private async _sendWithSessionFallback(send, rotateSession): Promise<Response>`
Sends a request, retrying once with a rotated `x-opencode-session` when the failure is an upstream-provider error (session affinity can pin a conversation to a broken backend). The rotated ID is persisted for later turns inside `rotateSessionId()`.

#### `private async _handleInterceptedToolCall(params): Promise<void>`
Handles image proxy interception. Loops for up to `visionMaxRounds` rounds. Each round: reads interceptedToolCall, emits thinking block, calls vision model, emits a private-MIME vision history DataPart, builds API request, injects tools, processes response. Preserves original parameters across rounds. Uses `_resetStreamState()` between rounds.

#### `private async getModelApiKey(providerId): Promise<string | undefined>`
Resolves the API key for a provider from SecretStorage; prompts the user with an input box when missing.

---

### 4.4 `src/catalogModels.ts`

#### `resolveModelMeta(providerId, modelId): ModelMeta`
Resolves final model metadata through the merge chain: catalog entry (provider-specific → global → conservative defaults) then `MODEL_OVERRIDES[modelId]` per field.

#### `buildCatalogModelInfo(providerId, modelId): LanguageModelChatInformation`
Builds a model picker entry (name, tooltip, family, context/output limits, capabilities, reasoning effort enum).

#### `getCatalogModelConfig(modelId): OpenCodeGoModelItem`
Builds the request config for a model, resolving the provider (Go vs Zen) from the model ID.

#### `resolveProviderForModelId(modelId): ProviderId` / `isZenFreeModelId(modelId): boolean`
Resolve whether a model ID belongs to OpenCode Zen (`-free` suffix or the hardcoded `big-pickle` set) or OpenCode Go.

#### `resolveVisionProxyModelId(configuredId): Promise<string>`
Resolves the special `qwen-plus-latest` alias to the newest qwen*-plus model served by the opencode-go provider in the catalog; other values pass through unchanged.

#### `isModelDeprecated(providerId, modelId): boolean`
Whether the catalog marks a model as deprecated (hidden from the picker unless `multiLLM.showDeprecatedModels` is enabled).

---

### 4.4.1 `src/modelOverrides.ts`

#### `MODEL_OVERRIDES: Record<string, ModelMetaOverride>`
Per-model override table. Only carries fields the catalog cannot express: `apiMode` (Anthropic vs OpenAI), `thinkingMode="adaptive"` semantics, `extra` request-body parameters (e.g. `reasoning_split`), and default reasoning effort tuning.

---

### 4.4.2 `src/sessionRouting.ts`

#### `initSessionRouting(storage: vscode.Memento): void`
Restores the session ID registry from extension `globalState`, dropping entries unused for more than the 3-day TTL. Must be called during activation.

#### `resolveSessionId(modelId, messages): SessionResolution`
Resolves the session ID for an outgoing request: reuses the registered ID when the re-sent history identifies a known conversation, otherwise returns a fresh random UUID (caller registers it after the turn completes).

#### `registerSessionId(modelId, messages, turnOutput, sessionId): void`
Registers the session ID under the anchor the next turn will look up: `hash(model + first user text + first assistant text)`.

#### `rotateSessionId(modelId, messages): string`
Returns a fresh session ID after an upstream-provider failure so retries and later turns are routed away from the broken backend.

#### `resetSessionRouting(): number`
Clears all registered session IDs; returns the number of cleared registrations.

#### `isUpstreamProviderFailureError(err): boolean`
Detects upstream-provider failures (5xx, or 400 with `api_error` + upstream signature) worth a session-ID rotation.

---

### 4.4.3 `src/goUsage.ts`

#### `getGoUsageCached(apiKey, force?): Promise<GoUsageResult | null>`
Fetches OpenCode Go plan usage from `GET /zen/go/v1/usage` with a 5-minute TTL cache; tolerant field-name parsing (`percent`/`usagePercent`, `resetsAt`/`resetInSec`).

#### `getUsageSnapshot(): GoUsageResult | null` / `getUsageFetchStatus(): string`
Return the cached usage snapshot and the last fetch status (e.g. `unauthorized`).

#### `formatResetDuration(resetsAt): string` / `formatUsageSummary(usage): string`
Format the 5h window reset countdown and a one-line usage summary.

---

### 4.4.4 `src/vision/historyCodec.ts` + `src/vision/historyPart.ts`

#### `VISION_TOOL_HISTORY_MIME`
Private MIME type (`application/vnd.multillm.vision-tool-history+json`) used to persist intercepted vision tool calls in the provider response so VS Code can carry them into the next request.

#### `serializeVisionToolHistory(entry)` / `deserializeVisionToolHistory(data)`
Encode/decode and validate one completed vision tool call/result.

#### `toOpenAIVisionToolMessages(entry)` / `toResponsesVisionToolItems(entry)` / `toAnthropicVisionToolMessages(entry)`
Rebuild the standard tool call + result pair for each protocol.

#### `createVisionToolHistoryPart(entry)` / `parseVisionToolHistoryPart(part)`
Create and parse the hidden response DataPart.

---

### 4.4.5 `src/openai/responsesApi.ts` + `src/openai/responsesState.ts`

#### `class ResponsesApi extends CommonApi<ResponsesInputItem, ResponsesRequestBody>`
OpenAI Responses format adapter: typed input items, flat tool definitions, request parameter mapping, and Responses SSE parsing (text / reasoning / tool calls / usage).

#### `takeCapturedReasoningItems(): ResponsesInputItem[]`
Returns and clears the encrypted reasoning items captured during streaming, so `store:false` reasoning models can continue statelessly across requests.

#### `RESPONSES_REASONING_MIME`
Private MIME type for the `reasoning.encrypted_content` DataPart codec.

---

### 4.5 `src/types.ts`

Key interfaces: `ProviderConfig` (multi-LLM provider configuration), `ProviderModelDef` (hardcoded model definition), `MultiLLMModelItem` (runtime model config), `ModelsResponse`, `ModelItem`, `ModelPreset`, `RetryConfig`.

---

### 4.6 `src/commonApi.ts`

#### `abstract class CommonApi<TMessage, TRequestBody>`
Abstract base class for API implementations. Manages tool call buffers, thinking content buffering/flushing, XML think block parsing, image storage, and stream state management.

Key methods:
- `convertMessages()` — Converts VS Code messages to API format
- `prepareRequestBody()` — Builds API request body
- `processStreamingResponse()` — Processes streaming response
- `tryEmitBufferedToolCall()` — Emits buffered tool calls
- `flushToolCallBuffers()` — Flushes remaining tool calls
- `_resetStreamState()` — Resets mutable stream state between rounds
- `bufferThinkingContent()` / `flushThinkingBuffer()` — Thinking content management
- `processXmlThinkBlocks()` — XML think block parsing
- `prepareHeaders()` — HTTP header preparation. Accepts an optional `sessionId`; when provided, injects the `x-opencode-session` header (OpenCode Go only). Other providers are unaffected when omitted.

---

### 4.7 `src/apiModelList.ts`

#### `getApiModelIds(apiKey): Promise<Set<string>>`
Fetches available model IDs from `/zen/go/v1/models`. Uses in-memory cache (5-minute TTL). Returns empty Set or last cached value on API failure.

#### `isApiFetchSuccessful(): boolean`
Returns whether the most recent API model list fetch was successful.

---

### 4.8 `src/modelsDev.ts`

#### `ensureModelsDevLoaded(): Promise<void>`
Downloads complete model catalog from `https://models.dev/models.json` and builds in-memory index. 1-hour cache TTL.

#### `lookupModelDevEntry(apiModelId): ModelsDevEntry | undefined`
Looks up models.dev metadata by API model ID. Matching: exact full ID, short ID, suffix match.

---

### 4.9 `src/provideModel.ts`

#### `prepareLanguageModelChatInformation(options, _token, secrets): Promise<LanguageModelChatInformation[]>`
Gets the model info list. Delegates to `providers.ts` `getAllModelInfos()`, which aggregates models from every enabled provider (static definitions plus optional dynamic discovery).

#### `resetAutoDiscoveryState(): void`
Clears every cached model source (`clearModelCache()`, `clearApiModelCache()`, `clearModelsDevCache()`) so the next model list request re-fetches fresh data. Used by the `multiLLM.rescanModels` command.

---

### 4.10 `src/provideToken.ts`

Token counting functions using o200k_base tiktoken tokenizer. Supports text, images (512px tile algorithm), binary data, tool definitions, and tool results.

---

### 4.11 `src/utils.ts`

Utility functions: `getModelProviderId()`, `modelSupportsTemperature()`, `normalizeUserModels()`, `parseModelId()`, `mapRole()`, `convertToolsToOpenAI()`, `createRetryConfig()`, `executeWithRetry()`, `isRetryableError()`, image/data URL helpers, `tryParseJSONObject()`. Also exports `OPENCODE_GO_PROVIDER_ID` (constant for the OpenCode Go provider ID) and `deriveSessionIdFromText(modelId, text)` (SHA-256 based session ID derivation for the `x-opencode-session` header).

---

### 4.12 `src/statusBar.ts`

Status bar management: creation, token usage display, progress bar (Unicode block characters), cumulative counters, cache hit rate tooltip.

---

### 4.13 `src/logger.ts`

`Logger` class with singleton export. Methods: `init()`, `debug()`, `info()`, `warn()`, `error()`, `sanitizeHeaders()`, `dispose()`.

---

### 4.14 `src/localize.ts`

`l10n(key)` and `l10nFormat(template, ...args)` for Chinese/English internationalization. Falls back to English key when no translation available.

---

### 4.15 `src/versionManager.ts`

`VersionManager` class with `getVersion()`, `getUserAgent()`, `getClientInfo()` static methods.

---

### 4.16 `src/openai/openaiApi.ts`

#### `class OpenaiApi extends CommonApi<OpenAIChatMessage, Record<string, unknown>>`
OpenAI-compatible API implementation. Handles message conversion, request body building (temperature, top_p, max_tokens, reasoning_effort, thinking mode, tools, tool_choice, penalty params), SSE streaming response processing (delta handling for reasoning, XML think blocks, text, tool calls), and `reasoning_details` array support (OpenRouter format). Also provides non-streaming `createMessage()` generator for Git commit generation (injects `x-opencode-session` when the model's provider is `opencode-go`).

---

### 4.17 `src/anthropic/anthropicApi.ts`

#### `class AnthropicApi extends CommonApi<AnthropicMessage, AnthropicRequestBody>`
Anthropic-format API implementation. Handles message conversion (system message extraction to `_systemContent`, content block array format), request body building (max_tokens, system, temperature, top_p, top_k, thinking mode, Anthropic-format tools, tool_choice), SSE streaming response processing (8 event types: ping, error, message_start, message_delta, content_block_start, content_block_delta, content_block_stop, message_stop). Also provides non-streaming `createMessage()` generator (injects `x-opencode-session` when the model's provider is `opencode-go`).

---

### 4.18 `src/gitCommit/commitMessageGenerator.ts`

Git commit message generation logic. Entry function `generateCommitMsg()`, multi-repo orchestration, repo filtering/selection, per-repo generation (`generateCommitMsgForRepository()`), core generation logic (`performCommitMsgGeneration()`), abort support, and cleanup (`extractCommitMessage()`, `removeThinkTags()`). Supports custom prompts, auto language detection, commit diff inclusion, and context file attachment.

---

### 4.19 `src/gitCommit/gitUtils.ts`

Git command wrappers: `checkGitRepo()`, `checkGitInstalled()`, `checkGitRepoHasCommits()`, `searchCommits()`, `getGitDiff()` (prefers staged, -U1 context, 500 line cap), `getRecentCommits()` (with optional diff inclusion), `limitDiffLines()`.

---

### 4.20 `src/tokenizer/tokenizerManager.ts`

`TokenCache` (simple LRU cache, 5000 entries / 5MB max) and `TokenizerManager` (singleton, o200k_base tiktoken loading and token counting with caching).

---

### 4.21 `src/tokenizer/imageUtils.ts`

Image dimension parsing for PNG (IHDR chunk), GIF (logical screen descriptor), JPEG (SOF0/SOF1/SOF2 markers), and WebP (VP8/VP8L/VP8X formats).

---

### 4.22 `src/vision/types.ts`

Vision proxy type definitions: `StoredImage`, `InterceptedToolCall`, `ASK_IMAGE_TOOL_DEF`, `ASK_IMAGE_TOOL_NAME`, `ASK_WITH_MULTI_IMAGE_TOOL_DEF`, `ASK_WITH_MULTI_IMAGE_TOOL_NAME`, `DEFAULT_VISION_PROMPT`.

---

### 4.23 `src/vision/imageProxy.ts`

`callVisionModel()` and `callVisionModelMulti()` — Call vision model to answer queries about images. Supports thinking mode configuration and streaming text forwarding. `resolveVisionModel()` resolves the configured bare model ID against VS Code's vendor-prefixed `LanguageModelChat.id` (exact match first, then bare-ID suffix match preferring this extension's own vendor).

---

### 4.24 `src/providers.ts` (multi-provider layer)

`getProviders()`, `getAllModelInfos()`, `getModelConfig()`, `parseCompositeModelId()`, `rescanProviderModels()`, `clearModelCache()`, `getProviderApiKey()` / `storeProviderApiKey()` / `deleteProviderApiKey()` (SecretStorage, keyed `multiLLM.provider.<id>.apiKey`), `defToModelItem()`.

---

## 5. Compilation & Build

### 5.1 Build Commands

```bash
# TypeScript compilation
npm run compile
# Equivalent to: npx tsc -p ./

# ESLint check
npm run lint

# Type check only (no output)
npx tsc --noEmit

# Continuous watch mode
npm run watch

# Run unit tests (compiles first)
npm test

# Refresh the hardcoded catalog snapshot (release builds do this automatically)
node scripts/update-hardcoded-catalog.mjs

# Package VSIX
npm run build
# Equivalent to: npx @vscode/vsce package -o multillm-copilot.vsix
```

### 5.2 Compiler Config (tsconfig.json)

| Option | Value |
|------|-----|
| `module` | `Node16` |
| `target` | `ES2024` |
| `lib` | `["ES2024", "dom"]` |
| `strict` | `true` |
| `outDir` | `out` |
| `rootDir` | `src` |

### 5.3 Dependencies

| Dependency | Version | Purpose |
|------|------|------|
| `@microsoft/tiktokenizer` | ^1.0.10 | o200k_base tokenizer |
| `@eslint/js` | 9.39.4 | ESLint JavaScript recommended rules |
| `@types/node` | ^22 | Node.js type definitions |
| `@types/vscode` | ^1.116.0 | VS Code type definitions |
| `eslint` | 9.39.4 | Code linter |
| `typescript` | ^5.9.2 | TypeScript compiler |
| `typescript-eslint` | 8.60.1 | TypeScript ESLint config and parser |

---

## 6. Development Conventions

### 6.1 Compilation Check Rule

> **All code changes must pass `npm run compile` / `npx tsc --noEmit` with zero errors.**  
> **The build output filename is fixed as `multillm-copilot.vsix` and must not be changed.**

### 6.2 AGENTS.md Sync Rule

> **After every code change, this document must be updated:**
> - New/modified/deleted functions, classes, interfaces → Update Section 4
> - New/deleted/renamed files → Update Section 3
> - New/modified/deleted model definitions → Update Section 1.3
> - Modified core logic flows → Update Section 2
> - Modified build config, dependencies → Update Section 5
> - Modified development conventions → Update Section 6

### 6.3 PR Content Standards

Use Conventional Commit style for titles. Body template includes `### Changes` organized by feature area with bullet points, and `### Files Changed` table listing key files.

### 6.4 Changelog Content Standards

Organized by feature category using `###` headings. Each change point uses `- **Title**: Description` format. Written in English, professional and concise style. Organized by feature domain, not commit timeline.

### 6.5 Code Style

- TypeScript strict mode (`strict: true`)
- ES2024 standard
- ESModule module system
- JSDoc comments on new API functions
- Explicit type annotations on exports
- `satisfies` operator for type safety

### 6.6 Naming Conventions

| Category | Convention | Example |
|------|------|------|
| Class | PascalCase | `MultiLLMChatModelProvider` |
| Interface | PascalCase | `ProviderModelDef` |
| Type | PascalCase | `OpenAIChatRole` |
| Function | camelCase | `getModelConfig` |
| Variable | camelCase | `requestTimeoutMs` |
| Constant | UPPER_SNAKE_CASE | `BASE_TOKENS_PER_MESSAGE` |
| Private property | `_` prefix | `_lastRequestTime` |
| File | camelCase | `provider.ts` |

### 6.7 VS Code API Usage Constraints

- `LanguageModelChatProvider` — Must implement `provideLanguageModelChatResponse()` and `provideLanguageModelChatInformation()`
- `LanguageModelResponsePart` — Use `LanguageModelTextPart`, `LanguageModelThinkingPart`, `LanguageModelToolCallPart`, `LanguageModelDataPart`
- `LanguageModelChatInformation.maxOutputTokens` — Must be non-zero for native Token indicator to show
- `SecretStorage` — For secure API Key storage
- `LogOutputChannel` — For structured log output
- `Progress<LanguageModelResponsePart>` — For streaming response chunk reporting

### 6.8 No Dependency on VS Code Proposed API

This extension uses only stable VS Code APIs (VS Code 1.116+). Type declaration files are only for compile-time type completion.

### 6.9 Error Handling Strategy

- Network requests: `executeWithRetry()` (default 3 retries, exponential backoff)
- API authentication failure → Prompt user for key
- Request timeout → Friendly localized error message
- Streaming parse error → Log, continue processing
- All uncaught errors handled by `provider.ts` catch block

### 6.10 Logging Conventions

All logs use the `logger` singleton with `category.subcategory` tag format:
- `request.start/end` — Request start/end
- `request.error/timeout/delay` — Request errors/timeouts/delays
- `models.loaded` — Model loading
- `commit.start/end/error` — Commit message generation
- `openai.stream.*` / `anthropic.stream.*` — Streaming processing
- `apiKey.missing` — API Key missing
