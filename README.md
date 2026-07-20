<div align="center">

# Multi-LLM Provider for Copilot

Use any OpenAI-compatible or Anthropic-compatible LLM API with GitHub Copilot Chat.

</div>

## Overview

Multi-LLM Provider for Copilot is a VS Code extension that lets you configure arbitrary LLM providers (OpenAI, Anthropic, OpenCode Go, local endpoints, or any custom API) and use their models directly in the Copilot Chat panel. Instead of being locked to a single provider, you define providers in settings and all their models appear in the model picker — grouped and ready to use.

**Key features**:

- Multiple API providers in one extension (OpenAI, Anthropic, custom endpoints)
- Auto-discovery of models via `/v1/models` endpoint
- Streaming responses with token usage indicators
- Thinking/reasoning support (when the model exposes it)
- Git commit message generation with style matching
- Vision proxy — text-only models can "see" images via a vision-capable model
- Temperature presets
- Status bar with cumulative token tracking

## Quick Start

### 1. Install

Download the latest `multillm-copilot.vsix` from the [Releases page](https://github.com/allgood/multillm-copilot/releases), then install it:

```bash
code --install-extension multillm-copilot.vsix
```

Or: `Cmd+Shift+P` → `Extensions: Install from VSIX...` → select the downloaded `multillm-copilot.vsix`

### 2. Add a Provider

Open the provider manager:

`Cmd+Shift+P` → `Multi-LLM: Manage Providers`

→ `Add Provider` and fill in:

| Field | Example | Notes |
|-------|---------|-------|
| **Provider ID** | `my-server` | Internal identifier (lowercase, hyphens OK) |
| **Display Label** | `My LLM Server` | Shown in UI |
| **Base URL** | `https://api.example.com/v1` | Must start with `http` |
| **API Mode** | `openai` or `anthropic` | Protocol the API speaks |
| **Group** | `My Models` | Label in model picker (defaults to label) |
| **Models discovery URL** | `https://api.example.com/v1` | Leave empty to skip auto-detection |

If you provide a **Models discovery URL**, the extension calls `GET {url}/models` on startup and auto-discovers all available models with their capabilities (context window, max tokens, vision support, reasoning). No manual model definitions needed.

If you skip it, add models manually via `Models: <provider>` in the manager.

### 3. Set the API Key

Either:

- `Cmd+Shift+P` → `Multi-LLM: Set API Key` → pick provider → enter key
- Or in the provider manager: `API Key: <provider>`

API keys are stored in VS Code's secure `SecretStorage`, not in plaintext settings.

### 4. Reload and Chat

`Cmd+Shift+P` → `Developer: Reload Window`

Open Copilot Chat (`Cmd+Shift+I` → Copilot Chat tab), click the model dropdown at the bottom, and look for your provider's group.

## Pre-configured Providers

The extension ships with three provider definitions in its default settings:

### OpenCode Go (enabled by default)

17 models from the OpenCode Go platform (DeepSeek, Qwen, GLM, Kimi, MiMo, MiniMax series). Uses `https://opencode.ai/zen/go/v1/` as base URL. You only need to set the API key.

### OpenAI (disabled by default)

Auto-discovers all models from `https://api.openai.com/v1/models`. Enable it in the provider manager or settings, then set your OpenAI API key.

### Anthropic (disabled by default)

Pre-configured with Claude Sonnet 4. Enable and set your Anthropic API key to use it.

## Provider Manager Reference

The `Multi-LLM: Manage Providers` command opens a menu for each provider:

| Action | Description |
|--------|-------------|
| **Edit** | Change provider ID, label, base URL, API mode, group, or discovery URL |
| **Models** | Add, edit, or remove static model definitions with their capabilities |
| **API Key** | Set, update, or clear the API key (stored securely) |
| **Enable/Disable** | Toggle whether this provider appears in the model picker |
| **Delete** | Remove provider, its API key, and all its model definitions |

### Adding Static Models

If auto-discovery doesn't work for your provider (or you want to override metadata), use the Models sub-menu:

`Models: <provider>` → `Add Model`

| Field | Notes |
|-------|-------|
| Model ID | Sent to API (e.g. `gpt-4o`, `claude-sonnet-4`) |
| Display Name | Shown in model picker |
| Vision | Whether native image input is supported |
| Thinking Mode | `switchable` (user choice), `always`, or `adaptive` (auto + disabled only) |
| Context Length | Max input tokens |
| Max Output | Max output tokens |

## Git Commit Message Generation

Click the magic wand icon in the Source Control panel to auto-generate a Conventional Commits-format commit message from staged/unstaged diffs.

**Requirements**:

- Set a model for commits: `Settings` → `multiLLM.commitModel` (format: `providerId:modelId`, e.g. `opencode-go:deepseek-v4-flash`)
- The provider for that model must have an API key configured

**Commit generation settings**:

| Setting | Default | Description |
|---------|---------|-------------|
| `multiLLM.commitModel` | `opencode-go:deepseek-v4-flash` | Model for commit messages |
| `multiLLM.commitLanguage` | `auto` | Detects language from recent commits automatically |
| `multiLLM.recentCommitsCount` | `10` | Number of recent commits to reference for style |
| `multiLLM.commitIncludeCommitDiff` | `false` | Include diffs of recent commits for better style matching |
| `multiLLM.commitAttachContextFiles` | `true` | Include AGENTS.md/README.md as context |
| `multiLLM.commitMessagePrompt` | `""` | Custom system prompt (empty = default) |

## Vision Proxy

Text-only models (no native vision) can still answer questions about images. When a model receives an image, it is offered an `ask_image` tool. If invoked:

1. A vision-capable model (default: Qwen3.6 Plus) describes the image based on the text model's question
2. The description is fed back to the text model
3. The model continues its response with full image context

No user action needed — fully automatic. Configure via:

- `multiLLM.visionProxyModel` — which model to use for vision
- `multiLLM.visionProxyThinking` — whether the vision model should use reasoning

## Temperature Presets

`Cmd+Shift+P` → `Multi-LLM: Set Model Preset`

| Preset | Temperature |
|--------|-------------|
| Precise | 0.0 |
| Balanced | 1.0 |
| Creative | 1.2 |
| Extra Creative | 1.7 |
| Custom | Manual input |

Custom mode lets you set `temperature` and optionally `top_p` directly.

## Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `multiLLM.providers` | Array (see above) | All configured LLM providers |
| `multiLLM.requestTimeout` | 600000 (10 min) | Max time per API request in ms |
| `multiLLM.delay` | 0 | Delay between consecutive requests in ms |
| `multiLLM.enableThirdPartyTokenIndicator` | true | Show token usage in status bar |
| `multiLLM.modelPreset` | `precise` | Temperature preset ID |
| `multiLLM.temperature` | null | Manual temperature (when preset = custom) |
| `multiLLM.top_p` | null | Manual top_p (when preset = custom) |

## How Auto-Discovery Works

When a provider has `modelsBaseUrl` set, the extension:

1. Calls `GET {modelsBaseUrl}/models` (no API key needed if the endpoint is public)
2. Expects response format:
   ```json
   {
     "data": [
       {
         "id": "model-name",
         "context_window": 100000,
         "max_output_tokens": 100000,
         "capabilities": {
           "vision": true,
           "reasoning": false,
           "tool_calls": true
         }
       }
     ]
   }
   ```
3. All fields except `id` are optional — missing values get sensible defaults
4. Results are cached for 5 minutes
5. Auto-discovered models appear alongside any manually-defined static models

Static model definitions always take priority if there's an ID conflict.

## Build

```bash
npm install
npm run compile    # TypeScript → output
npm run build      # Package multillm-copilot.vsix
```
