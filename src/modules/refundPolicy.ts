export function refundPercentByPolicy(startAt: Date, now = new Date()) {
  const diffMs = startAt.getTime() - now.getTime();
  if (diffMs <= 0) return 0;

  const day = 24 * 60 * 60 * 1000;

  if (diffMs >= 10 * day) return 1.0;
  if (diffMs >= 7 * day) return 0.8;
  if (diffMs >= 5 * day) return 0.6;
  if (diffMs >= 3 * day) return 0.4;
  return 0.1;
}
