import { interpretUpstreamJson, type UpstreamJson } from "../utils/upstreamResponse";

/** Reads a fetch `Response` as JSON, mapping HTML/non-JSON bodies to a readable error. */
export async function readUpstreamJson<T>(service: string, response: Response): Promise<UpstreamJson<T>> {
  const text = await response.text();
  return interpretUpstreamJson<T>(service, {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    text,
  });
}

/** Like {@link readUpstreamJson} but throws on any failure. */
export async function requireUpstreamJson<T>(service: string, response: Response): Promise<T> {
  const result = await readUpstreamJson<T>(service, response);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
