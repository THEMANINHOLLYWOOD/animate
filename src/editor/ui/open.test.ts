import { afterEach, describe, expect, it, vi } from "vitest";
import { forkOf, rememberFork, showFilmUrl } from "./open";

describe("examples made your own", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens an example this page forked as its fork", () => {
    expect(forkOf("ex-a")).toBe("ex-a");
    rememberFork("ex-a", "mine-1");
    expect(forkOf("ex-a")).toBe("mine-1");
    expect(forkOf("ex-b")).toBe("ex-b");
  });

  it("points the address at the fork only while it still names the example", () => {
    const replaceState = vi.fn();
    const location = { pathname: "/editor/ex-a", search: "", hash: "" };
    vi.stubGlobal("window", { location, history: { replaceState } });
    showFilmUrl("ex-a", "mine 1");
    // Null state (Next's router keeps its own and follows the URL).
    expect(replaceState).toHaveBeenCalledWith(null, "", "/editor/mine%201");
    // Left for the Studio meanwhile: its address stays.
    location.pathname = "/";
    showFilmUrl("ex-a", "mine 1");
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
