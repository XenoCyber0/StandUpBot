import type { GenerateContext, StandupbotConfig } from './types';
export interface ChatMessageInput {
    role: 'system' | 'user';
    content: string;
}
export declare const SYSTEM_PROMPT: string;
/** Render the commit list block (or an empty string when there are none). */
export declare function formatCommits(commits: string[]): string;
/** One-line context header describing where this change lives. */
export declare function formatContext(context: GenerateContext): string;
/**
 * Build the user prompt. Pure & exported for testing.
 *
 * @param diffPayload  The (possibly summarised) diff body.
 * @param context      Repo/branch/commits grounding.
 * @param config       Tone + label steering.
 * @param truncated    True when the payload was reduced; tells the model to
 *                     rely on stat lines for collapsed files.
 */
export declare function buildUserPrompt(diffPayload: string, context: GenerateContext, config?: StandupbotConfig, truncated?: boolean): string;
/** Assemble the full message list for the chat completion. */
export declare function buildMessages(diffPayload: string, context: GenerateContext, config?: StandupbotConfig, truncated?: boolean): ChatMessageInput[];
