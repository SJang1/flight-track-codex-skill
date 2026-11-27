// Native data.go.kr GETs. See each provider's docs URL for its dataset and approval.
export function normalizePortalServiceKey(value) {
  const key = value.trim();
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

const scheduledOrChanged = { type: 'string', enum: ['S', 'E'], description: 'S uses the scheduled time; E uses the revised time.' };
const changeType = { type: 'string', enum: ['I', 'U', 'D'], description: 'Insert, update or delete event in the supplied data.' };
const day = { type: 'string', pattern: '^\\d{8}$', description: 'Korea-local date in YYYYMMDD form.' };
const clock = { type: 'string', pattern: '^(?:[01]\\d|2[0-3])[0-5]\\d$|^2400$', description: 'Korea-local HHmm.' };
const flightInstant = { type: 'string', pattern: '^\\d{12}$', description: 'Korea-local YYYYMMDDHHmm timestamp.' };
const market = { type: 'string', enum: ['D', 'I'], description: 'Domestic or international flight.' };
const schema = {
  pageNo: { type: 'integer', minimum: 1, description: 'Result page number.' },
  numOfRows: { type: 'integer', minimum: 1, description: 'Results per page.' },
  schDate: day, searchDate: day, searchday: day,
  searchDay: { type: 'string', enum: ['0', '1', '2'], description: '0 covers today and tomorrow, 1 is today, 2 is tomorrow in Korea time.' },
  schStTime: clock, schEdTime: clock,
  from_time: clock, to_time: clock, searchFrom: clock, searchTo: clock,
  lang: { type: 'string', enum: ['K', 'E', 'C', 'J'], description: 'Korean, English, Chinese or Japanese.' },
  schLineType: market, Line: market, line: market,
  schIOType: { type: 'string', enum: ['I', 'O'], description: 'Arrival or departure.' },
  searchdtCode: scheduledOrChanged, inqtimechcd: scheduledOrChanged,
  passengerOrCargo: { type: 'string', enum: ['P', 'C'], description: 'Passenger or cargo; defaults to passenger.' },
  fgenType: changeType,
  fgenTime: { type: 'string', pattern: '^\\d{14}$', description: 'Only return data generated after this YYYYMMDDHHmmss timestamp.' },
  terno: { type: 'string', enum: ['T1', 'T2'], description: 'Incheon passenger terminal.' },
  schAPLno: { type: 'string', description: 'Aircraft registration.' },
  schAPM: { type: 'string', description: 'Aircraft type, such as B747.' },
};

const page = 'pageNo numOfRows';
const kacRealtime = 'schLineType schIOType schAirCode schStTime schEdTime';
const kacRegularSchedule = `${page} schDate schDeptCityCode schArrvCityCode schAirLine schFlightNum`;
const kacSpecialSchedule = `${page} fid flightId depCityCode depCity arrvCityCode arrvCity schAirLine fgenType fgenTime`;
const kacDated = `${page} searchday from_time to_time airport_code f_id flight_id line airport fgenTime`;
const kacTaxfree = `${page} searchDate searchFrom searchTo fid flightId depCityCode depCity arrvCityCode arrvCity fgenType`;
const incheonDetail = `${page} searchday from_time to_time airport_code f_id flight_id inqtimechcd lang`;
const incheonAll = `${page} searchdtCode searchDate searchFrom searchTo fid flightId airportCode tmp1 tmp2`;
const incheonFerry = `${page} airlineCode flightId searchDay airportCode codeshare masterFlightId flightServiceType remark aircraftType aircraftSubtype aircraftRegNo fstandPosition terminalId runway gateNo tmp1 tmp2 lang`;
const ferryOptions = {
  codeshare: { type: 'string', enum: ['MA', 'SL'], description: 'Master or codeshare flight.' },
  flightServiceType: { type: 'string', enum: ['PA', 'CA', 'TP', 'TC', 'TA'], description: 'Passenger, cargo, or technical landing for passenger, cargo, or both service types.' },
  terminalId: { type: 'string', enum: ['P01', 'P02', 'P03', 'C01', 'C02', 'C03'], description: 'Incheon terminal or concourse code.' },
  lang: { type: 'string', enum: ['K', 'E'], description: 'Korean or English.' },
};
const lateralStatus = { type: 'string', enum: ['O', 'C'], description: 'Open or closed.' };

function get(id, label, fields, required = '', overrides = {}) {
  const mandatory = required.split(' ');
  return {
    id, label, method: 'GET', path: `/${id}`,
    parameters: fields.split(' ').filter(Boolean).map((name) => {
      const { description, ...rule } = overrides[name] ?? schema[name] ?? { type: 'string' };
      return {
        name, in: 'query', schema: rule,
        ...(description ? { description } : {}),
        ...(mandatory.includes(name) ? { required: true } : {}),
      };
    }),
  };
}

function incheonPair(stem, suffix, label, fields, paged = true) {
  return ['Arrivals', 'Departures'].map((direction) =>
    get(stem + direction + suffix, `${label} ${direction.toLowerCase()}`, fields, paged ? page : ''));
}

const datasets = {
  15158949: ['B551178/flight-schedule', [
    get('dom', 'Domestic schedule', kacRegularSchedule),
    get('int', 'International schedule', kacRegularSchedule),
    get('taxfree-dom', 'Domestic duty-free timetable', kacSpecialSchedule),
    get('taxfree-int', 'International duty-free timetable', kacSpecialSchedule),
  ]],
  15160195: ['B551178/flight-search', [
    get('info', 'Real-time flight-number lookup', `${kacRealtime} schFln`, 'schFln'),
  ]],
  15158519: ['B551178/flight-aircraft-status', [
    get('info', 'Aircraft type and registration assignments', `${page} schStTime schEdTime schAirCode schFln Line schAPLno schAPM`, '', {
      schStTime: { ...flightInstant, description: 'Scheduled departure (YYYYMMDDHHmm).' },
      schEdTime: { ...flightInstant, description: 'Scheduled arrival (YYYYMMDDHHmm).' },
    }),
  ]],
  15158625: ['B551178/flight-status', [
    get('info', 'Real-time airport flights', kacRealtime),
    get('detail', 'Real-time delay and cancellation details', page),
    get('depart', 'Passenger departure delay and cancellation lookup', `${kacDated} arr_airport_code arr_airport`),
    get('arrival', 'Passenger arrival delay and cancellation lookup', `${kacDated} dep_airport_code dep_airport`),
    get('taxfree', 'Real-time duty-free passenger movements', kacTaxfree),
  ]],
  15095068: ['B551177/StatusOfCargoFlights',
    incheonPair('getCargo', '', 'Same-day cargo', 'from_time to_time airport flight_id airline lang', false)],
  15113461: ['B551177/StatusOfCargoFlightsDeOdp',
    incheonPair('getCargo', 'DeOdp', 'Detailed cargo', incheonDetail)],
  15140153: ['B551177/statusOfAllFltDeOdp',
    incheonPair('getFlt', 'DeOdp', 'Detailed passenger or cargo', `${incheonAll} passengerOrCargo`)],
  15112968: ['B551177/StatusOfPassengerFlightsDeOdp',
    incheonPair('getPassenger', 'DeOdp', 'Detailed passenger', incheonDetail)],
  15095059: ['B551177/PaxFltSched',
    incheonPair('getPaxFltSched', '', 'Passenger seasonal timetable', `${page} lang airport`)],
  15160568: ['B551177/statusOfPaxFltDeOdpT1',
    incheonPair('getPaxFlt', 'DeOdpT1', 'Terminal 1 passenger', incheonAll)],
  15166252: ['B551177/statusOfPaxFltDeOdpT2',
    incheonPair('getPaxFlt', 'DeOdpT2', 'Terminal 2 passenger', incheonAll)],
  15168220: ['B551177/statusOfCgoFltDeOdpT1',
    incheonPair('getCgoFlt', 'DeOdpT1', 'Terminal 1 cargo', incheonAll)],
  15168252: ['B551177/statusOfCgoFltDeOdpT2',
    incheonPair('getCgoFlt', 'DeOdpT2', 'Terminal 2 cargo', incheonAll)],
  15166250: ['B551177/statusOfFerryFltOdp', [
    get('getFerryFltArrivalsOdp', 'Ferry arrivals', `${incheonFerry} bagRemark bagCarouselId bagFirstTime bagLastTime exit`, page, {
      ...ferryOptions,
      remark: { type: 'string', enum: ['ARR', 'CNL', 'DEL', 'DIV', 'LND'] },
      bagRemark: { type: 'string', enum: ['FBG', 'LBG'], description: 'First or last baggage loading status.' },
    }),
    get('getFerryFltDeparturesOdp', 'Ferry departures', `${incheonFerry} lateral1 lateral1Status lateral2 lateral2Status chkinrange`, page, {
      ...ferryOptions,
      remark: { type: 'string', enum: ['DEP', 'CNL', 'DEL', 'DIV', 'TKF', 'GTC'] },
      lateral1Status: lateralStatus,
      lateral2Status: lateralStatus,
    }),
  ]],
  15098227: ['B551177/FlightClosingInfoSpot', [
    get('getFlightClosingInfoSpot', 'Flight closing and stand records', page, page),
  ]],
  15095061: ['B551177/StatusOfArrivals', [
    get('getArrivalsCongestion', 'Immigration gate and approaching arrivals', `${page} terno airport`, page),
  ]],
  15095073: ['B551177/StatusOfSrvAirlines', [
    get('getServiceAirlineInfo', 'Airlines serving Incheon', 'airline_iata airline_icao'),
  ]],
  15163384: ['B551178/dutyfree', [
    get('info', 'Duty-free flight operations and changes', `${kacTaxfree} fgenTime`),
  ]],
};

export function koreanPortalNative(datasetId, key) {
  const [path, endpoints] = datasets[datasetId];
  return {
    baseUrl: `https://apis.data.go.kr/${path}`,
    endpoints,
    options(input, env) {
      return { query: { serviceKey: normalizePortalServiceKey(env[key]), type: input.format ?? 'json' } };
    },
  };
}
