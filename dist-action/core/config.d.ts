import type { StandupbotConfig } from './types';
/**
 * Settings as they appear in `.standupbot.yml`, before env-var overlay. `llm`
 * stays optional (never defaulted) — its fields are only present when the user
 * set them in the file.
 */
type FileConfig = Omit<StandupbotConfig, 'tone' | 'maxDiffTokens' | 'exclude' | 'llm'> & {
    tone: string;
    maxDiffTokens: number;
    exclude: string[];
    llm?: StandupbotConfig['llm'];
};
/** Defaults for the generation-related (non-provider) fields. */
export declare const DEFAULT_CONFIG: FileConfig;
/**
 * Load `.standupbot.yml` from `cwd` (if present) and merge over defaults. The
 * `llm` block is passed through as-authored (absent if not set). Callers then
 * use `resolveLLMConfig` to overlay env vars and obtain full settings.
 */
export declare function loadConfig(cwd?: string): Promise<FileConfig>;
export {};
