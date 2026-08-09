import { HttpResponse } from "msw";

/** The API's envelope, so handlers and tests never hand-assemble it. */
export const ok = <T>(data: T) => HttpResponse.json({ success: true, data, error: null });

export const okList = <T>(items: T[]) =>
  HttpResponse.json({
    success: true,
    data: items,
    error: null,
    meta: { total: items.length, page_size: 50, page_number: 1 },
  });

export const created = <T>(data: T) =>
  HttpResponse.json({ success: true, data, error: null }, { status: 201 });

export const failure = (status: number, error: string) =>
  HttpResponse.json({ success: false, data: null, error }, { status });
