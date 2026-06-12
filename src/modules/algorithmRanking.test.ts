import { describe, expect, it } from "vitest";
import { scoreAlgorithm } from "./algorithmRanking.js";

describe("scoreAlgorithm", () => {
  it("rewards hits and verification successes while penalizing bounces and misses", () => {
    expect(
      scoreAlgorithm({
        confidenceScore: 20,
        verificationSuccessCount: 2,
        hitCount: 1,
        missCount: 1,
        bounceCount: 1,
        rank: 3
      })
    ).toBe(20);
  });
});

