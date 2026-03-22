import { timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

export function loadApiAuthToken(): string | undefined {
  const token = process.env.CALLME_API_AUTH_TOKEN?.trim();
  return token || undefined;
}

function secureTokenEquals(expected: string, received: string | undefined): boolean {
  if (!received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function getAuthorizationHeaderValue(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  return Array.isArray(header) ? header[0] : header;
}

export function describeAuthorizationHeader(req: IncomingMessage, expectedToken?: string): Record<string, string | number | boolean | undefined> {
  const authorization = getAuthorizationHeaderValue(req);
  const [scheme, ...rest] = authorization?.trim().split(/\s+/) || [];
  const token = rest.length > 0 ? rest.join(' ') : undefined;

  return {
    authorizationPresent: authorization !== undefined,
    authorizationScheme: scheme || undefined,
    bearerTokenPresent: token !== undefined,
    receivedTokenLength: token?.length,
    expectedTokenLength: expectedToken?.length,
  };
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const authorization = getAuthorizationHeaderValue(req);
  if (!authorization) {
    return undefined;
  }

  const [scheme, ...rest] = authorization.trim().split(/\s+/);
  if (scheme.toLowerCase() !== 'bearer' || rest.length === 0) {
    return undefined;
  }

  return rest.join(' ');
}

export function isRequestAuthorized(req: IncomingMessage, apiAuthToken: string | undefined): boolean {
  if (!apiAuthToken) {
    return true;
  }

  const bearerToken = getBearerToken(req);
  return secureTokenEquals(apiAuthToken, bearerToken);
}

export function writeUnauthorizedResponse(res: ServerResponse): void {
  res.writeHead(401, {
    'Content-Type': 'text/plain',
    'WWW-Authenticate': 'Bearer',
  });
  res.end('Unauthorized');
}
