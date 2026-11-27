const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 10;
const FIRST_POSITION = Date.parse('2016-05-11T00:00:00Z');
const FIRST_SUMMARY = Date.parse('2022-06-01T00:00:00Z');

const plans = {
  explorer: { rpm: 10, maxResults: 20, historyDays: 30 },
  essential: { rpm: 30, maxResults: 300, historyDays: 730 },
  advanced: { rpm: 200, maxResults: null, historyDays: null },
};

const flightFilters = ['flights', 'callsigns', 'registrations', 'painted_as', 'operating_as', 'airports', 'routes', 'aircraft'];
const positionFilters = [...flightFilters, 'bounds', 'altitude_ranges', 'squawks', 'categories', 'data_sources', 'gspeed'];
const summaryFilters = ['flight_ids', 'flight_datetime_from', 'flight_datetime_to', ...flightFilters];
const eventFilters = ['flight_ids', 'event_types'];
const eventTypes = ['all', 'gate_departure', 'takeoff', 'cruising', 'airspace_transition', 'diverting', 'diverted', 'descent', 'landed', 'gate_arrival'];

function positions(period, variant, credits, plan = 'all') {
  const historic = period === 'historic';
  return {
    path: `/${period}/flight-positions/${variant}`,
    params: [...positionFilters, ...(historic ? ['timestamp'] : ['airspaces']), ...(variant === 'count' ? [] : ['limit'])],
    required: historic ? ['timestamp'] : [], plan, credits, family: 'positions',
  };
}

function events(variant, plan = 'all') {
  return { path: `/historic/flight-events/${variant}`, params: eventFilters, required: ['flight_ids'], plan, family: 'events' };
}

function summary(variant, credits, plan = 'all') {
  return {
    path: `/flight-summary/${variant}`,
    params: [...summaryFilters, ...(variant === 'count' ? [] : ['sort', 'limit'])],
    required: [], plan, credits, family: 'summary',
  };
}

const endpoints = {
  airports_light: { path: '/static/airports/{code}/light', params: ['code'], required: ['code'], plan: 'all', credits: 1 },
  airports_full: { path: '/static/airports/{code}/full', params: ['code'], required: ['code'], plan: 'essential', credits: 50 },
  airlines_light: { path: '/static/airlines/{icao}/light', params: ['icao'], required: ['icao'], plan: 'all', credits: 1 },
  live_positions_full: positions('live', 'full', 8),
  live_positions_light: positions('live', 'light', 6),
  live_positions_count: positions('live', 'count', null, 'essential'),
  historic_positions_full: positions('historic', 'full', 8),
  historic_positions_light: positions('historic', 'light', 6),
  historic_positions_count: positions('historic', 'count', null, 'essential'),
  historic_events_full: events('full'),
  historic_events_light: events('light'),
  // Apply the same minimum plan to every Count endpoint.
  historic_events_count: events('count', 'essential'),
  flight_summary_full: summary('full', 6),
  flight_summary_light: summary('light', 3),
  flight_summary_count: summary('count', null, 'essential'),
  flight_tracks: { path: '/flight-tracks', params: ['flight_id'], required: ['flight_id'], plan: 'all', credits: 40 },
  usage: { path: '/usage', params: ['period'], required: [], plan: 'all', rpm: 1 },
};

export const fr24EndpointIds = Object.keys(endpoints);

export const fr24ParamProperties = {
  ...Object.fromEntries([...new Set(Object.values(endpoints).flatMap(({ params }) => params))].map((name) => [name, { type: 'string', maxLength: 4096 }])),
  timestamp: { type: 'integer', minimum: 1, description: 'Historical position at Unix seconds.' },
  limit: { type: 'integer', minimum: 1, maximum: 30_000 },
  code: { type: 'string', pattern: '^[A-Za-z]{3,4}$', description: 'IATA or ICAO airport code for an Airports endpoint.' },
  icao: { type: 'string', pattern: '^[A-Za-z]{3}$', description: 'ICAO airline code for Airlines Light.' },
  sort: { type: 'string', enum: ['asc', 'desc'] },
  period: { type: 'string', enum: ['24h', '7d', '30d', '1y'], description: 'Usage period. FR24 defaults to 24h.' },
};

function selectedPlan(env) {
  const value = env.FLIGHTRADAR24_PLAN?.trim().toLowerCase();
  return Object.hasOwn(plans, value) ? value : null;
}

function availableOnPlan(endpoint, plan) {
  if (!plan) return null;
  return endpoint.plan === 'all' || plan !== 'explorer';
}

export function fr24EndpointCatalog(env) {
  const plan = selectedPlan(env);
  return {
    fr24_plan: plan,
    fr24_endpoints: fr24EndpointIds.map((id) => {
      const endpoint = endpoints[id];
      return {
        id, path: `/api${endpoint.path}`, available_on_plan: availableOnPlan(endpoint, plan),
        parameters: endpoint.params, required_parameters: endpoint.required,
      };
    }),
  };
}

function checkHistory(from, earliest, plan) {
  if (from < earliest) throw new Error(`FR24 data for this endpoint starts on ${new Date(earliest).toISOString().slice(0, 10)} UTC.`);
  const days = plan ? plans[plan].historyDays : null;
  if (days && from < Date.now() - days * DAY_MS) throw new Error(`Flightradar24 ${plan} provides the most recent ${days} days of history.`);
}

function parseTime(value, parameter) {
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value ?? '')) {
    throw new Error(`Supply ${parameter} as an ISO timestamp; times without an offset are UTC.`);
  }
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const utc = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(utc.replace(' ', 'T'));
  if (!Number.isFinite(time) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error(`Supply a valid ${parameter} timestamp.`);
  }
  return time;
}

function checkSummary(query, plan) {
  const hasTime = query.flight_datetime_from || query.flight_datetime_to;
  const hasFilter = flightFilters.some((key) => query[key]);
  if (query.flight_ids) {
    if (hasTime || hasFilter) throw new Error('Use flight_ids by itself, or combine a time range with flight filters.');
    return;
  }
  if (!hasFilter) throw new Error('Supply flight_ids or a time range with at least one flight filter.');
  const start = parseTime(query.flight_datetime_from, 'flight_datetime_from');
  const end = parseTime(query.flight_datetime_to, 'flight_datetime_to');
  if (end <= start || end - start > 14 * DAY_MS) throw new Error('Supply an ordered FR24 flight summary range of at most 14 days.');
  checkHistory(start, FIRST_SUMMARY, plan);
  query.flight_datetime_from = new Date(start).toISOString().replace('.000Z', 'Z');
  query.flight_datetime_to = new Date(end).toISOString().replace('.000Z', 'Z');
}

function parseParameter(name, value) {
  const schema = fr24ParamProperties[name];
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum) throw new Error(`Supply a positive integer for ${name}.`);
    return value;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid FR24 parameter ${name}.`);
  const trimmed = value.trim();
  if (schema.enum && !schema.enum.includes(trimmed)) throw new Error(`Invalid FR24 parameter ${name}.`);
  if (schema.pattern && !new RegExp(schema.pattern).test(trimmed)) throw new Error(`Invalid FR24 parameter ${name}.`);
  return trimmed;
}

export function fr24RequestOptions(id, params, env) {
  if (!Object.hasOwn(endpoints, id)) throw new Error('Select an endpoint listed in aviation_providers.');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Use an object for fr24Params.');
  const endpoint = endpoints[id];
  const plan = selectedPlan(env);
  if (env.FLIGHTRADAR24_PLAN?.trim() && !plan) throw new Error('Set FLIGHTRADAR24_PLAN to explorer, essential, or advanced.');
  if (availableOnPlan(endpoint, plan) === false) throw new Error(`FR24 ${plan} does not include ${id}.`);

  const query = {};
  for (const [name, value] of Object.entries(params)) {
    if (!endpoint.params.includes(name)) throw new Error(`FR24 ${id} does not accept ${name}.`);
    query[name] = parseParameter(name, value);
  }
  for (const name of endpoint.required) {
    if (query[name] === undefined) throw new Error(`Supply ${name} for FR24 ${id}.`);
  }

  if (endpoint.family === 'positions') {
    if (!Object.keys(query).length) throw new Error('Supply at least one parameter for FR24 live positions.');
    if (query.timestamp !== undefined) {
      if (query.timestamp >= Date.now() / 1000) throw new Error('Supply a historical Unix timestamp.');
      checkHistory(query.timestamp * 1000, FIRST_POSITION, plan);
    }
  }
  if (endpoint.family === 'summary') checkSummary(query, plan);
  if (query.flight_ids && !/^[\da-f]+(?:,[\da-f]+)*$/i.test(query.flight_ids)) throw new Error('Supply comma-separated hexadecimal FR24 flight_ids.');
  if (query.flight_ids && query.flight_ids.split(',').length > 15) throw new Error('FR24 accepts up to 15 flight IDs per request.');
  if (query.flight_id && !/^[\da-f]+$/i.test(query.flight_id)) throw new Error('Supply a hexadecimal FR24 flight_id.');
  if (endpoint.family === 'events') {
    query.event_types ??= 'all';
    if (query.event_types?.split(',').some((type) => !eventTypes.includes(type))) throw new Error('Supply documented FR24 event types or all.');
  }
  if (endpoint.params.includes('limit')) {
    const providerLimit = endpoint.family === 'summary' ? 20_000 : 30_000;
    const maxResults = Math.min(plans[plan]?.maxResults ?? providerLimit, providerLimit);
    if (query.limit > maxResults) throw new Error(`FR24 ${plan ?? id} allows at most ${maxResults} results per query.`);
    if (query.limit === undefined && !query.flight_ids) query.limit = DEFAULT_LIMIT;
  }

  const pathParameter = query.code ? 'code' : query.icao ? 'icao' : null;
  if (!pathParameter) return { path: endpoint.path, query };
  const { [pathParameter]: code, ...parameters } = query;
  return { path: endpoint.path.replace(`{${pathParameter}}`, code.toUpperCase()), query: parameters };
}

export function fr24RequestLimits(id, params, env) {
  const endpoint = endpoints[id];
  const plan = plans[selectedPlan(env)] ?? plans.explorer;
  const limits = [{ requests: endpoint?.rpm ?? plan.rpm, windowMs: 60_000 }];
  const monthlyBudget = Number(env.FLIGHTRADAR24_MONTHLY_CREDITS);
  if (!endpoint?.credits || !Number.isSafeInteger(monthlyBudget) || monthlyBudget < 1) return limits;
  const results = params.limit ?? params.flight_ids?.split(',').length ?? DEFAULT_LIMIT;
  const credits = endpoint.family ? endpoint.credits * results : endpoint.credits;
  const calls = Math.floor(monthlyBudget / credits);
  limits.push(calls > 0
    ? { requests: calls, windowMs: 31 * DAY_MS }
    : { requests: 1, windowMs: Math.ceil(31 * DAY_MS * credits / monthlyBudget) });
  return limits;
}
