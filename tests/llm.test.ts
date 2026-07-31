import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/errors';
import { LLMClient } from '../src/core/llm';

const LLM_ENV = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_PROVIDER_TYPE'];
let saved: Record<string, string | undefined> = {};

function clearEnv(): void {
  for (const k of LLM_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
}
afterEach(() => {
  for (const k of LLM_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  saved = {};
});

describe('LLMClient.fromConfig (explicit env injection)', () => {
  it('resolves from env when config is empty', () => {
    const client = LLMClient.fromConfig(
      {},
      {
        LLM_BASE_URL: 'https://api.openai.com/v1',
        LLM_API_KEY: 'sk-test',
        LLM_MODEL: 'gpt-4o-mini',
      },
    );
    const c = client.describeConfig();
    expect(c.baseUrl).toBe('https://api.openai.com/v1');
    expect(c.model).toBe('gpt-4o-mini');
    expect(c.providerType).toBe('openai-compatible');
  });

  it('env vars take precedence over config values', () => {
    const client = LLMClient.fromConfig(
      { llm: { baseUrl: 'https://cfg', model: 'cfg-model', apiKey: 'cfg-key' } },
      { LLM_BASE_URL: 'https://env', LLM_MODEL: 'env-model', LLM_API_KEY: 'env-key' },
    );
    const c = client.describeConfig();
    expect(c.baseUrl).toBe('https://env');
    expect(c.model).toBe('env-model');
    expect(c.apiKey).toBe('****-key');
  });

  it('defaults providerType to openai-compatible and strips trailing slashes', () => {
    const client = LLMClient.fromConfig(
      { llm: { baseUrl: 'https://x.test/v1/', model: 'm' } },
      { LLM_API_KEY: 'k' },
    );
    expect(client.describeConfig().baseUrl).toBe('https://x.test/v1');
    expect(client.describeConfig().providerType).toBe('openai-compatible');
  });

  it('fails fast when baseUrl, apiKey, or model are missing', () => {
    expect(() => LLMClient.fromConfig({}, {})).toThrow(ConfigError);
    expect(() => LLMClient.fromConfig({ llm: { baseUrl: 'https://x', model: 'm' } }, {})).toThrow(
      /API key/,
    );
    expect(() =>
      LLMClient.fromConfig({ llm: { baseUrl: 'https://x' } }, { LLM_API_KEY: 'k' }),
    ).toThrow(/model/);
  });

  it('rejects an unsupported providerType', () => {
    expect(() =>
      LLMClient.fromConfig(
        { llm: { baseUrl: 'https://x', model: 'm', providerType: 'anthropic' } },
        { LLM_API_KEY: 'k' },
      ),
    ).toThrow(/Unsupported LLM provider type/);
  });
});

describe('LLMClient.fromConfig reads real LLM_* env vars', () => {
  it('process.env LLM_* are picked up when no explicit env is passed', () => {
    clearEnv();
    process.env.LLM_BASE_URL = 'https://api.openai.com/v1';
    process.env.LLM_API_KEY = 'sk-abc';
    process.env.LLM_MODEL = 'gpt-4o-mini';
    const client = LLMClient.fromConfig();
    expect(client.describeConfig().model).toBe('gpt-4o-mini');
  });
});

describe('describeConfig', () => {
  it('masks the API key (never leaks the secret)', () => {
    const client = LLMClient.fromConfig(
      { llm: { baseUrl: 'https://x', model: 'm' } },
      { LLM_API_KEY: 'supersecretkey1234' },
    );
    const c = client.describeConfig();
    expect(c.apiKey).not.toContain('supersecret');
    expect(c.apiKey).toMatch(/^\*{4}.{4}$/);
  });
});
