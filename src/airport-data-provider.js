const HOUR_MS = 60 * 60 * 1000;

export const airportDataProvider = {
  id: 'freeairportdb',
  label: 'FreeAirportDB airport information',
  docs: 'https://freeairportdb.com/api',
  note: 'Public airport reference data from FreeAirportDB and OurAirports (CC BY 4.0).',
  attribution: [
    { name: 'FreeAirportDB', url: 'https://freeairportdb.com/' },
    { name: 'OurAirports', url: 'https://ourairports.com/' },
  ],
  limits: [{ requests: 1000, windowMs: HOUR_MS }, { requests: 10, windowMs: 1000 }],
  operations: {},
  airportInfo(input) {
    const code = input.airport;
    if (typeof code !== 'string' || !/^[A-Z]{3,4}$/i.test(code)) return null;
    return {
      url: new URL(`https://api.freeairportdb.com/v1/airports/${code.toUpperCase()}`),
      headers: { Accept: 'application/json' },
    };
  },
};
