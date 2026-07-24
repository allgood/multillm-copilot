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

**OpenCode Go Copilot Provider** is a VS Code extension that integrates the OpenCode Go platform's AI language models into GitHub Copilot Chat. Users can select and use various models provided by OpenCode Go (such as the DeepSeek, GLM, Qwen, MiMo, MiniMax, Kimi, and other series) within VS Code's Copilot Chat interface, enjoying features like intelligent code completion, chat conversations, and Git commit message generation.

### 1.2 Core Capabilities

| Capability | Description |
|------|------|
| **Chat Model Provider** | Implements the `LanguageModelChatProvider` interface, registering `opencodego` as a vendor in VS Code |
| **Multi-Model Support** | 17 built-in model definitions across 6 major model families, with unified thinking mode switching via a reasoning intensity selector. Optional OpenCode Zen free models (8 models). Supports automatic model discovery: when enabled, fetches the model list from the API, automatically filters unavailable models, and discovers newly added models |
| **Automatic Model Discovery** | Controlled by the `opencodego.enableAutoModelDiscovery` setting (enabled by default). At startup, fetches the current list of available model IDs from `/zen/go/v1/models`, filters the built-in model list (unavailable models are automatically hidden). New models obtain metadata (context length, vision capability, tool calling, reasoning ability, etc.) from the `models.dev` database and are automatically added; `thinkingMode` is inferred from the `reasoning` field (supports reasoning → `switchable`, does not support → `always`). Silently falls back to the full built-in list when the API is unavailable. In-memory cache (5-minute TTL) |
| **OpenCode Zen Free Models** | Enabled via a settings toggle, fetches the model list from the Zen API and filters down to 6 free models (Big Pickle, DeepSeek V4 Flash, MiniMax M3, MiniMax M2.5, Ring 2.6 1T, Nemotron 3 Super), appending them to the model picker with the `OpenCode Zen` label. Supports in-memory caching (5-minute TTL), with silent degradation when the API is unavailable |
| **Dual API Mode** | Simultaneously supports the **OpenAI-compatible format** (`/chat/completions`) and the **Anthropic format** (`/v1/messages`) |
| **Streaming Inference** | Supports SSE (Server-Sent Events) streaming responses, outputting text and tool calls in real time |
| **Thinking / Reasoning** | Supports displaying the model's reasoning process ("thinking" state), including XML think block parsing |
| **Tool Calling** | Supports VS Code's `LanguageModelToolCallPart` mechanism |
| **Image Proxy (Tool-based)** | Injects the `ask_image` tool for non-vision models. The model can autonomously choose to call a vision model (default: Qwen3.6-Plus) to answer specific questions about images, supporting a two-round API request flow: "call tool → ask question → get answer → continue answering." Unlike the older `describe_image`, `ask_image` allows the model to ask specific questions about an image (e.g., "What color is the button?"), and the vision model answers specifically. The vision model ID, query prompt, and thinking mode are all configurable via settings; the vision proxy displays "Asking about image: [question]" within the same thinking block and appends the vision model's streaming output in real time |
| **Token Counting** | Uses the `o200k_base` tiktoken tokenizer for precise token usage statistics |
| **Status Bar** | Real-time display of the current session's token usage, cumulative usage, and cache hit rate |
| **Native Token Indicator** | Always enabled, reports token usage to Copilot Chat's native Token indicator. Implemented by sending a `LanguageModelDataPart` with MIME type `usage` (JSON encoded via TextEncoder), without needing a custom status bar. Depends on VS Code / Copilot Chat 1.116+ recognition of the `usage` data part for external models |
| **Advanced Token Indicator** | Controlled by the `opencodego.enableThirdPartyTokenIndicator` setting (enabled by default) to show an advanced token counter in the VS Code status bar. When disabled, only the native indicator is shown |
| **Git Commit Message Generation** | One-click generation of Conventional Commit-format Git commit messages, supporting `auto` language mode to automatically detect language from historical commits |
| **Multi-Repository Support** | Supports commit message generation for multiple Git repositories in multi-root workspaces |
| **Model Presets** | Supports quick switching of temperature/top_p presets (🎯 Precise / ⚖️ Balanced / 🔥 Creative) via the command palette, as well as manual custom input |
| **Internationalization** | Built-in bilingual interface in Simplified Chinese (zh-cn) and English |
| **Retry Mechanism** | Configurable exponential backoff retry strategy for network jitter and rate limiting (429) |
| **Request Delay** | Configurable inter-request delay to avoid triggering API rate limits |
| **Timeout Control** | Configurable request timeout (default: 10 minutes) |
| **Immediate Cancellation** | When canceling a request, immediately interrupts stream reading via `reader.cancel()`, stopping background reception |
| **Vision Proxy Configuration** | Supports configuring the vision model and thinking mode used by the image proxy via the `opencodego.visionProxyModel` and `opencodego.visionProxyThinking` settings. `opencodego.visionProxyThinking` is off by default; when off, internal requests disable vision model thinking via `modelOptions.thinking={ type: false }` / `reasoning_effort="disabled"`, and the final OpenAI-compatible request body sends `thinking: { type: false }` |
| **Dynamic Model Rescan** | Running `Multi-LLM: Rescan Models` from the command palette forcibly re-fetches the `/v1/models` dynamic model list for any enabled provider (or all providers), bypassing the 5-minute cache and immediately refreshing model picker data |
| **Installation Welcome Page (Walkthrough)** | Automatically opens a guided wizard on first install when no API Key is configured, guiding the user to set their API Key and open the language model manager. Contains 3 steps: Set API Key, Show Models, Advanced Settings. Detected immediately after VS Code startup via the `onStartupFinished` activation event |

### 1.3 Model Catalog

> **Automatic model discovery** (enabled by default) fetches the current available model list from the API, automatically hides built-in models not in the list, and automatically adds new models returned by the API from models.dev. The following is the full built-in model definition; what is actually displayed depends on API availability.

#### Built-in Models

| Family | Model ID | Vision | Reasoning Intensity Selector | API Format |
|------|---------|------|----------------|----------|
| GLM | `glm-5.2`, `glm-5.1`, `glm-5` | ❌ | `Disable thinking` / `High` / `Max` (5.2)² / `Thinking` (5.1/5 does not support thinking switch) | OpenAI |
| Kimi | `kimi-k3`¹, `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code`¹ | ✅ | `Disable thinking` / `Thinking` (K3); `Thinking` (K2.x, does not support thinking switch) | OpenAI |

> ¹ `kimi-k3` and `kimi-k2.7-code` do not support setting Temperature/Top-p parameters.
> ² GLM-5.2 supports setting thinking intensity (high/max) via reasoning_effort. GLM-5.1/GLM-5 do not support thinking switching.
| DeepSeek | `deepseek-v4-pro`, `deepseek-v4-flash` | ❌ | `Disable thinking` / `High` / `Very high` | OpenAI |
| MiMo | `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5-pro`, `mimo-v2.5` | mimo-v2-omni ✅ | `Disable thinking` / `Thinking` | OpenAI |
| MiniMax | `minimax-m3`, `minimax-m2.7`, `minimax-m2.5` | ❌ | `Disable thinking` / `Auto` | OpenAI (m2.7 uses Anthropic) |
| Qwen | `qwen3.7-max` | ❌ | `Disable thinking` / `Auto` | Anthropic |
| Qwen | `qwen3.6-plus`, `qwen3.5-plus` | ✅ | `Disable thinking` / `Auto` | Anthropic |

#### OpenCode Zen Free Models (Optional)

Enabled via the `opencodego.enableZenFreeModels` setting (disabled by default). Fetches the model list from the Zen API, filters by hardcoded IDs, and appends them to the model picker.

| Display Name | Model ID | Vision | Reasoning Intensity Selector | API Format | Notes |
|--------|---------|------|----------------|----------|------|
| Zen/Big Pickle Free | `big-pickle` | ❌ | `Thinking` (does not support thinking switch) | OpenAI | Time-limited free |
| Zen/DeepSeek V4 Flash Free | `deepseek-v4-flash-free` | ❌ | `Disable thinking` / `High` / `Very high` | OpenAI | Time-limited free |
| Zen/MiniMax M3 Free | `minimax-m3-free` | ✅ | `Disable thinking` / `Adaptive` | OpenAI | Time-limited free; 1M context, supports only `adaptive` / `disabled` thinking modes |
| Zen/MiniMax M2.5 Free | `minimax-m2.5-free` | ❌ | `Disable thinking` / `Thinking` | OpenAI | Time-limited free |
| Zen/Ring 2.6 1T Free | `ring-2.6-1t-free` | ❌ | `Disable thinking` / `Thinking` | OpenAI | Time-limited free |
| Zen/Nemotron 3 Super Free | `nemotron-3-super-free` | ❌ | `Disable thinking` / `Thinking` | OpenAI | Time-limited free |

In the model picker, built-in models are grouped under `OpenCode Go` (`family="OpenCodeGo"`), while Zen free models are grouped under `OpenCode Zen` (`family="OpenCode Zen"`) for differentiation.

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
│  │  OpenCodeGoChatModelProvider (provider.ts)                    │  │
│  │   1. Get model config (getBuiltInModelConfig)                 │  │
│  │   2. Get API Key (SecretStorage)                              │  │
│  │   3. Calculate token usage (provideToken → statusBar)         │  │
│  │   3b. Optional: Report usage to Copilot Chat native indicator │  │
│  │       (LanguageModelDataPart, MIME type "usage", VS Code 1.116+)│ │
│  │   4. Apply request delay                                      │  │
│  │   5. Build request → API route selection                      │  │
│  │      ├─ apiMode="openai"    → OpenaiApi                       │  │
│  │      └─ apiMode="anthropic" → AnthropicApi                    │  │
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
│    → Build prompt → Call API (OpenaiApi/AnthropicApi)              │
│    → Stream output to SCM InputBox                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Extension Activation Flow

```
activate(context)
  ├── logger.init()                         ← Create LogOutputChannel
  ├── TokenizerManager.initialize()         ← Load o200k_base.tiktoken
  ├── initStatusBar()                       ← Create status bar entry
  ├── new OpenCodeGoChatModelProvider()      ← Create Provider instance
  ├── vscode.lm.registerLanguageModelChatProvider("opencodego", provider)
  ├── Register commands:
  │   ├── opencodego.setApiKey                ← Set API Key
  │   ├── opencodego.getApiKey                ← Open OpenCode AI site to get Key
  │   ├── opencodego.openSettings             ← Open extension settings page
  │   ├── opencodego.generateGitCommitMessage ← Generate commit message
  │   ├── opencodego.abortGitCommitMessage    ← Abort generation
  │   └── opencodego.setModelPreset           ← Set model preset
  ├── showWelcomeIfNeeded()                 ← Show welcome wizard on first install
  └── Register dispose cleanup
```

### 2.3 Chat Request Processing Flow

```
provideLanguageModelChatResponse(model, messages, options, progress, token)
  │
  ├── 1. Resolve model ID → getBuiltInModelConfig(model.id)
  │       Format: "baseId" (no :: suffix)
  │       All models registered as a single entry
  │       Fallback to getZenFreeModelConfig(model.id) if built-in model not found
  │       Fallback to getAutoDiscoveredModelConfig(model.id) if still not found
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
  ├── 3. Determine API mode (apiMode: "openai" | "anthropic")
  │
  ├── 4. Log request start
  │
  ├── 5. Update status bar token usage
  │
  ├── 6. Apply request delay
  │
  ├── 7. Ensure API Key exists
  │
  ├── 8. Create request timeout AbortController
  │      └── Connect VS Code cancellation token → abort()
  │
  ├── 9. Create undici fetch (custom bodyTimeout)
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
- **Anthropic mode**: Uses `tool_use` + `tool_result` content block format
- **Parameter preservation**: Each round preserves temperature, top_p, thinking mode, etc.
- **DeepSeek compatibility**: Injects `reasoning_content` field into assistant tool_call messages

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
  │   ├── OpenaiApi.createMessage() / AnthropicApi.createMessage()
  │   └── Stream output to SCM InputBox
  └── Cleanup: Remove ``` markers and <think> tags
```

---

## 3. Source File Index

### 3.1 Directory Structure

```
src/
├── apiModelList.ts                       # API model list fetching
├── commonApi.ts                          # API abstract base class
├── extension.ts                          # Extension entry (activate/deactivate)
├── localize.ts                           # Internationalization / localization
├── logger.ts                             # Logging system
├── models.ts                             # Built-in model definitions
├── modelsDev.ts                          # models.dev metadata fetching and querying
├── provideModel.ts                       # Model info provider functions (including auto discovery)
├── provider.ts                           # Chat model provider (core main file)
├── provideToken.ts                       # Token counting functions
├── statusBar.ts                          # Status bar management
├── types.ts                              # TypeScript type definitions
├── utils.ts                              # General utility functions
├── versionManager.ts                     # Version info management
├── openai/
│   ├── openaiApi.ts                      # OpenAI-compatible API implementation
│   └── openaiTypes.ts                    # OpenAI type definitions
├── anthropic/
│   ├── anthropicApi.ts                   # Anthropic API implementation
│   └── anthropicTypes.ts                 # Anthropic type definitions
├── gitCommit/
│   ├── commitMessageGenerator.ts         # Git commit message generation
│   └── gitUtils.ts                       # Git utility functions
├── tokenizer/
│   ├── tokenizerManager.ts               # Tokenizer management (o200k_base)
│   └── imageUtils.ts                     # Image dimension parsing
├── vision/
│   ├── types.ts                          # Vision proxy type definitions
│   └── imageProxy.ts                     # Image proxy core (ask_image)
├── zen/
│   └── zenModels.ts                      # Zen free model definitions and API interaction
└── resources/
    └── walkthrough/                      # Installation welcome page (Walkthrough) docs
        ├── set-api-key.md                # Step 1: Set API Key
        ├── set-api-key.nls.zh-cn.md      # Step 1 Chinese version
        ├── show-models.md                # Step 2: Show Models
        ├── show-models.nls.zh-cn.md      # Step 2 Chinese version
        ├── advanced-settings.md          # Step 3: Advanced Settings
        └── advanced-settings.nls.zh-cn.md# Step 3 Chinese version
```

### 3.2 File Details

| File | Lines | Responsibility |
|------|------|------|
| `extension.ts` | ~210 | Extension activation/deactivation, registers Provider and 7 commands, first-install welcome page guidance |
| `providers.ts` | ~320 | Multi-provider config reading, dynamic model cache, API key management, model config resolution |
| `provider.ts` | ~700 | Implements `LanguageModelChatProvider`, handles full chat request flow and image proxy multi-round loop |
| `models.ts` | ~230 | 17 built-in model definitions, model config queries (all models declare `imageInput: true`) |
| `types.ts` | ~95 | Types: `OpenCodeGoModelItem`, `ModelPreset`, `ModelsResponse`, `RetryConfig`, etc. |
| `apiModelList.ts` | ~80 | API model list fetching from `/zen/go/v1/models`, 5-minute cache, silent degradation |
| `modelsDev.ts` | ~130 | models.dev metadata fetching and querying, supports short ID matching, 1-hour cache |
| `commonApi.ts` | ~462 | `CommonApi<TMessage,TRequestBody>` abstract base class (image storage, tool call interception) |
| `provideModel.ts` | ~130 | Model info provider functions (including auto discovery): filters built-in models, auto-discovers new models |
| `provideToken.ts` | ~100 | Token usage calculation |
| `utils.ts` | ~285 | Utility functions (retry, role mapping, tool conversion, etc.) |
| `statusBar.ts` | ~140 | Status bar creation, updates, cumulative counters |
| `logger.ts` | ~55 | Log output (LogOutputChannel) |
| `localize.ts` | ~109 | Chinese/English internationalization |
| `versionManager.ts` | ~35 | Extension version info |
| `openai/openaiApi.ts` | ~613 | OpenAI-format API implementation (message conversion / request building / streaming / image proxy) |
| `openai/openaiTypes.ts` | ~75 | OpenAI type definitions |
| `anthropic/anthropicApi.ts` | ~535 | Anthropic-format API implementation (message conversion / request building / streaming / image proxy) |
| `anthropic/anthropicTypes.ts` | ~130 | Anthropic type definitions |
| `gitCommit/commitMessageGenerator.ts` | ~295 | Git commit message generation logic |
| `gitCommit/gitUtils.ts` | ~260 | Git command wrappers |
| `tokenizer/tokenizerManager.ts` | ~115 | o200k_base tokenizer management (with LRU cache) |
| `tokenizer/imageUtils.ts` | ~130 | Image dimension parsing (PNG/GIF/JPEG/WebP) |
| `vision/types.ts` | ~53 | Vision proxy type definitions |
| `vision/imageProxy.ts` | ~95 | Image proxy core: `callVisionModel`/`callVisionModelMulti`, thinking mode config and text streaming |
| `zen/zenModels.ts` | ~256 | Zen free model definitions, API fetching, cache management, config queries |

---

## 4. Complete Function Reference

### 4.1 `src/extension.ts`

#### `activate(context: vscode.ExtensionContext): void`
Extension activation entry point. Initializes logger, tokenizer, and status bar; registers the `LanguageModelChatProvider`; registers seven commands (Set API Key, Open Extension Settings, Generate Git Commit Message, Abort Generation, Set Model Preset, Manage Providers, Rescan Models); calls `showWelcomeIfNeeded()` on first install.

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

#### `class OpenCodeGoChatModelProvider implements LanguageModelChatProvider`
Core Provider class. Manages request timing, API routing, model config resolution, streaming response processing, image proxy handling, and error management.

#### `provideLanguageModelChatInformation(options, _token): Promise<LanguageModelChatInformation[]>`
Gets available language models list. Delegates to `prepareLanguageModelChatInformation()`.

#### `provideTokenCount(_model, text, _token): Promise<number>`
Counts tokens in text or messages. Delegates to `countMessageTokens()`.

#### `provideLanguageModelChatResponse(model, messages, options, progress, token): Promise<void>`
Core method: handles chat requests with streaming responses. Includes model config resolution (built-in → Zen fallback → auto-discovery fallback), API Key validation, reasoning effort application, temperature/top_p injection, delay control, timeout management, API routing, streaming parsing, image proxy interception handling, and error handling.

#### `private async _handleInterceptedToolCall(params): Promise<void>`
Handles image proxy interception. Loops for up to `visionMaxRounds` rounds. Each round: reads interceptedToolCall, emits thinking block, calls vision model, builds API request, injects tools, processes response. Preserves original parameters across rounds. Uses `_resetStreamState()` between rounds.

#### `private async ensureApiKey(): Promise<string | undefined>`
Ensures API Key exists in SecretStorage; prompts user with input box if missing.

---

### 4.4 `src/models.ts`

#### `interface BuiltInModelDef`
Built-in model definition interface with fields: `baseId`, `displayName`, `vision`, `thinkingMode`, `defaultReasoningEffort`, `supportedReasoningEfforts`, `includeReasoningInRequest`, `supportsTemperature`, `contextLength`, `maxTokens`, `extra`, `apiMode`.

#### `const BUILT_IN_MODELS: BuiltInModelDef[]`
Constant array of 17 built-in model definitions.

#### `getBuiltInModelInfos(): LanguageModelChatInformation[]`
Converts built-in model definitions to VS Code model info list. Each model registered as a single entry with `isUserSelectable: true` and reasoning intensity selector via `configurationSchema`.

#### `getBuiltInModelCount(): number`
Returns total built-in model count.

#### `getBuiltInModelConfig(modelId: string): OpenCodeGoModelItem | undefined`
Looks up built-in model definition by model ID. Thinking mode enablement is dynamically determined by `provider.ts`.

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
- `prepareHeaders()` — HTTP header preparation

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

#### `prepareLanguageModelChatInformation(options, _token, _secrets): Promise<LanguageModelChatInformation[]>`
Gets model info list. Uses hardcoded built-in models by default. When auto-discovery is enabled, filters built-in models by API availability and auto-discovers new models from models.dev. When Zen free models are enabled, appends them.

#### `getAutoDiscoveredModelConfig(modelId): OpenCodeGoModelItem | undefined`
Returns previously auto-discovered model config. Used as third fallback in model config resolution.

---

### 4.10 `src/provideToken.ts`

Token counting functions using o200k_base tiktoken tokenizer. Supports text, images (512px tile algorithm), binary data, tool definitions, and tool results.

---

### 4.11 `src/utils.ts`

Utility functions: `getModelProviderId()`, `modelSupportsTemperature()`, `normalizeUserModels()`, `parseModelId()`, `mapRole()`, `convertToolsToOpenAI()`, `createRetryConfig()`, `executeWithRetry()`, `isRetryableError()`, image/data URL helpers, `tryParseJSONObject()`.

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
OpenAI-compatible API implementation. Handles message conversion, request body building (temperature, top_p, max_tokens, reasoning_effort, thinking mode, tools, tool_choice, penalty params), SSE streaming response processing (delta handling for reasoning, XML think blocks, text, tool calls), and `reasoning_details` array support (OpenRouter format). Also provides non-streaming `createMessage()` generator for Git commit generation.

---

### 4.17 `src/anthropic/anthropicApi.ts`

#### `class AnthropicApi extends CommonApi<AnthropicMessage, AnthropicRequestBody>`
Anthropic-format API implementation. Handles message conversion (system message extraction to `_systemContent`, content block array format), request body building (max_tokens, system, temperature, top_p, top_k, thinking mode, Anthropic-format tools, tool_choice), SSE streaming response processing (8 event types: ping, error, message_start, message_delta, content_block_start, content_block_delta, content_block_stop, message_stop). Also provides non-streaming `createMessage()` generator.

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

`callVisionModel()` and `callVisionModelMulti()` — Call vision model to answer queries about images. Supports thinking mode configuration and streaming text forwarding.

---

### 4.24 `src/zen/zenModels.ts`

Zen free model definitions and API interaction. `fetchZenModelList()`, `buildModelInfos()`, `getZenFreeModelInfos()` (with 5-minute cache and optimistic degradation), `getZenFreeModelConfig()`.

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
| Class | PascalCase | `OpenCodeGoChatModelProvider` |
| Interface | PascalCase | `BuiltInModelDef` |
| Type | PascalCase | `OpenAIChatRole` |
| Function | camelCase | `getBuiltInModelConfig` |
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
