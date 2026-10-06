# Upstream Sync Guide

This guide documents the process for syncing changes from the upstream repository (`OnesoftQwQ/opencode-go-copilot`) into our fork (`allgood/multillm-copilot`) which adds multi-LLM provider support.

## Repository Structure

| Remote | URL | Branch | Purpose |
|--------|-----|--------|---------|
| `upstream` | `https://github.com/OnesoftQwQ/opencode-go-copilot` | `master` | Original single-provider extension |
| `multillm` | `https://github.com/allgood/multillm-copilot.git` | `main` | Our fork with multi-provider support |

## Key Architectural Differences

Our fork diverges from upstream in these ways:

| Aspect | Upstream | Our Fork |
|--------|----------|----------|
| Settings prefix | `opencodego.*` | `multiLLM.*` |
| Model item type | `OpenCodeGoModelItem` | `MultiLLMModelItem` |
| Provider class | `OpenCodeGoChatModelProvider` | `MultiLLMChatModelProvider` |
| Provider config | Single hardcoded provider | Multi-provider via `multiLLM.providers` setting |
| Model sources | Catalog only | Static + catalog + dynamic discovery |
| Type file | Single `OpenCodeGoModelItem` | `MultiLLMModelItem` + `ProviderConfig` + `ProviderModelDef` |

## Sync Workflow

### 1. Identify New Upstream Changes

```bash
# Fetch latest upstream
git fetch upstream

# Find the merge base (last common commit)
git merge-base main remotes/upstream/master

# List all commits since last sync
git log --oneline <merge-base>..remotes/upstream/master
```

### 2. Analyze Each Change

For each upstream commit, get the diff:

```bash
# See files changed
git show <commit> --stat

# Get full source diff
git show <commit> -- src/
```

### 3. Categorize Changes

| Category | Action |
|----------|--------|
| **Bug fixes** | Port directly, adapt naming |
| **New features** | Port if useful, adapt to multi-provider architecture |
| **Refactors** | Port if they don't conflict with multi-provider design |
| **Zen-specific** | Skip (we removed Zen support) |
| **Version bumps** | Skip (we manage our own version) |
| **Hardcoded model list** | Skip (we use dynamic catalog) |

### 4. Naming Adaptations

When porting code, apply these substitutions:

| Upstream | Our Fork |
|----------|----------|
| `opencodego` | `multiLLM` |
| `OpenCodeGoModelItem` | `MultiLLMModelItem` |
| `OpenCodeGoChatModelProvider` | `MultiLLMChatModelProvider` |
| `opencodego.*` settings | `multiLLM.*` settings |

### 5. Architecture-Specific Adaptations

#### Tool Conversion Functions

Upstream passes `modelId` to `convertToolsToOpenAI()` for Zen-specific `tool_choice` logic. Our fork removed this parameter since we don't have Zen models:

```typescript
// Upstream
convertToolsToOpenAI(options, modelId)

// Our fork
convertToolsToOpenAI(options)
```

#### Catalog Provider ID

Upstream has two providers (`opencode-go` and `opencode` for Zen). Our fork only has `opencode-go`:

```typescript
// Upstream
export type ProviderId = "opencode-go" | "opencode";

// Our fork
export type ProviderId = "opencode-go";
```

#### Vision Proxy Thinking Mode

Our fork has additional vision proxy code in `provider.ts` that also needs the `supportsThinkingParam` guard when upstream adds it to the main request builders.

### 6. Verification

After porting changes:

```bash
# Compile check (MUST pass with zero errors)
npm run compile

# Lint check
npm run lint

# Run tests
npm test
```

### 7. Commit Message Format

```
feat: port upstream v<X.Y.Z> <brief description>

- Port <commit-hash>: <upstream commit title>
- Adapt naming: opencodego → multiLLM
- Skip Zen-specific code (removed in our fork)
```

## Common Pitfalls

1. **Zen references**: Upstream may still have Zen code in older commits. Always check for `isZenFreeModelId`, `resolveProviderForModelId`, `opencode` provider ID.

2. **Settings prefix**: Upstream uses `opencodego.*`, we use `multiLLM.*`. Don't miss these in configuration reads.

3. **Vision proxy**: Our fork has additional vision proxy code in `provider.ts` that upstream doesn't have. When upstream adds guards to request builders, also add them to the vision proxy builders.

4. **Tool conversion**: Our fork simplified `convertToolsToOpenAI` to not take `modelId`. Don't re-add it.

5. **Hardcoded model list**: Upstream maintains `src/hardcodedModelList.ts`. Our fork uses dynamic catalog discovery, so we skip changes to that file.

## Recent Sync History

### v1.12.0 Sync (2026-10-06)

Changes ported from upstream v1.11.0 → v1.12.0:

| Commit | Description | Status |
|--------|-------------|--------|
| `5b80634` | Add `supportsThinkingParam` for GLM-5.3 | ✅ Ported |
| `87745e9` | Fix data URI image decode with Buffer | ✅ Ported |
| `507c1cb` | Gate statusbar on `enableThirdPartyTokenIndicator` | ✅ Ported |
| `81a131a` | Use undici for Go usage polling | ✅ Ported |
| `be77049` | Remove OpenCode Zen free model support | ✅ Ported |

## Files to Check During Sync

When syncing, always check these files for naming differences:

- `src/types.ts` — Model item interface
- `src/catalogModels.ts` — Provider ID type, catalog resolution
- `src/modelOverrides.ts` — Per-model overrides
- `src/providers.ts` — Multi-provider config (our fork only)
- `src/provider.ts` — Main provider class
- `src/openai/openaiApi.ts` — OpenAI adapter
- `src/anthropic/anthropicApi.ts` — Anthropic adapter
- `src/openai/responsesApi.ts` — Responses adapter
- `src/utils.ts` — Utility functions
- `src/statusBar.ts` — Status bar (uses `multiLLM.*` settings)
- `src/goUsage.ts` — Usage polling
- `src/localize.ts` — Translations
- `src/modelsDev.ts` — Catalog fetching
- `package.json` — Settings definitions
