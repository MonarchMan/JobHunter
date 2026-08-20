import { createRequire } from 'node:module';
import { cruise } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const configuration = require('../../.dependency-cruiser.cjs');

describe('dependency boundaries', () => {
  it('rejects an intentional domain to database import', async () => {
    const options = { ...configuration.options };
    delete options.exclude;
    delete options.includeOnly;

    const result = await cruise(
      ['packages/domain/test/fixtures/forbidden-import.ts'],
      {
        ...options,
        outputType: 'err-long',
        ruleSet: { forbidden: configuration.forbidden },
        validate: true,
      },
      undefined,
      undefined,
    );

    expect(result.exitCode).not.toBe(0);
    expect(JSON.stringify(result.output)).toContain('domain-is-pure');
  });
});
