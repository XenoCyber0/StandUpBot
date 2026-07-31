import { ConfigError, LLMError } from './errors';
import type { LLMClientOptions, LLMConfigShape, LLMSettings } from './types';

/**
 * OpenAI-compatible wire shape used by the default client. All supported
 * providers/gateways (OpenAI, OpenRouter, omniroute, freellmapi, Ollama, LM
 * Studio, …) accept POST {baseUrl}/chat/completions with Bearer auth.
 */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
  error?: { message?: string; type?: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Default number of attempts for transient failures. */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
/** Statuses we consider transient and worth retrying. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** The only provider wire-format implemented today. */
const OPENAI_COMPATIBLE = 'openai-compatible';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter, capped at 8s. */
function backoffMs(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return Math.floor(Math.random() * base);
}

/** Strip trailing slashes so we can safely append "/chat/completions". */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
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
export class LLMClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: LLMClientOptions) {
    if (!options.baseUrl) throw new ConfigError('LLM baseUrl is required');
    if (!options.apiKey) throw new ConfigError('LLM apiKey is required');
    if (!options.model) throw new ConfigError('LLM model is required');

    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

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
  static fromConfig(cfg: LLMConfigShape = {}, env: NodeJS.ProcessEnv = process.env): LLMClient {
    const merged: LLMSettings = {
      baseUrl: env.LLM_BASE_URL ?? cfg.llm?.baseUrl,
      apiKey: env.LLM_API_KEY ?? cfg.llm?.apiKey,
      model: env.LLM_MODEL ?? cfg.llm?.model,
      providerType: env.LLM_PROVIDER_TYPE ?? cfg.llm?.providerType,
    };

    const providerType = merged.providerType ?? OPENAI_COMPATIBLE;
    if (providerType !== OPENAI_COMPATIBLE) {
      throw new ConfigError(
        `Unsupported LLM provider type "${providerType}". ` +
          `Only "${OPENAI_COMPATIBLE}" is currently implemented.`,
      );
    }

    const missing: string[] = [];
    if (!merged.baseUrl) missing.push('base URL (LLM_BASE_URL or llm.baseUrl in .standupbot.yml)');
    if (!merged.apiKey) missing.push('API key (LLM_API_KEY)');
    if (!merged.model) missing.push('model (LLM_MODEL or llm.model in .standupbot.yml)');
    if (missing.length) {
      throw new ConfigError(
        `Missing LLM configuration: ${missing.join('; ')}. ` +
          `Set it via environment variables (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL) ` +
          `or an llm: block in .standupbot.yml (apiKey must stay in env).`,
      );
    }

    return new LLMClient({
      baseUrl: merged.baseUrl as string,
      apiKey: merged.apiKey as string,
      model: merged.model as string,
    });
  }

  /** A redacted, non-secret description of the connection, for logging. */
  describeConfig(): { providerType: string; baseUrl: string; model: string; apiKey: string } {
    const key = this.apiKey;
    const masked = key.length <= 4 ? '****' : `****${key.slice(-4)}`;
    return {
      providerType: OPENAI_COMPATIBLE,
      baseUrl: this.baseUrl,
      model: this.model,
      apiKey: masked,
    };
  }

  /** Send a chat completion and return the assistant's text content. */
  async chat(messages: ChatMessage[]): Promise<string> {
    const body = {
      model: this.model,
      messages,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    };

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this.request(body);
      } catch (err) {
        const llmErr = toLLMError(err);
        lastError = llmErr;
        const retryable =
          llmErr.statusCode === undefined || RETRYABLE_STATUSES.has(llmErr.statusCode);
        if (!retryable || attempt === this.maxRetries - 1) {
          throw llmErr;
        }
        await sleep(backoffMs(attempt));
      }
    }
    throw lastError ?? new LLMError('LLM request failed for an unknown reason');
  }

  private async request(body: unknown): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LLMError(`LLM request timed out after ${this.timeoutMs}ms`);
      }
      // Network-level failure: no status code => retryable.
      throw toLLMError(err);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: ChatCompletionResponse | undefined;
    try {
      parsed = text ? (JSON.parse(text) as ChatCompletionResponse) : undefined;
    } catch {
      // Non-JSON body; fall through and handle below.
    }

    if (!res.ok) {
      const msg =
        parsed?.error?.message ?? text?.slice(0, 300) ?? `HTTP ${res.status} from the LLM endpoint`;
      throw new LLMError(`LLM request failed: ${msg}`, res.status);
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new LLMError('LLM returned an empty or malformed response', res.status);
    }
    return content;
  }
}

function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new LLMError(message);
}
