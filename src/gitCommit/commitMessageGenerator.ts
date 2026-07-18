import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getGitDiff, getRecentCommits } from "./gitUtils";
import { OpenaiApi } from "../openai/openaiApi";
import { AnthropicApi } from "../anthropic/anthropicApi";
import { getModelConfig, parseCompositeModelId, getProviderApiKey, storeProviderApiKey } from "../providers";
import { logger } from "../logger";
import { l10n, l10nFormat } from "../localize";
import type { OpenCodeGoModelItem } from "../types";

/**
 * Git commit message generator module.
 */

let commitGenerationAbortController: AbortController | undefined;

const DEFAULT_PROMPT = {
    system:
        "You are a helpful assistant that generates concise, informative git commit messages based on git diffs.\n\nGuidelines:\n- By default, use conventional commit format: <type>(<scope>): <description>\n- If reference commits are provided below, match their style and language instead\n- Keep the subject line under 72 characters\n- Use the imperative mood (\"add\" not \"added\" / \"adds\")\n- CRITICAL: Output ONLY the commit message itself — no preamble, no introduction, no explanations, no backticks\n- If the diff is large, focus on the most important changes",
    user: "Notes from developer (ignore if not relevant): {{USER_CURRENT_INPUT}}",
    styleReference: "\n\nRecent commit messages in this repository (match their style):\n{{RECENT_COMMITS}}",
};

export async function generateCommitMsg(secrets: vscode.SecretStorage, scm?: vscode.SourceControl) {
    try {
        const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
        if (!gitExtension) {
            throw new Error(l10n("Git extension not found"));
        }

        const git = gitExtension.getAPI(1);
        if (git.repositories.length === 0) {
            throw new Error(l10n("No Git repositories available"));
        }

        if (scm) {
            const repository = git.getRepository(scm.rootUri);

            if (!repository) {
                throw new Error(l10n("Repository not found for provided SCM"));
            }

            await generateCommitMsgForRepository(secrets, repository);
            return;
        }

        await orchestrateWorkspaceCommitMsgGeneration(secrets, git.repositories);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${l10n("[Commit Generation Failed]")} ${errorMessage}`);
    }
}

async function orchestrateWorkspaceCommitMsgGeneration(secrets: vscode.SecretStorage, repos: any[]) {
    const reposWithChanges = await filterForReposWithChanges(repos);

    if (reposWithChanges.length === 0) {
        vscode.window.showInformationMessage(l10n("No changes found in any workspace repositories."));
        return;
    }

    if (reposWithChanges.length === 1) {
        const repo = reposWithChanges[0];
        await generateCommitMsgForRepository(secrets, repo);
        return;
    }

    const selection = await promptRepoSelection(reposWithChanges);

    if (!selection) {
        return;
    }

    if (selection.repo === null) {
        for (const repo of reposWithChanges) {
            try {
                await generateCommitMsgForRepository(secrets, repo);
            } catch (error) {
                console.error(`Failed to generate commit message for ${repo.rootUri.fsPath}:`, error);
            }
        }
    } else {
        await generateCommitMsgForRepository(secrets, selection.repo);
    }
}

async function filterForReposWithChanges(repos: any[]) {
    const reposWithChanges = [];

    for (const repo of repos) {
        try {
            const gitDiff = await getGitDiff(repo.rootUri.fsPath);
            if (gitDiff) {
                reposWithChanges.push(repo);
            }
        } catch {
            // Skip repositories with errors
        }
    }
    return reposWithChanges;
}

async function promptRepoSelection(repos: any[]) {
    const repoItems = repos.map((repo) => ({
        label: repo.rootUri.fsPath.split(path.sep).pop() || repo.rootUri.fsPath,
        description: repo.rootUri.fsPath,
        repo: repo,
    }));

    repoItems.unshift({
        label: "$(git-commit) Generate for all repositories with changes",
        description: `Generate commit messages for ${repos.length} repositories`,
        repo: null as any,
    });

    return await vscode.window.showQuickPick(repoItems, {
        placeHolder: "Select repository for commit message generation",
    });
}

async function generateCommitMsgForRepository(secrets: vscode.SecretStorage, repository: any) {
    const inputBox = repository.inputBox;
    const repoPath = repository.rootUri.fsPath;
    const gitDiff = await getGitDiff(repoPath);

    if (!gitDiff) {
        throw new Error(`No changes in repository ${repoPath.split(path.sep).pop() || "repository"} for commit message`);
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.SourceControl,
            title: `Generating commit message for ${repoPath.split(path.sep).pop() || "repository"}...`,
            cancellable: true,
        },
        (_, token) => {
            token.onCancellationRequested(() => {
                commitGenerationAbortController?.abort();
            });
            return performCommitMsgGeneration(secrets, gitDiff, inputBox, repoPath);
        }
    );
}

async function getCommitApiKey(secrets: vscode.SecretStorage, providerId: string): Promise<string | undefined> {
    let apiKey = await getProviderApiKey(providerId, secrets);

    if (!apiKey) {
        const entered = await vscode.window.showInputBox({
            title: l10nFormat("{0} API Key", providerId),
            prompt: l10n("Enter your API key"),
            ignoreFocusOut: true,
            password: true,
        });
        if (entered && entered.trim()) {
            apiKey = entered.trim();
            await storeProviderApiKey(providerId, apiKey, secrets);
        }
    }

    return apiKey;
}

async function performCommitMsgGeneration(secrets: vscode.SecretStorage, gitDiff: string, inputBox: any, repoPath?: string) {
    const startTime = Date.now();
    let modelId: string | undefined;
    try {
        vscode.commands.executeCommand("setContext", "multiLLM.isGeneratingCommit", true);
        const config = vscode.workspace.getConfiguration();

        const customSystemPrompt = config.get<string>("multiLLM.commitMessagePrompt", "");
        let systemPrompt = customSystemPrompt || DEFAULT_PROMPT.system;

        // Fetch recent commits for style reference
        const recentCommitsCount = config.get<number>("multiLLM.recentCommitsCount", 10);
        const includeCommitDiff = config.get<boolean>("multiLLM.commitIncludeCommitDiff", false);
        if (recentCommitsCount > 0 && repoPath) {
            const recentCommits = await getRecentCommits(repoPath, recentCommitsCount, { includeDiff: includeCommitDiff });
            if (recentCommits) {
                const styleRef = includeCommitDiff
                    ? "\n\nRecent commit messages and their changes in this repository (match their style):\n{{RECENT_COMMITS}}"
                    : DEFAULT_PROMPT.styleReference;
                systemPrompt += styleRef.replace("{{RECENT_COMMITS}}", recentCommits);
            }
        }

        const prompts: string[] = [];

        // Attach AGENTS.md and README.md context
        const attachContextFiles = config.get<boolean>("multiLLM.commitAttachContextFiles", true);
        if (attachContextFiles && repoPath) {
            const contextFiles = ["AGENTS.md", "README.md"];
            for (const fileName of contextFiles) {
                const filePath = path.join(repoPath, fileName);
                try {
                    if (fs.existsSync(filePath)) {
                        const content = fs.readFileSync(filePath, "utf-8").trim();
                        if (content) {
                            const truncated = content.length > 8000
                                ? content.substring(0, 8000) + "\n\n[Content truncated due to size]"
                                : content;
                            prompts.push(`[File: ${fileName}]\n${truncated}`);
                        }
                    }
                } catch {
                    // Skip files that can't be read
                }
            }
        }

        const currentInput = inputBox.value?.trim() || "";
        if (currentInput) {
            prompts.push(DEFAULT_PROMPT.user.replace("{{USER_CURRENT_INPUT}}", currentInput));
        }

        const truncatedDiff =
            gitDiff.length > 5000 ? gitDiff.substring(0, 5000) + "\n\n[Diff truncated due to size]" : gitDiff;
        prompts.push(truncatedDiff);
        const prompt = prompts.join("\n\n");

        // Use model from config or default
        const commitModelId = config.get<string>("multiLLM.commitModel", "");
        // Resolve model config through provider system
        const selectedModel: OpenCodeGoModelItem = commitModelId
            ? (getModelConfig(commitModelId) ?? { id: commitModelId, owned_by: "unknown" })
            : { id: "default", owned_by: "unknown" };

        if (!commitModelId || selectedModel.owned_by === "unknown") {
            throw new Error(l10n("No commit model configured. Set multiLLM.commitModel in settings."));
        }

        // Commit messages are simple tasks — disable thinking
        selectedModel.enable_thinking = false;
        selectedModel.reasoning_effort = "high";
        // Cap max_completion_tokens
        if (selectedModel.max_completion_tokens && selectedModel.max_completion_tokens > 8192) {
            selectedModel.max_completion_tokens = 8192;
        }
        modelId = selectedModel.id;
        logger.info("commit.start", { modelId });

        const { providerId } = parseCompositeModelId(commitModelId);
        const apiKey = await getCommitApiKey(secrets, providerId);
        if (!apiKey) {
            throw new Error(l10n("API key not found for commit generation. Please configure it in settings."));
        }

        const baseUrl = selectedModel.baseUrl;
        if (!baseUrl || !baseUrl.startsWith("http")) {
            throw new Error(l10n("Invalid base URL configuration."));
        }

        // Apply language instruction
        const commitLanguage = config.get<string>("multiLLM.commitLanguage", "auto");
        if (commitLanguage !== "auto") {
            systemPrompt += ` Generate commit message in ${commitLanguage}.`;
        }

        const messages = [{ role: "user", content: prompt }];

        const apiMode = selectedModel.apiMode || "openai";

        const apiInstance = apiMode === "anthropic"
            ? new AnthropicApi(modelId)
            : new OpenaiApi(modelId);

        commitGenerationAbortController = new AbortController();
        const stream = apiInstance.createMessage(selectedModel, systemPrompt, messages, baseUrl, apiKey, commitGenerationAbortController.signal);

        let response = "";
        for await (const chunk of stream) {
            commitGenerationAbortController.signal.throwIfAborted();
            if (chunk.type === "text") {
                response += chunk.text;
                inputBox.value = extractCommitMessage(response);
            }
        }

        inputBox.value = removeThinkTags(inputBox.value);

        if (!inputBox.value) {
            throw new Error(l10n("empty API response"));
        }

        logger.info("commit.end", { modelId, durationMs: Date.now() - startTime });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("commit.error", { modelId: modelId ?? "unknown", error: errorMessage });
        vscode.window.showErrorMessage(`${l10n("Failed to generate commit message:")} ${errorMessage}`);
    } finally {
        vscode.commands.executeCommand("setContext", "multiLLM.isGeneratingCommit", false);
    }
}

export function abortCommitGeneration() {
    commitGenerationAbortController?.abort();
    vscode.commands.executeCommand("setContext", "multiLLM.isGeneratingCommit", false);
}

function extractCommitMessage(str: string): string {
    return str
        .trim()
        .replace(/^```[^\n]*\n?|```$/g, "")
        .trim();
}

function removeThinkTags(text: string): string {
    const regex = /<think>.*?<\/think>/gs;
    return text.replace(regex, "").trim();
}
