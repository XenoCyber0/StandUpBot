import type { LLMClient } from './llm';
import type { GenerateContext, PRDescription, StandupbotConfig } from './types';
/** Parse + validate raw LLM text into a typed PRDescription. */
export declare function parseModelOutput(raw: string): PRDescription;
export interface GenerateOptions {
    config?: StandupbotConfig;
}
/**
 * Generate a PR description from a unified diff.
 */
export declare function generatePRDescription(diff: string, context: GenerateContext, llm: LLMClient, options?: GenerateOptions): Promise<PRDescription>;
