import { SourceError } from './errors.js';

const REMOVED_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'jsessionid',
  'sessionid',
  'session_id',
  'sid',
  'spm',
]);

function normalizedHosts(allowedHosts: readonly string[]): ReadonlySet<string> {
  const hosts = allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (hosts.length === 0) {
    throw new SourceError('invalid_config', 'At least one official host must be configured.');
  }
  return new Set(hosts);
}

export function validateOfficialUrl(value: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new SourceError('parse_changed', 'Source returned an invalid URL.', { cause: error });
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new SourceError('parse_changed', 'Official job URLs must use unauthenticated HTTPS.');
  }
  if (!normalizedHosts(allowedHosts).has(url.hostname.toLowerCase())) {
    throw new SourceError('parse_changed', 'Source returned a URL outside official hosts.');
  }
  return url;
}

export function canonicalizeOfficialUrl(value: string, allowedHosts: readonly string[]): string {
  const url = validateOfficialUrl(value, allowedHosts);
  url.hash = '';
  url.pathname = url.pathname.replaceAll(/;jsessionid=[^/?#;]*/gi, '');
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('utm_') || REMOVED_QUERY_KEYS.has(normalized)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}
