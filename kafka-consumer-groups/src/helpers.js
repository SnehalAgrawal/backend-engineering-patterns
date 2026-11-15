export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, { timeoutMs = 60_000, everyMs = 50 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(everyMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms`);
}

/** Wait until the consumers' assignments cover every partition exactly once and stay unchanged for stableMs. */
export async function waitForStableAssignment(
  consumers,
  partitionCount,
  { stableMs = 2000, timeoutMs = 60_000 } = {},
) {
  const snapshot = () =>
    consumers.map((c) =>
      c
        .assignment()
        .map((tp) => tp.partition)
        .sort((a, b) => a - b),
    );
  let last = '';
  let since = Date.now();
  return waitFor(
    () => {
      const now = snapshot();
      const key = JSON.stringify(now);
      if (key !== last) {
        last = key;
        since = Date.now();
      }
      const assigned = now.flat();
      const complete =
        assigned.length === partitionCount && new Set(assigned).size === partitionCount;
      return complete && Date.now() - since >= stableMs ? now : null;
    },
    { timeoutMs },
  );
}

export const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
