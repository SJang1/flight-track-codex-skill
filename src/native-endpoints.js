export const changesAccount = (endpoint) => endpoint.mutates ?? endpoint.changesAccount ?? endpoint.method !== 'GET';
const requiresBody = (endpoint) => endpoint.bodyRequired ?? Boolean(endpoint.body);

function checkValue(value, schema, name) {
  if (value === null && schema.nullable) return;
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Choose a documented value for ${name}.`);
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null && types.includes('null')) return;
  switch (types.find((type) => type !== 'null')) {
    case 'string':
      if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || value.length < schema.minLength || value.length > schema.maxLength || (schema.pattern && !new RegExp(schema.pattern).test(value))) {
        throw new Error(`Invalid ${name}.`);
      }
      break;
    case 'integer':
    case 'number': {
      const min = schema.exclusiveMinimum === true ? schema.minimum : schema.exclusiveMinimum;
      const max = schema.exclusiveMaximum === true ? schema.maximum : schema.exclusiveMaximum;
      if ((types.includes('integer') && !types.includes('number') ? !Number.isSafeInteger(value) : !Number.isFinite(value)) ||
          value < schema.minimum || value > schema.maximum || (typeof min === 'number' && value <= min) || (typeof max === 'number' && value >= max)) {
        throw new Error(`Invalid ${name}.`);
      }
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`Invalid ${name}.`);
      break;
    case 'array':
      if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) throw new Error(`Invalid ${name}.`);
      value.forEach((item, index) => checkValue(item, schema.items ?? {}, `${name}[${index}]`));
      break;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Supply an object for ${name}.`);
      for (const field of schema.required ?? []) {
        if (!Object.hasOwn(value, field)) throw new Error(`Missing ${name}.${field}.`);
      }
      for (const [key, entry] of Object.entries(value)) {
        let property;
        if (Object.hasOwn(schema.properties ?? {}, key)) property = schema.properties[key];
        else if (schema.additionalProperties === false) throw new Error(`Unknown ${name} field.`);
        else if (typeof schema.additionalProperties === 'object') property = schema.additionalProperties;
        if (property) checkValue(entry, property, `${name}.${key}`);
      }
      break;
  }
}

export function nativeCatalog(provider, endpointId) {
  const { id, docs, native, formats } = provider;
  const endpoints = endpointId ? native.endpoints.filter(({ id }) => id === endpointId) : native.endpoints;
  if (!endpoints.length) throw new Error('Choose an endpoint listed for this provider.');
  return { provider: id, docs, endpoints: endpoints.map((endpoint) => {
    const { id, method, path, label, tag, body, parameters = [], note, keys } = endpoint;
    const detail = endpointId ? { parameters, ...(body ? { body, bodyRequired: requiresBody(endpoint) } : {}), ...(keys ? { keys } : {}), ...(note ? { note } : {}) } : {
      params: parameters.map(({ name }) => name), required: parameters.filter(({ in: location, required }) => location === 'path' || required).map(({ name }) => name), ...(body ? { has_body: true } : {}),
    };
    return { id, label, tag, method, path, changes_account: changesAccount(endpoint), formats: endpoint.formats ?? native.formats ?? formats ?? ['json'], ...detail };
  }) };
}

function appendQuery(query, parameter, value) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    query.set(parameter.name, String(value));
    return;
  }
  const separator = { pipeDelimited: '|', spaceDelimited: ' ' }[parameter.style];
  if (parameter.explode === false || separator) query.set(parameter.name, value.join(separator ?? ','));
  else for (const item of value) query.append(parameter.name, String(item));
}

export function nativeRequest(provider, endpoint, input, env) {
  const params = input.nativeParams ?? {};
  const parameters = new Map((endpoint.parameters ?? []).map((parameter) => [parameter.name, parameter]));
  for (const { name, in: location, required } of parameters.values()) {
    if ((location === 'path' || required) && !Object.hasOwn(params, name)) throw new Error(`Supply ${name} for this endpoint.`);
  }
  for (const [name, value] of Object.entries(params)) {
    const parameter = parameters.get(name);
    if (!parameter) throw new Error('The selected endpoint does not accept one of these parameters.');
    checkValue(value, parameter.schema ?? {}, name);
  }
  if (input.nativeBody !== undefined) {
    if (!endpoint.body) throw new Error('The selected endpoint does not accept a body.');
    checkValue(input.nativeBody, endpoint.body, 'nativeBody');
  } else if (requiresBody(endpoint)) {
    throw new Error('Supply nativeBody for this endpoint.');
  }
  const options = provider.native.options?.(input, env, endpoint) ?? {};
  const path = (options.path ?? endpoint.path).replace(/\{([^{}]+)\}/g, (_, key) => {
    const value = params[key];
    if (value == null || value === '' || value === '.' || value === '..' || /[/\\\x00-\x1f]/.test(String(value))) throw new Error(`Invalid path parameter ${key}.`);
    return encodeURIComponent(value);
  });
  const url = new URL(`${endpoint.baseUrl ?? provider.native.baseUrl}${path}`);
  for (const [name, value] of Object.entries(params)) {
    const parameter = parameters.get(name);
    if (parameter.in === 'query') appendQuery(url.searchParams, parameter, value);
  }
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.delete(name);
    appendQuery(url.searchParams, { name }, value);
  }
  const body = input.nativeBody === undefined ? undefined : JSON.stringify(input.nativeBody);
  return {
    url, method: endpoint.method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    ...(body === undefined ? {} : { body }), ...(endpoint.reportRedirect ? { reportRedirect: true } : {}),
  };
}
