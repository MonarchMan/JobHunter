import { randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server.js';

const cookieName = 'jobhunter_csrf';

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) return decodeURIComponent(value.join('='));
  }
  return null;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Mutations require a loopback Origin and a SameSite double-submit token. */
export function verifyMutationRequest(request: Request): boolean {
  const originHeader = request.headers.get('origin');
  if (!originHeader) return false;
  let origin: URL;
  let target: URL;
  try {
    origin = new URL(originHeader);
    target = new URL(request.url);
  } catch {
    return false;
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.protocol !== target.protocol ||
    !isLoopback(origin.hostname) ||
    !isLoopback(target.hostname) ||
    origin.port !== target.port
  ) {
    return false;
  }
  const cookie = cookieValue(request);
  const header = request.headers.get('x-jobhunter-csrf');
  if (!cookie || !header) return false;
  if (cookie.length !== header.length) return false;
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
}

export function issueCsrfResponse(): NextResponse {
  const token = randomBytes(32).toString('base64url');
  const response = NextResponse.json({ data: { token } });
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: false,
  });
  return response;
}
