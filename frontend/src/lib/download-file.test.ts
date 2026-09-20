import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./download-file";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("downloadFile", () => {
  it("keeps the object URL alive until the browser starts the download", () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-file");
    const click = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ click, remove })),
      body: { appendChild: vi.fn((node) => node) },
    });
    vi.stubGlobal("window", { setTimeout });

    downloadFile(new Blob(["file"]), "source.txt");

    expect(click).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(remove).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:test-file");
  });
});
