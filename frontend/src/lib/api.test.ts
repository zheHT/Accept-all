import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, configureApiAuth, getSession, type CaseSummary } from "./api";
import { statusLabel } from "./format";
import { shouldPoll } from "./use-live-query";

afterEach(() => {
  vi.unstubAllGlobals();
  configureApiAuth(async () => null, () => {});
});

describe("authenticated API client", () => {
  it("loads the signed-in user's role from the session endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ uid: "user-1", is_admin: false })));

    await expect(getSession()).resolves.toEqual({ uid: "user-1", is_admin: false });
  });

  it("adds the ID token and refreshes it once after a 401", async () => {
    const tokens: string[] = [];
    let refreshed = false;
    configureApiAuth(async (force) => {
      if (force) refreshed = true;
      return refreshed ? "fresh-token" : "old-token";
    }, () => {});
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      tokens.push(new Headers(init.headers).get("Authorization") || "");
      return tokens.length === 1
        ? new Response("expired", { status: 401 })
        : Response.json({ status: "ok" });
    }));

    await expect(apiFetch<{ status: string }>("/healthz")).resolves.toEqual({ status: "ok" });
    expect(tokens).toEqual(["Bearer old-token", "Bearer fresh-token"]);
  });
});

describe("live view behavior", () => {
  it("pauses polling while the document is hidden", () => {
    expect(shouldPoll("hidden")).toBe(false);
    expect(shouldPoll("visible")).toBe(true);
  });

  it("maps the canonical case state to reviewer copy", () => {
    const item = { status: "MISMATCH", processing_state: "TERMINAL" } as CaseSummary;
    expect(statusLabel(item)).toBe("Mismatch");
  });
});
