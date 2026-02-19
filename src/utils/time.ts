export function toKstDateTime(date: string, timeHHMM: string) {
  return new Date(`${date}T${timeHHMM}:00+09:00`);
}

export function startOfKstDay(date: string) {
  return new Date(`${date}T00:00:00+09:00`);
}

export function nextKstDay(date: string) {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setDate(d.getDate() + 1);
  return d;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

export function addMinutes(dt: Date, minutes: number) {
  return new Date(dt.getTime() + minutes * 60_000);
}
