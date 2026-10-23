import { describe, expect, it } from "vitest";
import { isPrivateAddress, parseIPv4, parseIPv6 } from "./ip";

const host = (u: string) => new URL(u).hostname.replace(/^\[|\]$/g, "");

describe("parseIPv6", () => {
  it("expands :: and embedded IPv4", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6("0:0:0:0:0:ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6("[fe80::1%eth0]")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("2001:db8::8:800:200c:417a")).toEqual([0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a]);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["1::2::3", "12345::", "1:2:3:4:5:6:7:8:9", "1:2:3", "::ffff:999.0.0.1", "g::1", "localhost"]) expect(parseIPv6(bad)).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("sees through IPv4-mapped and IPv4-compatible spellings", () => {
    // The WHATWG parser rewrites [::ffff:127.0.0.1] to ::ffff:7f00:1, which used to pass as public.
    expect(host("http://[::ffff:127.0.0.1]:9001/")).toBe("::ffff:7f00:1");
    for (const ip of ["::ffff:7f00:1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "::ffff:169.254.170.2", "::ffff:a00:1", "0:0:0:0:0:ffff:127.0.0.1", "::7f00:1", "::127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("blocks private, special and translation ranges", () => {
    const blocked = [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
      "198.18.0.1", "192.0.2.1", "::1", "::", "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1",
      "64:ff9b::7f00:1", "64:ff9b:1::1", "2002:7f00:1::1", "2001::1", "2001:db8::1", "100::1", "not-an-ip",
    ];
    for (const ip of blocked) expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "::ffff:8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("parses only dotted-quad IPv4", () => {
    expect(parseIPv4("1.2.3.4")).toEqual([1, 2, 3, 4]);
    expect(parseIPv4("1.2.3.256")).toBeNull();
    expect(parseIPv4("1.2.3")).toBeNull();
  });
});
