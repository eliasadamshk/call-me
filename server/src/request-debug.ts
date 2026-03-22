import type { IncomingMessage } from 'http';

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function getFirstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim() || undefined;
}

function getForwardedHeaderValues(req: IncomingMessage): { proto?: string; host?: string } {
  const forwarded = getHeaderValue(req.headers.forwarded);
  if (!forwarded) {
    return {};
  }

  const firstEntry = forwarded.split(',')[0]?.trim();
  if (!firstEntry) {
    return {};
  }

  const values: { proto?: string; host?: string } = {};
  for (const part of firstEntry.split(';')) {
    const [rawKey, rawValue] = part.split('=');
    if (!rawKey || !rawValue) {
      continue;
    }

    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim().replace(/^"|"$/g, '');
    if (key === 'proto') {
      values.proto = value;
    } else if (key === 'host') {
      values.host = value;
    }
  }

  return values;
}

export function getExternalRequestUrl(req: IncomingMessage, publicUrl: string): string {
  const requestTarget = req.url || '/';
  if (requestTarget.startsWith('http://') || requestTarget.startsWith('https://')) {
    return requestTarget;
  }

  const publicBase = new URL(publicUrl);
  const forwarded = getForwardedHeaderValues(req);
  const forwardedProto = getFirstForwardedValue(getHeaderValue(req.headers['x-forwarded-proto'])) || forwarded.proto;
  const forwardedHost = getFirstForwardedValue(getHeaderValue(req.headers['x-forwarded-host'])) || forwarded.host;
  const proto = forwardedProto || publicBase.protocol.slice(0, -1);
  const host = forwardedHost || getHeaderValue(req.headers.host) || publicBase.host;
  return `${proto}://${host}${requestTarget}`;
}

export function describeIncomingRequest(req: IncomingMessage, publicUrl?: string): Record<string, string | undefined> {
  const description: Record<string, string | undefined> = {
    method: req.method,
    url: req.url,
    host: getHeaderValue(req.headers.host),
    'x-forwarded-host': getHeaderValue(req.headers['x-forwarded-host']),
    'x-forwarded-proto': getHeaderValue(req.headers['x-forwarded-proto']),
    forwarded: getHeaderValue(req.headers.forwarded),
    'cf-visitor': getHeaderValue(req.headers['cf-visitor']),
    'cf-ray': getHeaderValue(req.headers['cf-ray']),
    'content-type': getHeaderValue(req.headers['content-type']),
    'user-agent': getHeaderValue(req.headers['user-agent']),
  };

  if (publicUrl) {
    description.externalUrl = getExternalRequestUrl(req, publicUrl);
  }

  return description;
}
