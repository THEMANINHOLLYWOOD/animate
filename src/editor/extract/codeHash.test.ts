import { describe, expect, it } from "vitest";
import { codeHash, splitLive, unsplit } from "./codeHash";

describe("split state", () => {
  it("hashes code stably and tells edits apart", () => {
    const code = "lib.text(ctx, 'Every deploy.', 100, 100);";
    expect(codeHash(code)).toBe(codeHash(String(code)));
    expect(codeHash(code)).not.toBe(codeHash(code.replace("deploy", "release")));
  });

  it("only skips text while the code is the code it was split from", () => {
    const code = "lib.text(ctx, 'Hi', 0, 0);";
    const props = { code, skipText: true, keepText: [], splitHash: codeHash(code) };
    expect(splitLive(props)).toBe(true);
    expect(splitLive({ ...props, code: code + "\nlib.text(ctx, 'New', 0, 50);" })).toBe(false);
    // A split from before hashes were stored can't be trusted either.
    expect(splitLive({ code, skipText: true, keepText: [] })).toBe(false);
    expect(splitLive({ ...props, skipText: false })).toBe(false);
  });

  it("clears split state", () => {
    expect(unsplit({ code: "x", skipText: true, keepText: ["a"], splitHash: "h", textSplit: false, other: 1 })).toEqual({ code: "x", other: 1 });
  });
});
