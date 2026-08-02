import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocalStorage } from "./useLocalStorage";

describe("useLocalStorage", () => {
  beforeEach(() => localStorage.clear());
  it("returns the initial value then persists updates", () => {
    const { result } = renderHook(() => useLocalStorage("k", false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(JSON.parse(localStorage.getItem("k")!)).toBe(true);
  });
});
