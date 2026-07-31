/**
 * Typed errors so callers can distinguish configuration problems from
 * transient LLM failures.
 */
export declare class StandupbotError extends Error {
    constructor(message: string);
}
/** Missing/invalid configuration (env vars, config file, etc). */
export declare class ConfigError extends StandupbotError {
}
/** The LLM call failed (after retries, or non-retryable). */
export declare class LLMError extends StandupbotError {
    readonly statusCode?: number | undefined;
    constructor(message: string, statusCode?: number | undefined);
}
/** The LLM responded but its output couldn't be parsed into our shape. */
export declare class ParseError extends StandupbotError {
}
