interface CsrfEnvelope {
  readonly data?: { readonly token?: string };
}

/** Fetches a short-lived-in-browser token immediately before a mutation. */
export async function mutationHeaders(json = true): Promise<Record<string, string>> {
  const response = await fetch('/api/csrf', { method: 'GET', cache: 'no-store' });
  const body = (await response.json()) as CsrfEnvelope;
  if (!response.ok || !body.data?.token) throw new Error('无法建立安全操作会话。');
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-jobhunter-csrf': body.data.token,
  };
}
