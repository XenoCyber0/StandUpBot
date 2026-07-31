import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../src/core/config';
import { ConfigError } from '../src/core/errors';
import { LLMClient } from '../src/core/llm';

let dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'sbot-'));
  dirs.push(d);
  return d;
}

const LLM_ENV = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_PROVIDER_TYPE'];
let saved: Record<string, string | undefined> = {};

function clearLlmEnv(): void {
  for (const k of LLM_ENV) delete process.env[k];
}

afterEach(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  dirs = [];
  for (const k of LLM_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  saved = {};
});

describe('loadConfig', () => {
  it('returns defaults (no llm block) when no config file exists', async () => {
    const cfg = await loadConfig(tmp());
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('reads tone, maxDiffTokens and exclude from .standupbot.yml', async () => {
    const d = tmp();
    writeFileSync(
      path.join(d, '.standupbot.yml'),
      'tone: playful\nmaxDiffTokens: 1234\nexclude:\n  - "**/*.lock"\n  - "**/dist/**"\n',
    );
    const cfg = await loadConfig(d);
    expect(cfg.tone).toBe('playful');
    expect(cfg.maxDiffTokens).toBe(1234);
    expect(cfg.exclude).toEqual(['**/*.lock', '**/dist/**']);
    expect(cfg.llm).toBeUndefined();
  });

  it('falls back to defaults for invalid fields', async () => {
    const d = tmp();
    writeFileSync(path.join(d, '.standupbot.yml'), 'tone:\nmaxDiffTokens: not-a-number\n');
    const cfg = await loadConfig(d);
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it('reads an llm block (baseUrl/model/providerType), leaving model user-set', async () => {
    const d = tmp();
    writeFileSync(
      path.join(d, '.standupbot.yml'),
      'llm:\n  baseUrl: https://openrouter.ai/api/v1\n  model: anthropic/claude-3.5-sonnet\n',
    );
    const cfg = await loadConfig(d);
    expect(cfg.llm?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(cfg.llm?.model).toBe('anthropic/claude-3.5-sonnet');
  });

  it('throws if .standupbot.yml tries to set an apiKey', async () => {
    const d = tmp();
    writeFileSync(path.join(d, '.standupbot.yml'), 'llm:\n  apiKey: sk-secret\n');
    await expect(loadConfig(d)).rejects.toThrow(ConfigError);
  });
});

describe('LLM resolution (config -> client)', () => {
  it('uses values from .standupbot.yml when env is absent', async () => {
    clearLlmEnv();
    const d = tmp();
    writeFileSync(
      path.join(d, '.standupbot.yml'),
      'llm:\n  baseUrl: https://openrouter.ai/api/v1\n  model: some-model\n',
    );
    const cfg = await loadConfig(d);
    const client = LLMClient.fromConfig(
      { llm: { ...cfg.llm, apiKey: 'sk-env' } },
      { LLM_API_KEY: 'sk-env' },
    );
    expect(client.describeConfig().baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(client.describeConfig().model).toBe('some-model');
  });

  it('LLM_* env vars override .standupbot.yml values', async () => {
    clearLlmEnv();
    const d = tmp();
    writeFileSync(
      path.join(d, '.standupbot.yml'),
      'llm:\n  baseUrl: https://from-config\n  model: from-config-model\n',
    );
    const cfg = await loadConfig(d);
    const client = LLMClient.fromConfig(cfg, {
      LLM_BASE_URL: 'https://from-env',
      LLM_MODEL: 'env-model',
      LLM_API_KEY: 'sk-env',
    });
    expect(client.describeConfig().baseUrl).toBe('https://from-env');
    expect(client.describeConfig().model).toBe('env-model');
  });
});
