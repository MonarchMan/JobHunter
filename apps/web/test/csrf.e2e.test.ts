import { describe, expect, it } from 'vitest';
import { issueCsrfResponse, verifyMutationRequest } from '../src/server/csrf.js';

describe('Web mutation protection', () => {
  it('requires matching SameSite token and loopback Origin', async () => {
    const issued = issueCsrfResponse();
    const body = (await issued.json()) as { readonly data: { readonly token: string } };
    const cookie = issued.headers.get('set-cookie');
    expect(cookie?.toLowerCase()).toContain('samesite=strict');
    expect(
      verifyMutationRequest(
        new Request('http://127.0.0.1:3210/api/profile', {
          method: 'PATCH',
          headers: {
            origin: 'http://localhost:3210',
            cookie: cookie ?? '',
            'x-jobhunter-csrf': body.data.token,
          },
        }),
      ),
    ).toBe(true);
    expect(
      verifyMutationRequest(
        new Request('http://127.0.0.1:3210/api/profile', {
          method: 'PATCH',
          headers: {
            origin: 'https://attacker.example',
            cookie: cookie ?? '',
            'x-jobhunter-csrf': body.data.token,
          },
        }),
      ),
    ).toBe(false);
  });
});
