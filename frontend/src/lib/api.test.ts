import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE_URL, apiFetch, configureApiAuth, confirmSentDraft, getCases, getSession, prepareDraft, type CaseSummary } from "./api";
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

  it("follows case cursors until every page has loaded", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      const cursor = new URL(url).searchParams.get("cursor");
      return Response.json(cursor
        ? { items: [{ case_id: "case-2" }], next_cursor: null }
        : { items: [{ case_id: "case-1" }], next_cursor: "next-page" });
    }));

    const response = await getCases();

    expect(response.items.map((item) => item.case_id)).toEqual(["case-1", "case-2"]);
    expect(response.next_cursor).toBeNull();
    expect(urls).toEqual([
      `${API_BASE_URL}/api/cases?limit=200`,
      `${API_BASE_URL}/api/cases?limit=200&cursor=next-page`,
    ]);
  });

  it("calls prepareDraft endpoint with expected version", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return Response.json({ case_id: "case-100", draft: { state: "DRAFT", delivery_mode: "compose" } });
    }));

    const result = await prepareDraft("case-100", 2);
    expect(capturedUrl).toBe(`${API_BASE_URL}/api/cases/case-100/draft/prepare`);
    expect(JSON.parse(capturedBody)).toEqual({ expected_version: 2 });
    expect(result.draft?.delivery_mode).toBe("compose");
  });

  it("calls confirmSentDraft endpoint with expected version", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return Response.json({ case_id: "case-100", review_decision: "DECLINE", draft: { state: "SENT" } });
    }));

    const result = await confirmSentDraft("case-100", 3);
    expect(capturedUrl).toBe(`${API_BASE_URL}/api/cases/case-100/draft/confirm-sent`);
    expect(JSON.parse(capturedBody)).toEqual({ expected_version: 3 });
    expect(result.review_decision).toBe("DECLINE");
    expect(result.draft?.state).toBe("SENT");
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
