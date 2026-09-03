export interface UpstreamResponse {
  status: number;
  statusText?: string;
  contentType?: string | null;
  text: string;
}

export type UpstreamJson<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

export function looksLikeHtml(text: string, contentType?: string | null): boolean {
  if (contentType && /text\/html/i.test(contentType)) return true;
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(text);
}

function tryParseJson(text: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false };
  }
}

function describeStatus(response: UpstreamResponse): string {
  const statusText = response.statusText?.trim();
  return statusText ? `HTTP ${response.status} ${statusText}` : `HTTP ${response.status}`;
}

/**
 * Turns an upstream response body into JSON or a readable error.
 *
 * Gateways and edge servers answer outages with HTML pages instead of the JSON
 * an API normally returns; blindly calling `response.json()` on those surfaces
 * a `SyntaxError` ("Unexpected token '<' ...") to the user. Here a non-JSON
 * body is reported as "<service> returned HTTP 502 Bad Gateway" instead, while
 * JSON error bodies are passed through untouched so callers can still inspect
 * them.
 */
export function interpretUpstreamJson<T>(service: string, response: UpstreamResponse): UpstreamJson<T> {
  const { status, text } = response;
  const ok = status >= 200 && status < 300;
  const trimmed = text.trim();

  if (ok && !trimmed) return { ok: true, status, data: null as T };

  const json = trimmed ? tryParseJson(trimmed) : ({ parsed: false } as const);
  if (json.parsed) {
    return ok
      ? { ok: true, status, data: json.value as T }
      : { ok: false, status, error: trimmed };
  }

  const kind = looksLikeHtml(trimmed, response.contentType) ? "an HTML page" : "a non-JSON response";
  return { ok: false, status, error: `${service} returned ${describeStatus(response)} with ${kind} instead of JSON` };
}
