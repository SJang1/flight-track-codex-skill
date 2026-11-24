export function pacingMs(limits, cost = 1) {
  if (!Array.isArray(limits) || limits.length === 0 || !Number.isSafeInteger(cost) || cost < 1) {
    throw new RangeError("A positive quota and request cost are required.");
  }

  return limits.reduce((interval, { requests, windowMs }) => {
    if (!Number.isSafeInteger(requests) || requests < cost || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new RangeError("Quota windows must cover at least one request at the given cost.");
    }
    // A fraction of a request cannot fit in a window. Use the highest endpoint cost for shared quotas.
    const callsPerWindow = Math.floor(requests / cost);
    const intervalForWindow = Math.ceil(windowMs / callsPerWindow);
    return Math.max(interval, intervalForWindow);
  }, 0);
}

export function retryAfterMs(value, now) {
  if (typeof value !== "string") return null;
  const retryAfter = value.trim();
  if (/^\d+$/.test(retryAfter)) {
    const nextAt = now + Number(retryAfter) * 1_000;
    return Number.isSafeInteger(nextAt) ? nextAt : null;
  }

  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(retryAfter)) return null;
  const nextAt = Date.parse(retryAfter);
  return Number.isFinite(nextAt) ? nextAt : null;
}
