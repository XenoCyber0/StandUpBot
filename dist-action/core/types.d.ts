/**
 * Shared types for StandupBot.
 */
/** Context about the change, used to ground the LLM prompt. */
export interface GenerateContext {
    /** "owner/repo" or a bare repo name. */
    repo: string;
    /** The source/head branch of the pull request. */
    branch: string;
    /** Human-readable commit subjects included in the change. */
    commits: string[];
}
/** The structured result produced by the LLM. */
export interface PRDescription {
    title: string;
    /** Markdown body with Summary / Changes / Testing sections. */
    description: string;
    /** Suggested labels, constrained to the known taxonomy. */
    labels: string[];
}
/**
 * Provider-agnostic connection settings for the LLM backend.
 * `apiKey` is optional here because it may be supplied separately (e.g. an
 * env var) and is never allowed in committed config files.
 */
export interface LLMSettings {
    /**
     * Base URL of an OpenAI-compatible endpoint, e.g.
     * https://api.openai.com/v1, https://openrouter.ai/api/v1, your omniroute /
     * freellmapi gateway, Ollama (http://localhost:11434/v1), LM Studio, etc.
     */
    baseUrl?: string;
    /** API key / bearer token. Never read from committed config. */
    apiKey?: string;
    /** Model identifier understood by the provider. No default. */
    model?: string;
    /**
     * Wire schema of the endpoint. Only "openai-compatible" is implemented;
     * reserved for future providers (e.g. Anthropic-shaped).
     */
    providerType?: string;
}
/** Configuration loaded from `.standupbot.yml` (all fields optional). */
export interface StandupbotConfig {
    /** Tone steering, e.g. "concise" | "detailed" | "playful". */
    tone?: string;
    /**
     * Diff budget in approximate LLM tokens. Diffs larger than this are
     * chunked hierarchically and summarised rather than blindly truncated.
     */
    maxDiffTokens?: number;
    /** gitignore-style globs for files to exclude from the prompt. */
    exclude?: string[];
    /** Provider-agnostic LLM connection settings (never the API key). */
    llm?: LLMSettings;
}
/** The shape that can come from config and/or env vars (type + settings). */
export interface LLMConfigShape {
    llm?: LLMSettings;
}
/** Options for the LLM client (usually sourced from config + env vars). */
export interface LLMClientOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** Max attempts for transient (network / 429 / 5xx) failures. Default 3. */
    maxRetries?: number;
    /** Per-request timeout in ms. Default 60000. */
    timeoutMs?: number;
}
export declare const DEFAULT_MAX_DIFF_TOKENS = 6000;
/** Curated set of labels the model is allowed to suggest. */
export declare const ALLOWED_LABELS: readonly ["bug", "feature", "chore", "docs", "refactor"];
export type AllowedLabel = (typeof ALLOWED_LABELS)[number];
