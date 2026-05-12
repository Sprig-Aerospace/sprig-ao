import { describe, expect, it } from "vitest";
import { buildBundleEvidenceSummary, buildSessionEvidenceSummary } from "../evidence-summary.js";

describe("buildSessionEvidenceSummary", () => {
  it("includes artifacts and validation rollups after the base summary", () => {
    expect(
      buildSessionEvidenceSummary({
        summary: "Implemented auth flow",
        artifacts: [{ label: "screenshot.png" }, { label: "trace.txt" }, { label: "diff.patch" }],
        validations: [{ status: "passed" }, { status: "failed" }, { status: "passed" }],
      }),
    ).toBe(
      "Implemented auth flow · Artifacts: screenshot.png, trace.txt +1 more · Validation: 1 failed, 2 passed",
    );
  });

  it("returns evidence-only summaries when no base summary exists", () => {
    expect(
      buildSessionEvidenceSummary({
        artifacts: [{ label: "playwright-report.html" }],
        validations: [{ status: "running" }],
      }),
    ).toBe("Artifacts: playwright-report.html · Validation: 1 running");
  });
});

describe("buildBundleEvidenceSummary", () => {
  it("shows repo-level rollups for small bundles", () => {
    expect(
      buildBundleEvidenceSummary([
        {
          repo: "api",
          artifacts: [{ label: "diff.patch" }, { label: "failing-test.log" }],
          validations: [{ status: "failed" }],
        },
        {
          repo: "web",
          artifacts: [{ label: "screenshot.png" }],
          validations: [{ status: "passed" }, { status: "passed" }],
        },
      ]),
    ).toBe("api: 2 artifacts, 1 failed · web: 1 artifact, 2 passed");
  });

  it("collapses larger bundles into aggregate totals", () => {
    expect(
      buildBundleEvidenceSummary([
        { repo: "api", artifacts: [{ label: "a" }], validations: [{ status: "passed" }] },
        { repo: "web", artifacts: [{ label: "b" }], validations: [{ status: "failed" }] },
        { repo: "docs", artifacts: [{ label: "c" }], validations: [{ status: "running" }] },
        { repo: "cli", validations: [{ status: "passed" }] },
      ]),
    ).toBe("4 repos · 3 artifacts · Validation: 1 failed, 1 running, 2 passed");
  });
});
