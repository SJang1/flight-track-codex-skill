import { aeroDataBoxEndpoint } from './aerodatabox-endpoints.js';

export const AERODATABOX = 'https://api.aerodatabox.com';

export function aeroDataBoxHeaders(input, env) {
  return {
    'X-API-Key': env.AERODATABOX_API_KEY.trim(),
    Accept: input.format === 'xml' ? 'application/xml' : 'application/json',
  };
}

function validateFields(fields, properties, required) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Supply an object for AeroDataBox fields.');
  for (const name of required) {
    if (!Object.hasOwn(fields, name)) throw new Error(`AeroDataBox requires ${name}.`);
  }
  for (const [name, value] of Object.entries(fields)) {
    if (!Object.hasOwn(properties, name)) throw new Error('The selected AeroDataBox endpoint does not accept one of these fields.');
    const rule = properties[name];
    if (value === null && rule.type.includes('null')) continue;
    const type = Array.isArray(rule.type) ? rule.type[0] : rule.type;
    const invalid = () => new Error(`Invalid AeroDataBox ${name}. ${rule.description ?? ''}`.trim());
    if (type === 'string') {
      if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value) || value.length > rule.maxLength ||
          (name === 'q' ? value.replace(/\s/g, '').length : value.length) < rule.minLength ||
          (rule.pattern && !new RegExp(rule.pattern).test(value)) ||
          (rule.enum && !rule.enum.some((item) => item.toLowerCase() === value.toLowerCase()))) throw invalid();
      if (rule.format === 'uuid' && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw invalid();
      if (rule.format === 'ipv4' && (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.split('.').some((octet) => Number(octet) > 255))) throw invalid();
      if (/^(?:date|fromLocal$|toLocal$)/.test(name) && name !== 'dateLocalRole') {
        const day = value.slice(0, 10);
        const instant = Date.parse(`${day}T00:00:00Z`);
        if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== day) throw invalid();
      }
    } else if (type === 'boolean') {
      if (typeof value !== 'boolean') throw invalid();
    } else if ((type === 'integer' ? !Number.isSafeInteger(value) : !Number.isFinite(value)) || value < rule.minimum || value > rule.maximum) {
      throw invalid();
    }
  }
}

function validateParameters(endpoint, params) {
  validateFields(params, endpoint.parameters, endpoint.required);
  for (const name of ['code', 'codeFrom', 'codeTo']) {
    if (params[name] && !(params.codeType.toLowerCase() === 'iata' ? /^[a-z]{3}$/i : /^[a-z]{4}$/i).test(params[name])) {
      throw new Error(`AeroDataBox ${name} must match codeType.`);
    }
  }
  if (params.searchBy?.toLowerCase() === 'icao24' && !/^[a-f\d]{6}$/i.test(params.searchParam)) {
    throw new Error('AeroDataBox ICAO24 requires a six-digit hexadecimal address.');
  }
  if (params.subjectType?.toLowerCase() === 'flightbyairporticao' && !/^[a-z]{4}$/i.test(params.subjectId)) {
    throw new Error('AeroDataBox FlightByAirportIcao requires a four-letter ICAO airport code.');
  }
  if ((params.fromLocal && (endpoint.id === 'GetAirportFlights' ? params.fromLocal >= params.toLocal : params.fromLocal > params.toLocal)) ||
      (params.dateFromLocal && params.dateFromLocal >= params.dateToLocal)) {
    throw new Error('Supply an ordered AeroDataBox date or time range.');
  }
}

function validateCallback(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Supply a public HTTP(S) callback URL for AeroDataBox.'); }
  const port = Number(url.port);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash ||
      (port && ![80, 443, 8008, 8080].includes(port) && port < 49152)) {
    throw new Error('Supply a public HTTP(S) callback URL without credentials or a fragment, using an AeroDataBox supported port.');
  }
}

export function aeroDataBoxNativeRequest(input, env) {
  const endpoint = aeroDataBoxEndpoint(input.aerodataBoxEndpoint);
  const params = input.aerodataBoxParams ?? {};
  validateParameters(endpoint, params);
  const path = endpoint.path.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    if (/[/\\]/.test(value) || value === '.' || value === '..') throw new Error(`Invalid AeroDataBox path parameter ${name}.`);
    return encodeURIComponent(value);
  });
  const url = new URL(`${AERODATABOX}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (!endpoint.path_params.includes(name)) url.searchParams.set(name, String(value));
  }
  const headers = aeroDataBoxHeaders(input, env);
  let body;
  if (endpoint.body) {
    validateFields(input.aerodataBoxBody ?? {}, endpoint.body.properties, endpoint.body.required);
    if (endpoint.id === 'SubscribeWebhook') validateCallback(input.aerodataBoxBody.url);
    body = JSON.stringify(input.aerodataBoxBody);
    headers['Content-Type'] = 'application/json';
  } else if (input.aerodataBoxBody !== undefined) {
    throw new Error('The selected AeroDataBox endpoint does not accept a body.');
  }
  const estimatedUnitCost = endpoint.id === 'RefillBalance' ? input.aerodataBoxBody.credits : endpoint.base_units * (params.withFlightPlan ? 2 : 1);
  return { url, method: endpoint.method, headers, estimatedUnitCost, ...(body === undefined ? {} : { body }) };
}
