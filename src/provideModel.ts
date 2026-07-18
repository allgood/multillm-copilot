import * as vscode from "vscode";
import { CancellationToken, LanguageModelChatInformation, PrepareLanguageModelChatModelOptions } from "vscode";
import { getAllModelInfos } from "./providers";

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
