import { describe, expect, it } from "vitest";
import {
  checkPasskeyKitRelease,
  ensureTrackingIssue,
  fetchLatestVersion,
  parseVersion,
  ReleaseWatchError,
  satisfiesRange,
  trackingIssueTitle,
} from "./passkey-release-watch.mjs";

describe("parseVersion", () => {
  it("parses plain semver", () => {
    expect(parseVersion("0.19.1")).toEqual([0, 19, 1]);
  });

  it("rejects anything that is not exact x.y.z", () => {
    expect(() => parseVersion("^0.19.1")).toThrow(ReleaseWatchError);
    expect(() => parseVersion("1.0.0-rc.1")).toThrow(ReleaseWatchError);
  });
});

describe("satisfiesRange", () => {
  it.each([
    ["^0.19.1", "0.19.1", true],
    ["^0.19.1", "0.19.9", true],
    ["^0.19.1", "0.20.0", false],
    ["^0.19.1", "0.19.0", false],
    ["^1.2.3", "1.9.0", true],
    ["^1.2.3", "2.0.0", false],
    [">=0.13.0 <0.17.0", "0.16.5", true],
    [">=0.13.0 <0.17.0", "0.17.0", false],
    [">=0.13.0 <0.17.0", "0.12.9", false],
    ["~1.2.3", "1.2.9", true],
    ["~1.2.3", "1.3.0", false],
    ["1.2.3", "1.2.3", true],
    ["1.2.3", "1.2.4", false],
    ["^0.16.0 || ^0.19.0", "0.19.4", true],
    ["^0.16.0 || ^0.19.0", "0.18.0", false],
  ])("%s admits %s: %s", (range, version, expected) => {
    expect(satisfiesRange(range, version)).toBe(expected);
  });

  it("throws on a range it cannot read, instead of guessing", () => {
    expect(() => satisfiesRange("latest", "1.0.0")).toThrow(ReleaseWatchError);
  });
});

describe("checkPasskeyKitRelease", () => {
  const latest = (v: string) => async () => v;

  it("is quiet for a patch release inside the supported range", async () => {
    const r = await checkPasskeyKitRelease({ peerRange: "^0.19.1", fetchLatest: latest("0.19.7") });
    expect(r).toMatchObject({ status: "in-range", latest: "0.19.7" });
  });

  it("flags a new minor outside a 0.x caret range", async () => {
    const r = await checkPasskeyKitRelease({ peerRange: "^0.19.1", fetchLatest: latest("0.20.0") });
    expect(r).toMatchObject({ status: "out-of-range", kind: "minor", latest: "0.20.0" });
  });

  it("flags a new major outside the range", async () => {
    const r = await checkPasskeyKitRelease({ peerRange: "^0.19.1", fetchLatest: latest("1.0.0") });
    expect(r).toMatchObject({ status: "out-of-range", kind: "major" });
  });

  it("flags a release above a bounded range", async () => {
    const r = await checkPasskeyKitRelease({
      peerRange: ">=0.13.0 <0.17.0",
      fetchLatest: latest("0.19.1"),
    });
    expect(r).toMatchObject({ status: "out-of-range", kind: "minor", latest: "0.19.1" });
  });

  it("propagates a registry failure as ReleaseWatchError, never as in-range", async () => {
    await expect(
      checkPasskeyKitRelease({
        peerRange: "^0.19.1",
        fetchLatest: async () => {
          throw new ReleaseWatchError("registry down");
        },
      }),
    ).rejects.toThrow(/registry down/);
  });
});

describe("fetchLatestVersion", () => {
  it("reads the version from the registry response", async () => {
    const fetchJson = async (url: string) => {
      expect(url).toBe("https://registry.npmjs.org/passkey-kit/latest");
      return { version: "0.19.1" };
    };
    await expect(fetchLatestVersion(fetchJson)).resolves.toBe("0.19.1");
  });

  it("wraps transport errors and malformed payloads", async () => {
    await expect(
      fetchLatestVersion(async () => {
        throw new Error("HTTP 503");
      }),
    ).rejects.toThrow(ReleaseWatchError);
    await expect(fetchLatestVersion(async () => ({}))).rejects.toThrow(/version/);
  });
});

describe("ensureTrackingIssue", () => {
  function fakeGithub(open: { number: number; title: string }[] = []) {
    const calls: string[] = [];
    return {
      calls,
      github: {
        async listOpenIssues() {
          return open;
        },
        async createIssue(input: { title: string }) {
          calls.push(`create:${input.title}`);
          return { number: 99 };
        },
        async updateIssue(number: number, input: { title: string }) {
          calls.push(`update:${number}:${input.title}`);
        },
      },
    };
  }
  const base = { latest: "0.20.0", peerRange: "^0.19.1", kind: "minor" };

  it("creates an issue when none is open", async () => {
    const { github, calls } = fakeGithub();
    const r = await ensureTrackingIssue({ github, ...base });
    expect(r).toEqual({ action: "created", number: 99 });
    expect(calls).toEqual([`create:${trackingIssueTitle("0.20.0")}`]);
  });

  it("does nothing when an issue for the same release is already open", async () => {
    const { github, calls } = fakeGithub([{ number: 7, title: trackingIssueTitle("0.20.0") }]);
    const r = await ensureTrackingIssue({ github, ...base });
    expect(r).toEqual({ action: "unchanged", number: 7 });
    expect(calls).toEqual([]);
  });

  it("updates the open issue when a newer out-of-range release lands", async () => {
    const { github, calls } = fakeGithub([{ number: 7, title: trackingIssueTitle("0.20.0") }]);
    const r = await ensureTrackingIssue({ github, ...base, latest: "0.21.0" });
    expect(r).toEqual({ action: "updated", number: 7 });
    expect(calls).toEqual([`update:7:${trackingIssueTitle("0.21.0")}`]);
  });

  it("ignores unrelated open issues", async () => {
    const { github } = fakeGithub([{ number: 3, title: "something else" }]);
    expect((await ensureTrackingIssue({ github, ...base })).action).toBe("created");
  });
});
