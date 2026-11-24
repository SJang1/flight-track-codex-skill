const DAY_MS = 86_400_000;
export const KOREA_TIME_ZONE = 'Asia/Seoul';
const koreanAirports = new Set([
  'ICN', 'GMP', 'PUS', 'CJU', 'TAE', 'USN', 'CJJ', 'MWX', 'KWJ', 'RSU', 'KPO', 'YNY', 'HIN', 'KUV', 'WJU',
  'RKSI', 'RKSS', 'RKPK', 'RKPC', 'RKTN', 'RKPU', 'RKTU', 'RKJB', 'RKJJ', 'RKJY', 'RKTH', 'RKNY', 'RKPS', 'RKJK', 'RKNW',
]);

export function airportTimeZone(input) {
  return input.timeZone ?? (koreanAirports.has(input.airport?.toUpperCase()) ? KOREA_TIME_ZONE : undefined);
}

export function hasTimeFilter(input) {
  return Boolean(input.date || input.start || input.end || input.fromTime || input.toTime);
}

function wallFormatter(zone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

export function validateTimeZone(zone) {
  try {
    if (/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(zone)) {
      wallFormatter(zone);
      return;
    }
  } catch {
    // Intl validates the IANA identifier against its timezone database.
  }
  throw new Error('Supply a valid IANA timeZone such as Asia/Seoul.');
}

function wallText(formatter, epoch) {
  const parts = Object.fromEntries(formatter.formatToParts(epoch).map(({ type, value }) => [type, value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function wallAt(epoch, zone) {
  return wallText(wallFormatter(zone), epoch);
}

function wallEpoch(value, formatter) {
  const naive = Date.parse(`${value}Z`);
  // Nearby probes capture both UTC offsets on a daylight-saving transition.
  const offsets = new Set([-DAY_MS, 0, DAY_MS].map((delta) => {
    const probe = naive + delta;
    return Date.parse(`${wallText(formatter, probe)}Z`) - probe;
  }));
  const matches = [...offsets].map((offset) => naive - offset).filter((epoch) => wallText(formatter, epoch) === value);
  if (matches.length !== 1) throw new Error(`Local time ${value} is ambiguous or does not exist in this timeZone. Supply start and end with explicit offsets.`);
  return matches[0];
}

function wallBounds(input, zone) {
  if (!input.date && !zone) throw new Error('Supply date or an airport timeZone for local clock filters.');
  const date = input.date ?? wallAt(Date.now(), zone).slice(0, 10);
  const from = (input.fromTime ?? '0000').replace(':', '');
  const to = (input.toTime ?? '2400').replace(':', '');
  const nextDay = new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  return {
    from: `${date}T${from.slice(0, 2)}:${from.slice(2)}:00`,
    to: to === '2400' ? `${nextDay}T00:00:00` : `${date}T${to.slice(0, 2)}:${to.slice(2)}:00`,
  };
}

export function timeWindow(input) {
  if (!hasTimeFilter(input)) return null;
  if (input.start || input.end) {
    const begin = Date.parse(input.start);
    const end = Date.parse(input.end);
    return Number.isFinite(begin) && Number.isFinite(end) && end > begin ? { begin, end } : null;
  }
  const zone = airportTimeZone(input);
  if (!zone && (input.fromTime || input.toTime)) throw new Error('Supply an IANA timeZone or a known airport for HHmm bounds, or use start and end with offsets.');
  const formatter = wallFormatter(zone ?? 'UTC');
  const { from, to } = wallBounds(input, zone);
  const begin = wallEpoch(from, formatter);
  const end = wallEpoch(to, formatter);
  if (end <= begin) throw new Error('End must be after start.');
  return { begin, end };
}

export function localTimeWindow(input, targetZone = airportTimeZone(input)) {
  if (!hasTimeFilter(input)) return null;
  const sourceZone = airportTimeZone(input) ?? targetZone;
  if (input.start || input.end || sourceZone !== targetZone) {
    if (!targetZone) throw new Error('Supply the airport timeZone to convert start and end to local time.');
    const window = timeWindow(input);
    if (!window) throw new Error('Supply both start and end for an airport time window.');
    return { from: wallAt(window.begin, targetZone), to: wallAt(window.end, targetZone) };
  }
  const bounds = wallBounds(input, sourceZone);
  if (bounds.to <= bounds.from) throw new Error('End must be after start.');
  return bounds;
}
