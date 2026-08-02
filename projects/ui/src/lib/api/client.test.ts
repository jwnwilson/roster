import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiDelete, apiFetch, apiList } from "./client";

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("apiFetch", () => {
  it("unwraps the envelope data on success", async () => {
    vi.stubGlobal("fetch", mockFetch({ success: true, data: { id: "p1" }, error: null }));
    await expect(apiFetch("/projects/p1")).resolves.toEqual({ id: "p1" });
  });

  it("throws ApiError with the message on success:false", async () => {
    vi.stubGlobal("fetch", mockFetch({ success: false, data: null, error: "not found" }, false, 404));
    await expect(apiFetch("/projects/x")).rejects.toMatchObject({ message: "not found", status: 404 });
    await expect(apiFetch("/projects/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError when the response body is not valid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("Bad Gateway"),
    } as unknown as Response));
    await expect(apiFetch("/projects/x")).rejects.toMatchObject({
      message: "Bad Gateway",
      status: 502,
    });
    await expect(apiFetch("/projects/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("resolves with null on a 204 No Content (empty body) response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
    } as unknown as Response));
    await expect(apiDelete("/work-items/w1")).resolves.toBeNull();
  });

  it("throws ApiError on an empty body with a failing status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(""),
    } as unknown as Response));
    await expect(apiDelete("/work-items/w1")).rejects.toMatchObject({ status: 500 });
  });

  it("apiList returns results + meta", async () => {
    vi.stubGlobal("fetch", mockFetch({ success: true, data: [{ id: "a" }], error: null, meta: { total: 1, page_size: 50, page_number: 1 } }));
    const page = await apiList("/projects");
    expect(page.results).toHaveLength(1);
    expect(page.meta.total).toBe(1);
  });
});
