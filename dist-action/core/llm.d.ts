import type { LLMClientOptions, LLMConfigShape } from './types';
interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
/**
 * Provider-agnostic LLM chat client. Bring-your-own-provider: the connection
 * (base URL / key / model) is fully user-configurable via env vars or
 * `.standupbot.yml`. Handles retries with exponential backoff, per-request
 * timeouts, and converts failures into typed `LLMError`s.
 *
 * The implementation today is OpenAI-compatible; `providerType` is reserved
 * for swapping in other wire formats (e.g. Anthropic) without touching
 * calling code.
 */
export declare class LLMClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly model;
    private readonly maxRetries;
    private readonly timeoutMs;
    constructor(options: LLMClientOptions);
    /**
     * Build a client from partial config + environment variables.
     *
     * Resolution precedence (highest first):
     *   1. `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_PROVIDER_TYPE`
     *   2. `cfg.llm.{baseUrl,apiKey,model,providerType}`   (from `.standupbot.yml`)
     *
     * Fails fast with a clear `ConfigError` if base URL, API key, or model are
     * missing after the merge — there is no implicit default provider or model.
     */
    static fromConfig(cfg?: LLMConfigShape, env?: NodeJS.ProcessEnv): LLMClient;
    /** A redacted, non-secret description of the connection, for logging. */
    describeConfig(): {
        providerType: string;
        baseUrl: string;
        model: string;
        apiKey: string;
    };
    /** Send a chat completion and return the assistant's text content. */
    chat(messages: ChatMessage[]): Promise<string>;
    private request;
}
export {};
