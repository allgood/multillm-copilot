#!/usr/bin/env node

/**
 * Check for new models available on the API that are not yet hardcoded.
 *
 * Extracts hardcoded model IDs from src/models.ts (BUILT_IN_MODELS) and
 * src/zen/zenModels.ts (ZEN_FREE_MODEL_IDS), then compares against the
 * API model list from /zen/go/v1/models.
 *
 * Outputs JSON result that can be consumed by a GitHub Action.
 *
 * Usage:
 *   node scripts/check-new-models.mjs
 *
 * Exit codes:
 *   0 — no new models found (or API unreachable)
 *   1 — new models found
 */

const API_BASE_URL = "https://opencode.ai/zen/go/v1/";
const MODELS_TS_PATH = new URL("../src/models.ts", import.meta.url);
const ZEN_MODELS_TS_PATH = new URL("../src/zen/zenModels.ts", import.meta.url);

// ── Helpers ──

function extractModelsFromBuiltIn(fileContent) {
    const ids = [];
    // Match: { baseId: "xxx", ... }
    const regex = /\{\s*baseId:\s*"([^"]+)"/g;
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
        ids.push(match[1]);
    }
    return [...new Set(ids)].sort();
}

function extractZenFreeIds(fileContent) {
    const ids = [];
    // Match: "xxx",  inside ZEN_FREE_MODEL_IDS array
    const regex = /"(big-pickle|deepseek-v4-flash-free|minimax-m3-free|minimax-m2\.5-free|mimo-v2\.5-free|ring-2\.6-1t-free|nemotron-3-super-free|qwen3\.6-plus-free)"/g;
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
        ids.push(match[1]);
    }
    // If regex misses something, also try generic in-array string match
    if (ids.length === 0) {
        // Fallback: find the ZEN_FREE_MODEL_IDS array and extract
        const arrayStart = fileContent.indexOf("ZEN_FREE_MODEL_IDS");
        if (arrayStart >= 0) {
            const bracket = fileContent.indexOf("[", arrayStart);
            const closeBracket = fileContent.indexOf("]", bracket);
            const arrayContent = fileContent.slice(bracket + 1, closeBracket);
            const genericRegex = /"([^"]+)"/g;
            let gm;
            while ((gm = genericRegex.exec(arrayContent)) !== null) {
                ids.push(gm[1]);
            }
        }
    }
    return [...new Set(ids)].sort();
}

async function fetchApiModelIds(apiKey) {
    const url = `${API_BASE_URL.replace(/\/+$/, "")}/models`;
    const response = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!response.ok) {
        throw new Error(`API error: [${response.status}] ${response.statusText}`);
    }
    const body = await response.json();
    return (body.data ?? []).map((m) => m.id).sort();
}

async function fetchModelsDevEntry(apiModelId) {
    // Try downloading the full catalog for lookup
    const url = "https://models.dev/models.json";
    const response = await fetch(url);
    if (!response.ok) return null;
    const catalog = await response.json();
    // Direct match
    if (catalog[apiModelId]) return catalog[apiModelId];
    // Short ID match (last segment after /)
    for (const [fullId, entry] of Object.entries(catalog)) {
        if (fullId.endsWith(`/${apiModelId}`) || fullId === apiModelId) {
            return entry;
        }
    }
    return null;
}

// ── Main ──

async function main() {
    const args = process.argv.slice(2);
    const apiKeyIndex = args.indexOf("--api-key");
    const apiKey = apiKeyIndex >= 0 ? args[apiKeyIndex + 1] : process.env.OPENCODE_API_KEY;

    // 1. Read hardcoded IDs
    const fs = await import("fs");
    const modelsTs = fs.readFileSync(MODELS_TS_PATH, "utf-8");
    const zenModelsTs = fs.readFileSync(ZEN_MODELS_TS_PATH, "utf-8");

    const builtInIds = extractModelsFromBuiltIn(modelsTs);
    const zenFreeIds = extractZenFreeIds(zenModelsTs);
    const allHardcodedIds = [...new Set([...builtInIds, ...zenFreeIds])].sort();

    console.error(`[check] Built-in models: ${builtInIds.length} IDs`);
    console.error(`[check] Zen free models: ${zenFreeIds.length} IDs`);
    console.error(`[check] Total hardcoded: ${allHardcodedIds.length} IDs`);

    // 2. Fetch API model list (no authentication required for model listing)
    let apiModelIds = [];
    let fetchSuccessful = false;
    try {
        apiModelIds = await fetchApiModelIds(apiKey);
        fetchSuccessful = true;
        console.error(`[check] API models: ${apiModelIds.length} IDs`);
    } catch (err) {
        console.error(`[check] Failed to fetch API model list: ${err.message}`);
    }

    // 3. Compare
    const result = {
        fetchSuccessful,
        apiModelIds,
        builtInIds,
        zenFreeIds,
        newModelIds: [],
        newModelDetails: [],
        summary: "",
    };

    if (fetchSuccessful && apiModelIds.length > 0) {
        const hardcodedSet = new Set(allHardcodedIds);
        result.newModelIds = apiModelIds.filter((id) => !hardcodedSet.has(id));

        if (result.newModelIds.length > 0) {
            // Fetch details from models.dev for each new model
            for (const modelId of result.newModelIds.slice(0, 30)) {
                try {
                    const entry = await fetchModelsDevEntry(modelId);
                    if (entry) {
                        result.newModelDetails.push({
                            id: modelId,
                            name: entry.name ?? modelId,
                            context: entry.limit?.context,
                            output: entry.limit?.output,
                            vision: entry.attachment === true || (entry.modalities?.input ?? []).includes("image"),
                            reasoning: entry.reasoning,
                            tool_call: entry.tool_call,
                        });
                    } else {
                        result.newModelDetails.push({ id: modelId });
                    }
                } catch {
                    result.newModelDetails.push({ id: modelId });
                }
            }

            result.summary = `Found ${result.newModelIds.length} new model(s) on API not yet in hardcoded list.`;
            console.error(`[check] ${result.summary}`);
            for (const m of result.newModelIds) {
                console.error(`[check]   - ${m}`);
            }
        } else {
            result.summary = "All API models are covered by the hardcoded list.";
            console.error(`[check] ${result.summary}`);
        }
    } else {
        result.summary = "API fetch failed or skipped — cannot compare.";
        console.error(`[check] ${result.summary}`);
    }

    // 4. Output JSON for GitHub Action consumption
    console.log(JSON.stringify(result));

    // Exit code: 1 if new models found, 0 otherwise
    if (result.newModelIds.length > 0) {
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    // Output empty result on error so the action can handle it gracefully
    console.log(JSON.stringify({
        fetchSuccessful: false,
        apiModelIds: [],
        builtInIds: [],
        zenFreeIds: [],
        newModelIds: [],
        newModelDetails: [],
        summary: `Script error: ${err.message}`,
    }));
    process.exit(0);
});
