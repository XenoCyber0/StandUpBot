/**
 * Typed errors so callers can distinguish configuration problems from
 * transient LLM failures.
 */

export class StandupbotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Missing/invalid configuration (env vars, config file, etc). */
export class ConfigError extends StandupbotError {}

/** The LLM call failed (after retries, or non-retryable). */
export class LLMError extends StandupbotError {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
  }
}

/** The LLM responded but its output couldn't be parsed into our shape. */
export class ParseError extends StandupbotError {}
