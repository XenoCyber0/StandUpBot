import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generatePRDescription, parseModelOutput } from '../src/core/generate';
import { ParseError } from '../src/core/errors';
import type { LLMClient } from '../src/core/llm';

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const context = { repo: 'acme/widgets', branch: 'feat/x', commits: ['do the thing'] };

/** A mock LLM that just returns the provided JSON text. */
function mockLLM(response: string): LLMClient {
  return {
    chat: async () => response,
  } as unknown as LLMClient;
}

describe('parseModelOutput', () => {
  it('parses a clean JSON object', () => {
    const out = parseModelOutput(
      '{"title":"Add greet module","description":"## Summary\\nx\\n## Changes\\n- a\\n## Testing\\n- t","labels":["feature"]}',
    );
    expect(out.title).toBe('Add greet module');
    expect(out.labels).toEqual(['feature']);
    expect(out.description).toContain('## Summary');
  });

  it('extracts JSON wrapped in prose / code fences', () => {
    const out = parseModelOutput(
      'Sure! Here you go:\n```json\n{"title":"T","description":"D","labels":["docs","no-such-label","bug"]}\n```',
    );
    expect(out.title).toBe('T');
    // invalid label filtered, order preserved
    expect(out.labels).toEqual(['docs', 'bug']);
  });

  it('limits labels to 3 and lowercases them', () => {
    const out = parseModelOutput(
      '{"title":"T","description":"D","labels":["FEATURE","Bug","DOCS","chore"]}',
    );
    expect(out.labels).toEqual(['feature', 'bug', 'docs']);
  });

  it('clamps long titles to 72 chars and strips trailing periods', () => {
    const long = 'A'.repeat(80) + '.';
    const out = parseModelOutput(`{"title":"${long}","description":"D","labels":[]}`);
    expect(out.title.length).toBeLessThanOrEqual(72);
    expect(out.title.endsWith('.')).toBe(false);
  });

  it('throws ParseError when no JSON object present', () => {
    expect(() => parseModelOutput('not json at all')).toThrow(ParseError);
  });
});

describe('generatePRDescription', () => {
  it('calls the LLM once and returns the parsed result', async () => {
    const llm = mockLLM(
      '{"title":"Add greet","description":"## Summary\\nAdds greet.\\n## Changes\\n- new file\\n## Testing\\n- manual","labels":["feature"]}',
    );
    let calls = 0;
    const spy = {
      chat: async (msgs: unknown) => {
        calls++;
        expect(JSON.stringify(msgs)).toContain('## Summary');
        return llm.chat(msgs as never);
      },
    } as unknown as LLMClient;

    const out = await generatePRDescription(fixture('sample.diff'), context, spy);
    expect(calls).toBe(1);
    expect(out.title).toBe('Add greet');
    expect(out.labels).toEqual(['feature']);
  });

  it('routes through summarisation when the diff exceeds the token budget', async () => {
    // tonne of diff content -> forces the map-reduce path.
    const big = fixture('sample.diff').repeat(50);
    let calls = 0;
    const llm = {
      chat: async (msgs: Array<{ role: string; content: string }>) => {
        calls++;
        const user = msgs.find((m) => m.role === 'user')?.content ?? '';
        // Summaries are asked for chunks; final is asked for the PR JSON.
        if (user.startsWith('Summarise what changed')) {
          return 'summary of a chunk';
        }
        return '{"title":"Big change","description":"## Summary\\nbig\\n## Changes\\n- lots\\n## Testing\\n- t","labels":["refactor"]}';
      },
    } as unknown as LLMClient;

    const out = await generatePRDescription(big, context, llm, {
      config: { maxDiffTokens: 500 },
    });
    expect(out.title).toBe('Big change');
    // More than one call => it summarised chunks before generating.
    expect(calls).toBeGreaterThan(1);
  });
});
