export const BASE = "/api";

export type Meta = { total: number; page_size: number; page_number: number };
type Envelope<T> = { success: boolean; data: T; error: string | null; meta?: Meta };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (e) {
    throw new ApiError((e as Error).message || "network error", 0);
  }
  const rawText = await res.text().catch(() => "");
  // 204 No Content (e.g. DELETE) returns an empty body with no envelope.
  if (rawText === "" && res.ok) {
    return { success: true, data: null as T, error: null };
  }
  let body: Envelope<T>;
  try {
    body = JSON.parse(rawText) as Envelope<T>;
  } catch {
    throw new ApiError(
      rawText || `request failed (${res.status})`,
      res.status,
    );
  }
  if (!res.ok || !body.success) {
    throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  }
  return body;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request<T>(path, init)).data;
}

export async function apiList<T>(
  path: string,
  params?: Record<string, unknown>,
): Promise<{ results: T[]; meta: Meta }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const suffix = qs.toString() ? `?${qs}` : "";
  const body = await request<T[]>(`${path}${suffix}`);
  return { results: body.data, meta: body.meta ?? { total: body.data.length, page_size: 50, page_number: 1 } };
}

export const apiPost = <T>(path: string, json: unknown) =>
  apiFetch<T>(path, { method: "POST", body: JSON.stringify(json) });
export const apiPatch = <T>(path: string, json: unknown) =>
  apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(json) });
export const apiPut = <T>(path: string, json: unknown) =>
  apiFetch<T>(path, { method: "PUT", body: JSON.stringify(json) });
export const apiDelete = <T = void>(path: string) => apiFetch<T>(path, { method: "DELETE" });

// No content-type header: the browser sets the multipart boundary itself.
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
  const raw = await res.text().catch(() => "");
  let body: { success: boolean; data: T; error: string | null };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError(raw || `upload failed (${res.status})`, res.status);
  }
  if (!res.ok || !body.success) {
    throw new ApiError(body.error ?? `upload failed (${res.status})`, res.status);
  }
  return body.data;
}
