import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigError } from './errors';
import type { StandupbotConfig } from './types';
import { DEFAULT_MAX_DIFF_TOKENS } from './types';

const CONFIG_FILENAMES = ['.standupbot.yml', '.standupbot.yaml'];

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
export const DEFAULT_CONFIG: FileConfig = {
  tone: 'concise',
  maxDiffTokens: DEFAULT_MAX_DIFF_TOKENS,
  exclude: [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '**/*.lock',
    '**/*.min.js',
    '**/dist/**',
    '**/generated/**',
  ],
};

function findConfigFile(cwd: string): string | undefined {
  for (const name of CONFIG_FILENAMES) {
    const full = path.join(cwd, name);
    if (existsSync(full)) return full;
  }
  return undefined;
}

function coerceLlm(raw: unknown): NonNullable<StandupbotConfig['llm']> {
  if (raw === null || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const llm: NonNullable<StandupbotConfig['llm']> = {};
  if (typeof obj.baseUrl === 'string') llm.baseUrl = obj.baseUrl;
  if (typeof obj.model === 'string') llm.model = obj.model;
  if (typeof obj.providerType === 'string') llm.providerType = obj.providerType;
  return llm;
}

function coerceConfig(raw: unknown): StandupbotConfig {
  if (raw === null || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const cfg: StandupbotConfig = {};

  if (typeof obj.tone === 'string') cfg.tone = obj.tone;
  if (typeof obj.maxDiffTokens === 'number' && Number.isFinite(obj.maxDiffTokens)) {
    cfg.maxDiffTokens = obj.maxDiffTokens;
  }
  if (Array.isArray(obj.exclude)) {
    cfg.exclude = obj.exclude.filter((x): x is string => typeof x === 'string');
  }

  // Read `llm` (plus defensive capitalised variants) but never honour an
  // apiKey from a committed file.
  const rawLlm = (obj.llm ?? obj.LLM ?? (obj as { Llm?: unknown }).Llm) as
    Record<string, unknown> | undefined;
  if (rawLlm && typeof rawLlm === 'object') {
    if (rawLlm.apiKey !== undefined) {
      throw new ConfigError(
        '.standupbot.yml must not contain an llm.apiKey. ' +
          'Provide the key via the LLM_API_KEY environment variable instead.',
      );
    }
    cfg.llm = coerceLlm(rawLlm);
  }
  return cfg;
}

/**
 * Load `.standupbot.yml` from `cwd` (if present) and merge over defaults. The
 * `llm` block is passed through as-authored (absent if not set). Callers then
 * use `resolveLLMConfig` to overlay env vars and obtain full settings.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<FileConfig> {
  const file = findConfigFile(cwd);
  if (!file) return { ...DEFAULT_CONFIG };

  let parsed: unknown;
  try {
    const text = await readFile(file, 'utf8');
    parsed = parseYaml(text);
  } catch {
    // Unparseable config: warn-and-continue with defaults.
    return { ...DEFAULT_CONFIG };
  }

  const cfg = coerceConfig(parsed);
  return {
    tone: cfg.tone ?? DEFAULT_CONFIG.tone,
    maxDiffTokens: cfg.maxDiffTokens ?? DEFAULT_CONFIG.maxDiffTokens,
    exclude: cfg.exclude ?? DEFAULT_CONFIG.exclude,
    ...(cfg.llm ? { llm: cfg.llm } : {}),
  };
}
