import * as vscode from "vscode";
import { CancellationToken, LanguageModelChatInformation, PrepareLanguageModelChatModelOptions } from "vscode";
import { getAllModelInfos, clearModelCache } from "./providers";
import { clearApiModelCache } from "./apiModelList";
import { clearModelsDevCache } from "./modelsDev";
import { logger } from "./logger";

/**
 * Get the list of available language models contributed by this provider.
 * Models are sourced from all enabled providers in the multiLLM.providers config.
 */
export async function prepareLanguageModelChatInformation(
    _options: PrepareLanguageModelChatModelOptions,
    _token: CancellationToken,
    secrets: vscode.SecretStorage
): Promise<LanguageModelChatInformation[]> {
    return getAllModelInfos(secrets);
}

/**
 * Drop all cached model discovery state so the next model list request
 * re-fetches from every source (provider model endpoints, the API model list,
 * and the models.dev catalog). Used by the "Rescan Models" command.
 */
export function resetAutoDiscoveryState(): void {
    clearModelCache();
    clearApiModelCache();
    clearModelsDevCache();
    logger.info("models.discovery", { action: "reset" });
}
