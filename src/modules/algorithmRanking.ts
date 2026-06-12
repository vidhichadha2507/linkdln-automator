type AlgorithmStats = {
  confidenceScore: number;
  verificationSuccessCount: number;
  hitCount: number;
  missCount: number;
  bounceCount: number;
  rank: number;
};

export function scoreAlgorithm(stats: AlgorithmStats): number {
  return (
    stats.confidenceScore +
    stats.verificationSuccessCount * 5 +
    stats.hitCount * 10 -
    stats.missCount * 2 -
    stats.bounceCount * 15 -
    stats.rank
  );
}

