# Aviation Raw Tracker

Dots에서 항공편 상태, 실시간 ADS-B, 과거 궤적, 공항 운항 정보를 조회하는 비공개 MCP 플러그인입니다.

## API 키 설정

사용할 API의 키를 비공개 Site의 **일반 런타임 환경변수**에 등록합니다. Dots의 `aviation_providers`는 변수 유무를 확인하며 공급자에는 요청을 보내지 않습니다. 실제 인증과 조회 성공 여부는 `aviation_lookup`의 공급자별 응답으로 확인합니다. 필수 값이 비어 있는 API는 호출을 건너뜁니다. [환경변수 예시](.env.example)

### 항공편·기체 조회에 필요한 키

| API | 등록할 환경변수 |
| --- | --- |
| AirNav Radar | `AIRNAVRADAR_API_TOKEN` |
| FlightAware AeroAPI | `FLIGHTAWARE_API_KEY` |
| Flightradar24 API | `FLIGHTRADAR24_API_KEY` |
| AeroDataBox Direct | `AERODATABOX_API_KEY` |
| adsb.lol | `ADSB_LOL_API_KEY` |
| OpenSky Network | `OPENSKY_CLIENT_ID`와 `OPENSKY_CLIENT_SECRET` 두 값 모두 |
| AirLabs | `AIRLABS_API_KEY` |
| Aviationstack | `AVIATIONSTACK_API_KEY` |

OpenSky의 `credentials.json`에서 `clientId` 값은 `OPENSKY_CLIENT_ID`, `clientSecret` 값은 `OPENSKY_CLIENT_SECRET` 일반 변수에 각각 넣습니다. [OpenSky 공식 Python 클라이언트](https://github.com/openskynetwork/opensky-api/blob/master/python/opensky_api.py)

### 공공데이터포털 API 키

공공데이터포털에서는 데이터셋 이름이나 번호로 검색합니다. 표의 대문자 이름은 플러그인이 읽는 **Sites 환경변수 이름**입니다. 포털에서 받은 **일반 인증키**의 Encoding 또는 Decoding 값을 넣으면, 플러그인이 `serviceKey` 요청 파라미터로 한 번 인코딩해 보냅니다.

| 공공데이터포털 데이터셋 | 플러그인 환경변수 |
| --- | --- |
| [인천국제공항공사_화물기 운항 현황 상세 조회 서비스 (15113461)](https://www.data.go.kr/data/15113461/openapi.do) | `INCHEON_CARGO_SERVICE_KEY` |
| [인천국제공항공사_항공기 운항 현황 상세 조회 (15140153)](https://www.data.go.kr/data/15140153/openapi.do) | `INCHEON_ALL_FLIGHTS_SERVICE_KEY` |
| [인천국제공항공사_여객기 운항 현황 상세 조회 서비스 (15112968)](https://www.data.go.kr/data/15112968/openapi.do) | `INCHEON_PASSENGER_SERVICE_KEY` |
| [인천국제공항공사_여객기 운항 스케줄 (15095059)](https://www.data.go.kr/data/15095059/openapi.do) | `INCHEON_PASSENGER_TIMETABLE_SERVICE_KEY` |
| [한국공항공사_실시간 항공기 운항정보 조회_GW (15158625)](https://www.data.go.kr/data/15158625/openapi.do) | `KAC_FLIGHT_STATUS_SERVICE_KEY` |
| [인천국제공항공사_화물편 운항현황(다국어) (15095068)](https://www.data.go.kr/data/15095068/openapi.do) | `INCHEON_CARGO_TODAY_SERVICE_KEY` |
| [한국공항공사_실시간 항공기 운항정보 검색_GW (15160195)](https://www.data.go.kr/data/15160195/openapi.do) | `KAC_FLIGHT_SEARCH_SERVICE_KEY` |
| [한국공항공사_항공기 기종·등록번호 운항 정보 (15158519)](https://www.data.go.kr/data/15158519/openapi.do) | `KAC_AIRCRAFT_STATUS_SERVICE_KEY` |
| [한국공항공사_항공기 운항 스케줄 정보_GW (15158949)](https://www.data.go.kr/data/15158949/openapi.do) | `KAC_SCHEDULE_SERVICE_KEY` |

### 키 없이 호출할 수 있는 API

- **adsb.fi, adsb.aero**는 공개 API를 사용합니다.
- **AvioADSB**는 무키로도 호출합니다. 보유한 키가 있으면 `AVIOADSB_API_KEY`를 선택적으로 등록할 수 있습니다.

## 조회 방법

Dots에서는 필요한 조회 유형마다 `aviation_lookup`을 호출합니다. 같은 항공편이라도 답변에 필요한 정보가 더 있으면 다른 조회 유형이나 확인된 식별자로 이어서 조회하는 것을 권장합니다. 예를 들어 `flight`에서 운항 상태와 기체 등록번호를 확인하고, 현재 좌표가 필요하면 그 등록번호로 `live`를 호출합니다. 실제 비행 경로가 필요하면 `track`을 사용합니다. `providers`를 생략하면 FR24를 포함해 요청 조건과 키 설정이 맞는 일반 조회 공급자에 병렬로 요청하고 완료 순서대로 결과를 모읍니다. FlightAware는 명시적으로 단독 선택합니다. 최종 종합과 판단은 Dots 에이전트가 담당합니다.

| 도구 | 용도 |
| --- | --- |
| `aviation_providers` | 공급자별 기능, 인증 준비 상태, 조회 간격 확인 |
| `aviation_lookup` | 조건에 맞는 공급자를 조회하고 공급자별 원본 본문과 다음 조회 권장 시각 반환 |

### 공급자 선택

- `providers`에는 조회할 공급자 ID를 넣습니다. 예를 들어 Dots에 “adsb.fi에서만 조회해 줘”라고 요청하면 `providers: ["adsb_fi"]`를 사용합니다.
- `excludeProviders`에는 제외할 공급자 ID를 넣습니다. “OpenSky 빼고 조회해 줘”는 `excludeProviders: ["opensky"]`를 사용합니다.
- 두 옵션을 함께 쓰면 제외가 우선합니다. 적용 후 선택할 후보가 없거나 공급자 ID가 잘못되면 외부 호출 전에 오류를 반환합니다. 공급자 ID는 `aviation_providers`에서 확인할 수 있습니다.

```json
{"operation":"live","identType":"callsign","ident":"KAL93","providers":["adsb_fi"]}
```

```json
{"operation":"live","identType":"icao24","ident":"71C597","excludeProviders":["opensky"]}
```

비공개 Site에 로그인하면 웹 화면에서 조회 유형을 고르고 입력폼을 채워 직접 실행할 수 있습니다. **이 공급자만 조회**와 **이 공급자 제외** 칸에는 공급자 ID를 쉼표로 구분해 입력합니다. JSON을 작성하지 않아도 됩니다.

편명, 구간, 공항 코드는 각각 독립적으로 조회할 수 있습니다. Dots에는 아래 예시처럼 자연어로 요청하면 됩니다. JSON은 `aviation_lookup`에 전달되는 인자 예시입니다.

| 목적 | 먼저 넣을 조건 |
| --- | --- |
| 편명으로 현재 상태 | `operation: "flight"`, 편명과 종류. 날짜·공항·방향은 어느 운항편인지 구분할 때 추가합니다. |
| 현재 기체 위치 | `operation: "live"`, 확인된 콜사인·등록번호·ICAO24 중 하나. |
| 공항 출도착 | `operation: "airport"`, 공항 코드. 출발이나 도착만 필요하면 `direction`을 추가합니다. |
| 운항 구간 | `operation: "airport"`, 양쪽 공항과 방향. 편명은 그 편으로만 좁힐 때 추가합니다. |
| 과거 기록·궤적 | `history`에는 식별자나 공항과 관심 날짜를, `track`에는 공급자가 지원하는 궤적 ID나 기체 식별자를 보냅니다. |

공급자마다 적용한 시간·구간·식별자 기준은 응답의 `time_filter_basis`, `time_filter_note`, `route_filter_note`, `identity_filter_note`에 표시됩니다. 예를 들어 adsb.aero의 콜사인·등록번호 검색은 접두어 검색이어서 원문에서 정확히 같은 식별자인지 확인합니다. [adsb.aero API 문서](https://adsb.aero/llms.txt)

OpenSky의 최근 한 시점 위치가 필요하면 `live`에 ICAO24와 `start`를 넣습니다. 인증된 조회에서 최근 1시간 이내의 시점을 사용할 수 있고, OpenSky는 시각을 5초 단위로 맞춥니다. [OpenSky 위치 조회](https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors)

### 기체·공항 정보와 비행 경로

| 알고 싶은 정보 | 조회 유형과 입력 |
| --- | --- |
| 기체 기본 정보 | `aircraft`에 등록번호 또는 ICAO24를 넣습니다. FlightAware 기종 정보는 `identType: "aircraft_type"`과 `B77W` 같은 ICAO 기종 코드로 조회합니다. |
| 기체 등록 이력 또는 마지막 운항 | `aircraft_registrations`에는 AeroDataBox가 지원하는 기체 식별자를, `last_flight`에는 FlightAware와 기체 등록번호를 지정합니다. |
| 공항 기본 정보 또는 활주로 | `airport_info` 또는 `airport_runways`에 공항 코드를 넣습니다. |
| 항공사 정보 | `airline_info`에 IATA 두 글자 또는 ICAO 세 글자 코드와 해당 `identType`을 넣습니다. |
| 실제 관측 궤적 | `track`을 사용합니다. AirNav는 식별자와 날짜·시간 범위를 사용하며, adsb.lol에는 `trackScope: "recent"`를 쓸 수 있습니다. |
| 제출 비행계획 경로 | `filed_route`를 사용합니다. FlightAware는 공급자 항공편 ID, AeroDataBox는 지원하는 편명·기체 식별자를 사용합니다. |
| 편명별 출발일 목록 | `flight_dates`에 편명과 현지 출발일 범위 `fromDate`, `toDate`를 넣습니다. |
| 주변 실시간 항공기 | `nearby`에 위도 `latitude`, 경도 `longitude`, 해리 단위 `radiusNm`을 넣습니다. 가장 가까운 기체 한 대는 `limit: 1`을 지원하는 공급자에서 조회합니다. |

`identType: "provider_id"`는 그 ID를 발급한 공급자 한 곳을 `providers`로 선택합니다. 예를 들어 FR24 `fr24_id`와 FlightAware `fa_flight_id`는 각각 자기 공급자에서 사용합니다. 별도로 추가한 유료 공항 참조 경로는 `airport_info` 요청에서 실행됩니다. 공급자별 조회 가능 범위는 `aviation_providers`에 표시됩니다. [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml) · [AeroDataBox Direct](https://doc.aerodatabox.com/docs/openapi-direct-v1.json) · [AirNav OpenAPI](https://www.airnavradar.com/api/openapi) · [adsb.lol OpenAPI](https://api.adsb.lol/api/openapi.json)

### 편명 조회

“KE703 상태 알려줘.”

```json
{"operation":"flight","identType":"flight_number","ident":"KE703"}
```

인천 출발이 확인된 항공편이면 `airport: "ICN"`과 `direction: "departure"`를 함께 보냅니다. Dots는 대화나 확인한 데이터에 나온 조건을 활용하고, 확실하지 않은 방향과 날짜는 비워 둡니다. 웹 편명 조회에서는 **추가 조건**에서 입력합니다.

인천공항 API에서 편명으로 조회할 때는 ICN 출발·도착 경로와 IATA 편명을 사용합니다. 상대 공항이 함께 입력돼도 인천 어댑터는 그 코드로 편명을 걸러내지 않습니다. 이 경우 `route_filter_note`가 표시됩니다. 편명 없이 구간을 조회하면 상대 공항 코드로 검색합니다.

현재 항공편의 실제 ADS-B `callsign`, `icao24` 또는 `registration`을 확인했다면 해당 값을 편명 조회에 함께 넣을 수 있습니다. 편명 조회 기능이 없는 위치 공급자에는 확인된 기체 식별자로 별도 위치 요청을 보냅니다. 응답의 `result_kind: "aircraft_position"`은 기체 관측값을 뜻합니다. 편명과 다른 식별자 사이의 관계는 요청에서 확인된 값을 사용합니다.

날짜나 시간 조건을 주면 편명 조회에서 현재 ADS-B 관측을 별도로 추가하지 않습니다. 현재 좌표가 필요하면 `live`를 사용합니다. FR24·AirNav·AirLabs는 `live`에서도 편명으로 조회합니다. adsb.lol과 AvioADSB는 콜사인, 등록번호 또는 ICAO24를 받습니다. FR24 위치 조회의 기체 필터는 IATA 편명, 콜사인 또는 등록번호입니다. FR24 운항 요약의 `hex`는 응답 필드입니다. [adsb.lol OpenAPI](https://api.adsb.lol/api/openapi.json) · [AvioADSB API](https://avioadsb.org/docs/api#endpoints) · [FR24 위치 필터](https://github.com/Flightradar24/fr24api-mcp#live-flight-data) · [AirNav OpenAPI](https://www.airnavradar.com/api/openapi) · [AirLabs 위치 조회](https://airlabs.co/docs/flights) · [FR24 운항 요약](https://fr24api.flightradar24.com/docs/endpoints/flight-summary)

공항 코드를 넣은 요청은 가능한 항공편 데이터와 공항 자체 정보를 함께 반환합니다. 공항 정보는 `result_kind: "airport_info"`와 `airport_code`로 표시합니다. 기본 공항 정보는 공개 FreeAirportDB에서 가져옵니다. 공급자를 직접 지정할 때는 `freeairportdb`를 목록에 넣어 공개 공항 정보를 받거나 `flightradar24`를 넣어 FR24 Airports Light를 함께 조회할 수 있습니다. 공급자 제외와 응답 형식 조건은 공항 정보에도 적용됩니다. [FreeAirportDB API](https://freeairportdb.com/api) · [OurAirports](https://ourairports.com/)

### 날짜와 시각으로 좁히기

공항 현지 날짜와 시각을 한 번 입력하면 각 어댑터가 공급자 형식으로 변환합니다. `fromTime`과 `toTime`에는 `06:00` 또는 `0600`을 사용할 수 있습니다. 한국 공항 코드는 `Asia/Seoul`을 사용합니다. 다른 공항의 시간대를 알고 있으면 `timeZone`에 IANA 이름을 넣습니다. 현지 시간대가 확인되면 날짜를 생략한 시각은 그곳의 오늘을 뜻합니다. 절대 시각을 알고 있으면 현지 시각 필드 대신 시간대 오프셋을 포함한 `start`와 `end`를 사용합니다.

```json
{"operation":"flight","identType":"flight_number","ident":"FX5926","airport":"ICN","direction":"arrival","date":"2026-11-25","fromTime":"06:00","toTime":"10:00"}
```

| 공급자 | 해당 시각 조건을 처리하는 방식 |
| --- | --- |
| 인천 상세 화물·여객·전체 운항 | 현지 날짜와 `HHmm`로 요청합니다. 상세 조회에서는 변경시간 기준을 선택합니다. [인천 화물 API](https://www.data.go.kr/data/15113461/openapi.do) |
| Flightradar24 | 편명 `FX5926`과 지정 날짜 전체를 Flight Summary로 조회합니다. 편명 조회에서 날짜를 생략하면 실시간 위치를 요청합니다. 편명 없이 같은 공항 시간대로 조회하면 `2026-11-24T21:00:00Z`부터 `2026-11-25T01:00:00Z`까지 Flight Summary를 요청합니다. FR24 범위의 `time_filter_basis: "first_seen"`은 첫 관측 시각입니다. [FR24 운항 요약](https://fr24api.flightradar24.com/docs/endpoints/flight-summary) |
| AirNav Radar | `arrivalFromDate`·`arrivalToDate`처럼 출도착 방향에 맞는 UTC 범위를 전송합니다. [AirNav OpenAPI](https://www.airnavradar.com/api/openapi) |
| AeroDataBox | 편명 조회에는 날짜와 출도착 기준을 사용합니다. 공항 게시판 조회에는 공항 현지 시각 범위를 사용합니다. [AeroDataBox OpenAPI](https://doc.aerodatabox.com/docs/openapi-direct-v1.json) |
| 한국공항공사 | 실시간 편명 검색과 목록은 현지 분 단위 필터를 사용합니다. 운항 스케줄은 날짜 단위로 조회합니다. [실시간 API](https://www.data.go.kr/data/15158625/openapi.do) · [스케줄 API](https://www.data.go.kr/data/15158949/openapi.do) |

FR24나 AeroDataBox의 편명 조회에서 공항의 분 단위 조건을 생략한 경우 `time_filter_note`에 실제 조회 범위를 표시합니다. 요청한 범위를 지원하지 않는 경로는 그 이유를 `unsupported_input`으로 돌려줍니다.

### 구간 조회

“인천(ICN)에서 나리타(NRT)로 가는 항공편을 보여줘.”

```json
{"operation":"airport","airport":"ICN","direction":"departure","oppositeAirport":"NRT"}
```

`departure`에서는 `airport`가 출발지, `oppositeAirport`가 도착지입니다. `arrival`에서는 두 필드의 역할이 반대입니다. 두 공항 조건을 모두 지원하는 공급자만 호출합니다. 인천공항의 상대 공항과 Aviationstack 공항에는 IATA 코드를 입력합니다. AirNav Radar의 구간 조회에는 ICAO 코드(`RKSI`, `RJAA`)와 `date` 또는 `start`·`end`가 필요합니다.

### 공항 코드 조회

“김포(GMP) 운항편을 보여줘.”

```json
{"operation":"airport","airport":"GMP"}
```

출발편은 `direction: "departure"`, 도착편은 `direction: "arrival"`로 지정합니다. 인천공항 API처럼 방향이 필수인 공급자도 있습니다. 예를 들어 “인천(ICN) 출발편을 보여줘”는 다음과 같이 요청합니다.

```json
{"operation":"airport","airport":"ICN","direction":"departure"}
```

### 기타 조회

- **실시간 위치**는 `operation: "live"`로 조회합니다. `identType`에 실제 ADS-B 콜사인의 `callsign`, 기체 등록번호의 `registration`, 6자리 기체 주소의 `icao24`를 사용합니다.
- **과거 운항 기록**은 `history`, **비행 궤적**은 `track`, **운항 스케줄**은 `schedule`을 사용합니다. 공급자별 기능과 인증 상태는 `aviation_providers`에서 확인합니다.

인천공항 전체 운항 상세는 기존 어댑터 ID `incheon_passenger`로 여객 조건을 조회합니다. 여객기 전용 상세는 `incheon_passenger_detail`입니다. 두 키를 등록하면 같은 조회에서 두 원본을 함께 반환합니다.

한국공항공사 실시간 목록(`/flight-status/info`)에는 `operation: "airport"`와 공항, 출도착 방향, 시간 조건을 사용할 수 있습니다. 지연·결항 상세(`/flight-status/detail`)는 `operation: "airport"`, `providers: ["kac_realtime_status_detail"]`과 함께 `page`, `limit`, `format`을 사용할 수 있습니다. 상세 경로에는 공항·시간·편명 필터가 없습니다. 두 경로는 `KAC_FLIGHT_STATUS_SERVICE_KEY`를 공유합니다. 편명으로 조회하는 별도 `/flight-search/info`에는 `KAC_FLIGHT_SEARCH_SERVICE_KEY`가 필요합니다.

한국공항공사 운항 일정은 `operation: "schedule"`에서 IATA 편명과 `market`(`domestic` 또는 `international`)으로 조회할 수 있습니다. 공항 기준으로 찾을 때는 해당 공항과 출도착 방향을 지정합니다. [한국공항공사 스케줄 명세](https://www.data.go.kr/data/15158949/openapi.do)

| 별도 공급자 선택 | 연결한 기능 |
| --- | --- |
| `incheon_all_cargo` | 인천 전체 운항 API의 화물 모드. `INCHEON_ALL_FLIGHTS_SERVICE_KEY`를 공유합니다. [명세](https://www.data.go.kr/data/15140153/openapi.do) |
| `kac_dated_status`, `kac_taxfree_status` | 날짜별 출도착 상세와 면세점용 여객 운항정보. `KAC_FLIGHT_STATUS_SERVICE_KEY`를 공유합니다. [명세](https://www.data.go.kr/data/15158625/openapi.do) |
| `kac_taxfree_schedule` | 국내·국제 면세점용 스케줄. `KAC_SCHEDULE_SERVICE_KEY`를 공유합니다. [명세](https://www.data.go.kr/data/15158949/openapi.do) |
| `kac_aircraft_status` | 편명 또는 등록번호의 기종·등록번호 배정 정보. 별도 데이터셋의 `KAC_AIRCRAFT_STATUS_SERVICE_KEY`가 필요합니다. [명세](https://www.data.go.kr/data/15158519/openapi.do) |
| `incheon_passenger_timetable` | ICN 출도착 방향과 상대 공항으로 찾는 계절 정기운항표. 원문의 요일과 유효일로 일정을 확인합니다. 별도 데이터셋의 `INCHEON_PASSENGER_TIMETABLE_SERVICE_KEY`가 필요합니다. [명세](https://www.data.go.kr/data/15095059/openapi.do) |

AirLabs의 과거 운항은 `api/v10/historical` 베타에서 편명과 선택적인 숫자 오프셋을 받습니다. Aviationstack Basic 이상은 날짜를 지정한 과거 운항과 IATA 공항·출도착 방향·날짜로 조회하는 미래 운항을 제공합니다. Aviationstack의 참조 카탈로그는 자동완성 결과를 제공하므로 정확한 코드가 필요한 공통 참조 조회는 해당 코드를 받는 공급자를 사용합니다. [AirLabs 과거 운항](https://airlabs.co/docs/historical) · [Aviationstack 직접 API](https://docs.apilayer.com/apilayer/docs/quickstart-guide-6) · [Aviationstack 미래 운항](https://blog.apilayer.com/flights-timetable-or-flightsfuture-which-aviationstack-endpoint-do-you-actually-need/)

FlightAware AeroAPI는 `providers: ["flightaware"]`로 조회합니다. 호출은 결과 집합에 따라 과금될 수 있습니다. OpenSky REST API를 운영 서비스에서 사용하려면 OpenSky의 사전 서면 라이선스가 필요합니다. [OpenSky 이용약관](https://opensky-network.org/about/terms-of-use)

FlightAware에서 두 공항을 지정하면 직항 구간 경로를 사용합니다. 구간 API의 시간 범위가 어느 운항 시각에 적용되는지는 명세에 없으며, 이후 페이지는 공급자가 돌려준 커서로 요청합니다. AirLabs는 편명으로 단일 편을 조회하고, 출발·도착 방향까지 지정한 공항이나 구간 조건은 해당 필터를 지원하는 실시간 스케줄에서 조회합니다. [FlightAware AeroAPI 명세](https://www.flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml) · [AirLabs 스케줄 명세](https://airlabs.co/docs/schedules)

### Flightradar24 조회

항공편 상태(`flight`), 실시간 위치(`live`), 공항·구간(`airport`), 과거 운항(`history`), 궤적(`track`)은 입력 조건과 키가 맞으면 기본 조회에 FR24 결과도 포함합니다. 날짜 없는 `flight` 조회는 현재 추적 중인 위치를 요청하며, 날짜 범위를 지정하면 운항 요약을 요청합니다.

기체 위치만 필요한 `live`와 과거 한 시점 위치 조회는 FR24 Positions Light를 사용합니다. 콜사인 또는 등록번호 한 개를 조회할 때 `limit`을 생략하면 한 건을 요청합니다. 출발·도착지나 기체 상세가 필요한 경우 FR24 전용 Positions Full 엔드포인트를 선택할 수 있습니다. [FR24 위치 엔드포인트](https://fr24api.flightradar24.com/docs/endpoints/overview)

병렬 조회는 FR24 원문을 출처가 표시된 별도 응답으로 돌려줍니다. 다른 공급자의 실시간·준실시간 기록에 빈 항목이 있으면 그대로 표시합니다. [FR24 이용약관 §6.3](https://www.flightradar24.com/terms-of-service)

FR24 결과만 필요하면 Dots에 “FR24에서만 KE703 상태 알려줘”라고 요청하거나 같은 조회에 `providers: ["flightradar24"]`를 넣습니다. 웹에서는 해당 조회 유형의 **이 공급자만 조회**에 `flightradar24`를 입력합니다. 이 선택 칸에 여러 공급자를 넣거나 `excludeProviders`로 FR24를 제외할 수도 있습니다.

공항 자체 정보, 건수 집계, 계정 사용량 등 특정 FR24 엔드포인트가 필요할 때 `operation: "fr24"`에 `fr24Endpoint`와 `fr24Params`를 넣습니다. 지정한 엔드포인트의 원본 응답을 반환합니다. [FR24 엔드포인트 문서](https://fr24api.flightradar24.com/docs/endpoints/overview)

```json
{"operation":"fr24","fr24Endpoint":"airports_light","fr24Params":{"code":"ICN"}}
```

```json
{"operation":"fr24","fr24Endpoint":"usage","fr24Params":{"period":"7d"}}
```

| 구분 | `fr24Endpoint` |
| --- | --- |
| 공항 정보 | `airports_light`, `airports_full` |
| 항공사 정보 | `airlines_light` |
| 실시간 위치·건수 | `live_positions_full`, `live_positions_light`, `live_positions_count` |
| 과거 위치·건수 | `historic_positions_full`, `historic_positions_light`, `historic_positions_count` |
| 과거 운항 이벤트·건수 | `historic_events_full`, `historic_events_light`, `historic_events_count` |
| 운항 요약·건수 | `flight_summary_full`, `flight_summary_light`, `flight_summary_count` |
| 비행 궤적 | `flight_tracks` |
| 계정 사용량 | `usage` |

`aviation_providers`의 `fr24_endpoints`에서 경로별 파라미터와 플랜별 이용 가능 여부를 확인할 수 있습니다. 목록형 필터는 `flight_ids: "3a55c027,38a384da"`처럼 쉼표로 구분합니다. 과거 위치의 `timestamp`는 Unix 초입니다. 운항 요약의 일시 범위는 UTC 기준 최대 14일이며, 항공편이 처음 관측된 시각으로 조회합니다. [FR24 운항 요약](https://fr24api.flightradar24.com/docs/endpoints/flight-summary)

웹 조회 화면에서는 **FR24 전용 엔드포인트**를 고른 뒤 해당 경로에 표시되는 파라미터를 입력합니다. 실행 후 원본 본문과 HTTP 상태, 재조회 권장 시각을 확인할 수 있습니다.

`FLIGHTRADAR24_PLAN`을 일반 변수로 설정하면 구독표에 공개된 이용 범위와 분당 요청 한도를 적용합니다.

| 설정값 | 분당 요청 | 응답당 최대 건수 | 과거 조회 |
| --- | ---: | ---: | --- |
| `explorer` | 10 | 20 | 30일 |
| `essential` | 30 | 300 | 730일 |
| `advanced` | 200 | 엔드포인트별 상한 | 엔드포인트별 제공 범위 |

플러그인은 공항 Full과 모든 Count(실시간 위치, 과거 위치, 과거 이벤트, 운항 요약)를 Essential 이상에서 호출합니다. Explorer에서 요청하면 API 호출 전에 제한을 안내합니다. 과거 이벤트 Count는 공식 구독표에 권한이 공개되지 않아 실제 플랜 권한은 FR24 응답으로 확인합니다. `fr24_id`로 과거 항공편을 요청할 때도 날짜와 권한은 FR24가 확인합니다. 플랜 설정을 생략하면 권한 판단은 FR24에 맡기고 권장 간격에는 Explorer 기본 한도를 사용합니다. Advanced의 분당 한도는 구독 비교표의 200회를 적용합니다. 별도 크레딧 가이드에는 90회로 표시되어 있습니다. [FR24 구독 비교표](https://fr24api.flightradar24.com/subscriptions-and-credits) · [FR24 크레딧 가이드](https://fr24api.flightradar24.com/docs/credit-overview)

## 응답과 재조회

- Dots는 자연어 요청을 `aviation_lookup`의 JSON 인자 객체로 변환해서 호출합니다. 확보한 원문으로 답할 수 있으면 답변하고, 판단에 영향이 있는 미확인 정보는 함께 밝히도록 안내합니다. 건너뛴 공급자에는 대기 중인 응답이 없습니다.
- 첫 MCP 텍스트 블록은 공급자별 상태와 권장 재조회 시각을 담습니다. 데이터 요청의 HTTP 응답을 받으면 상태 코드와 `Content-Type`도 포함됩니다. 읽어 온 데이터 본문은 `raw_body_content_index`가 가리키는 별도 블록에 있습니다. 인덱스는 0부터 시작합니다. OAuth 실패에서는 진단 메타데이터를 반환합니다.
- `providers`에는 조회를 건너뛴 공급자의 상태도 표시됩니다. `upstream_attempted: false`이면 인증과 데이터 요청을 모두 생략했습니다. `missing_credentials`는 필수 키가 비어 있음을, `select_individually`는 FlightAware를 따로 선택해야 함을 뜻합니다. `upstream_attempted: true`와 `data_request_attempted: false`는 OAuth 인증만 시도했음을 뜻합니다. 웹에서는 생략한 공급자를 별도로 표시합니다.
- 데이터 응답에서 플러그인이 지원하는 한도·재시도 헤더를 `quota_headers`에 담습니다. 헤더 이름은 소문자로, 값은 문자열로 전달하고 반사된 인증값은 가립니다. 대상 헤더를 받은 경우 Dots 결과와 NDJSON의 공급자별 응답에서 이 필드를 볼 수 있습니다.
- UTF-8 본문은 공백과 형식을 유지합니다. 그 외 본문은 보통 base64로 반환합니다. 본문에 반사된 인증값을 마스킹한 경우 `credential_redacted`를 표시하며, UTF-8로 해석할 수 없어 마스킹 후 텍스트를 반환했다면 `raw_body_encoding`은 `decoded_and_credential_redacted`입니다. 플러그인은 본문과 조회 조건을 저장하거나 캐시하지 않습니다.
- `recommended_next_at`은 공급자별 권장 시각, `recommended_next_lookup_at`은 그중 가장 이른 시각입니다. 호환 필드인 `next_allowed_at`, `next_lookup_at`과 함께 값이 있으면 `2026-11-25T03:00:00.000+0000` 형식으로 표시됩니다. 계산할 시각이 없으면 `null`을 반환합니다.
- 권장 시각은 정기 조회와 동일 조건 재시도에 참고합니다. 같은 항공편의 상태, 위치, 궤적처럼 각각 필요한 정보를 묻는 후속 요청은 이어서 실행할 수 있습니다. 데이터 API가 `429` 등으로 응답하면 해당 HTTP 상태와 읽을 수 있는 응답 본문을 반환합니다.
- Dots는 읽어 온 공급자별 원문을 최종 MCP 결과에 함께 받습니다. SSE와 진행 토큰을 지원하는 MCP 클라이언트에는 공급자별 완료 알림을 보냅니다.
- Dots는 읽어 온 원문을 최종 도구 결과에서 받습니다. 비공개 Site의 조회 화면은 공급자별 원문을 도착 즉시 표시합니다. Site에 로그인한 상태에서 `POST /lookup/stream`에 `Content-Type: application/json`과 `aviation_lookup` 인자를 보내면 NDJSON을 받을 수 있습니다. `Origin`을 보내면 Site와 같아야 합니다. `provider`에는 공급자 결과와 읽어 온 원문, `complete`에는 전체 상태, `error`에는 조회 오류가 담깁니다.
- OpenSky OAuth에 실패하면 `authorization_diagnostic`과 `authorization_elapsed_ms`로 실패 유형과 경과 시간을 확인할 수 있습니다. 토큰 서버 연결에서 받은 HTTP 522는 `oauth_origin_connection_timeout`으로 표시됩니다. Cloudflare가 진단 헤더를 보내면 `authorization_response_headers`에 담습니다. [Cloudflare HTTP 522](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-522/)

<details>
<summary>공급자별 잔여량과 사용량</summary>

| 공급자 | 공식 문서에서 확인한 제공 방식 |
| --- | --- |
| OpenSky Network | `X-Rate-Limit-Remaining`은 조회한 버킷(states, tracks, flights)의 잔여 크레딧입니다. 한도 소진 시 `X-Rate-Limit-Retry-After-Seconds`의 대기 시간을 권장 시각에 반영합니다. [OpenSky API 문서](https://openskynetwork.github.io/opensky-api/rest.html#api-credits) |
| AvioADSB | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Policy`, `X-AvioADSB-Tier`를 읽습니다. `Reset`의 단위는 리셋까지 남은 초입니다. HTTP 429의 `Retry-After`는 권장 시각에 반영합니다. [AvioADSB 헤더 문서](https://avioadsb.org/docs/api#headers) |
| adsb.lol | 한도 초과 시 `Retry-After`를 제공합니다. 공식 문서에서 잔여량 헤더는 확인되지 않았습니다. [adsb.lol 한도 문서](https://www.adsb.lol/docs/open-data/api#limits) |
| Aviationstack | APILayer Marketplace의 `X-RateLimit-Limit-Day`, `X-RateLimit-Remaining-Day`와 월간 대응 헤더는 실제 응답에 있을 때 전달합니다. 현재 연결한 직접 API 문서에는 한도 초과 오류 코드가 나옵니다. [APILayer 한도](https://marketplace.apilayer.com/docs/article/rate-limits) · [Aviationstack 직접 API](https://docs.apilayer.com/apilayer/docs/getting-started-10) |
| AirNav Radar | 원본 JSON의 `cost`는 이번 조회의 소모량이며 `charged_credits`에도 표시합니다. 계정 잔여량은 별도 `/v2/billing/status`에 나옵니다. [AirNav Radar OpenAPI](https://www.airnavradar.com/api/openapi) |
| FlightAware / AeroDataBox Direct | FlightAware는 별도 `/account/usage`에서 집계 사용량을, AeroDataBox Direct는 계정 대시보드에서 한도를 제공합니다. [FlightAware 사용량 안내](https://support.flightaware.com/hc/en-us/articles/32551385660055-How-Do-I-Check-My-API-Usage) · [AeroDataBox Direct](https://aerodatabox.com/direct-subscriptions) |

AirLabs와 공공데이터포털에서 받은 한도 오류 코드는 원본 본문에 남습니다. `aviation_lookup`의 한도 정보는 같은 조회 응답에서 가져옵니다. [AirLabs API 문서](https://airlabs.co/docs/) · [공공데이터포털 한국공항공사 API](https://www.data.go.kr/data/15158625/openapi.do)

</details>

<details>
<summary>공급자별 요청 경로와 인증 방식</summary>

| 어댑터 ID | 구현한 요청 | 인증 방식 |
| --- | --- | --- |
| `adsb_fi` | `GET /api/v2/{hex,callsign,registration}/{id}` | 공개 |
| `adsb_lol` | `GET /v2/{hex,callsign,reg}/{id}`, `GET /1/trace/full/{icao24}`. 궤적 경로는 공급자 OpenAPI에서 확인했습니다. | 이 플러그인에서 `X-API-Key` 헤더 필수 |
| `avioadsb` | `GET /v1/{hex,callsign,reg}/{id}` | 선택 `X-API-Key` 헤더 |
| `adsb_aero` | `POST /api/v1/query`, `GET /api/v1/flights/{flight_id}` | 공개 |
| `opensky` | `GET /api/states/all`, `/api/tracks/all`, `/api/flights/{aircraft,arrival,departure}` | OAuth |
| `flightaware` | 항공편·위치·궤적·이력과 공항 운항편·직항 구간 `GET` | `x-apikey` 헤더 |
| `flightradar24` | 공항·항공사·실시간 및 과거 위치·이벤트·운항 요약·궤적·사용량 `GET` 17종 | Bearer API 키와 `Accept-Version: v1` |
| `aerodatabox` | `/flights/{number,callsign,reg,icao24}/…`, `/flights/airports/…` `GET` | `X-API-Key` 헤더 |
| `airnavradar` | `POST /v2/flights/live`, `POST /v2/flights/search`, `GET /v2/flights/schedules`, `/v2/aircraft`, `/v2/airports/{code}` | Bearer 토큰 |
| `kac_schedule` | `GET /B551178/flight-schedule/{dom,int}` | `serviceKey` 쿼리 |
| `kac_flight_status` | `GET /B551178/flight-search/info` | `serviceKey` 쿼리 |
| `kac_realtime_status` | `GET /B551178/flight-status/info` | `serviceKey` 쿼리 |
| `kac_realtime_status_detail` | `GET /B551178/flight-status/detail` | `serviceKey` 쿼리 |
| `incheon_cargo_today` | `GET /B551177/StatusOfCargoFlights/getCargo{Arrivals,Departures}` | `serviceKey` 쿼리 |
| `incheon_cargo` | `GET /B551177/StatusOfCargoFlightsDeOdp/getCargo{Arrivals,Departures}DeOdp` | `serviceKey` 쿼리 |
| `incheon_passenger` | `GET /B551177/statusOfAllFltDeOdp/getFlt{Arrivals,Departures}DeOdp`, 공급자 기본 여객 필터 사용 | `serviceKey` 쿼리 |
| `incheon_passenger_detail` | `GET /B551177/StatusOfPassengerFlightsDeOdp/getPassenger{Arrivals,Departures}DeOdp` | `serviceKey` 쿼리 |
| `airlabs` | `GET /api/v9/{flight,flights,schedules,fleets,airports,airlines}`, `GET /api/v10/historical` | `api_key` 쿼리 |
| `aviationstack` | 실시간·날짜별 과거 `GET /aviationstack/v1/flights`, 미래 `GET /aviationstack/v1/flightsFuture` | `access_key` 쿼리 |

공공데이터포털 어댑터는 기본으로 JSON을 요청하며, `format: "xml"`로 XML을 선택할 수 있습니다. 인수인계의 ADS-B Exchange, Airplanes.live, 피더 IP 전용 API는 구현 범위 밖입니다. [추적 API 코드](src/tracking-providers.js) · [공항·스케줄 API 코드](src/schedule-providers.js) · [AirNav Radar 코드](src/airnav-provider.js) · [Flightradar24 코드](src/flightradar24-provider.js)

</details>

<details>
<summary>플랜별 권장 간격 설정</summary>

- **adsb.lol**은 키 등급에 맞춰 `ADSB_LOL_TIER`를 `adhoc` 또는 `feeder`로 설정할 수 있습니다.
- **OpenSky**의 확인된 계정 등급에 맞춰 `OPENSKY_CREDIT_TIER`를 `feeder` 또는 `licensed`로 설정할 수 있습니다. **AeroDataBox Direct**의 확인된 월간 단위 한도는 `AERODATABOX_MONTHLY_UNITS`에 넣습니다.
- **FlightAware** 고급 이력 경로를 사용할 자격이 있으면 `FLIGHTAWARE_HISTORY=true`로 설정합니다.
- **Flightradar24**는 콜사인 또는 등록번호 하나로 위치를 찾는 경우 기본 1건, 그 밖의 일반 조회에서 `limit`을 지원하면 기본 최대 10건을 요청합니다. 보너스·충전분을 포함해 앞으로 31일 동안 쓸 크레딧을 정했다면 일반 변수 `FLIGHTRADAR24_MONTHLY_CREDITS`에 양의 정수로 넣을 수 있습니다. 이 값은 차감량의 상한을 구할 수 있는 조회의 권장 간격에만 반영됩니다. 값이 비어 있으면 분당 요청 한도로 권장 간격을 계산합니다. `usage`는 이미 사용한 크레딧을 집계하며 공급자 기준 분당 1회입니다. [Flightradar24 크레딧 문서](https://fr24api.flightradar24.com/docs/credit-overview)
- **AirNav Radar**는 플러그인에서 100크레딧을 31일에 나눠 쓰는 기준으로 1크레딧당 7시간 26분 24초를 권장합니다. 검색 쿼리에는 페이지당 1건을 요청하고 경로 좌표를 제외합니다. 응답의 `cost`가 1보다 크면 권장 간격을 늘립니다. 실제 계정의 청구 주기는 공급자의 `/v2/billing/status`에서 확인할 수 있습니다. [AirNav OpenAPI](https://www.airnavradar.com/api/openapi)
- `AVIATION_RATE_LIMITS`에는 공급자 ID 또는 더 구체적인 `quota_bucket`을 키로 하여 한도를 입력합니다. 예를 들어 인천공항 상세 화물 API 운영계정의 승인 한도가 10만 회/일이면 `{"incheon_cargo":[{"requests":100000,"windowMs":86400000}]}`으로 설정합니다. `windowMs`는 밀리초입니다. `requests`는 보통 호출 수입니다. OpenSky와 AeroDataBox처럼 비용을 별도로 계산하는 어댑터는 해당 단위 수를 넣습니다. Flightradar24의 이 설정은 이미 크레딧을 환산한 호출 수로 입력합니다.

</details>

## 배포 검증 기록

- **2026-11-25 실호출**. adsb.lol과 AvioADSB의 Dots 실시간 요청은 HTTP 200을 받았고, 예시 기체의 조회 결과는 비어 있었습니다. AirNav Radar는 편명 `KE703`과 `RKSI`에서 `RJAA`로 가는 구간을 함께 검색해 HTTP 200과 일치하는 결과 1건을 반환했습니다. 테스트에서 1크레딧이 차감됐습니다.
- AeroDataBox는 공급자의 크레딧 부족 오류인 HTTP 402를 반환했습니다. OpenSky는 같은 인증값으로 공급자에 직접 요청하면 토큰 발급과 데이터 요청이 HTTP 200이었으며, Dots 배포의 토큰 발급 단계에서는 `authorization_failed`가 반환됐습니다.
- **2026-11-25 OpenSky 연결 재확인**. Dots가 쓰는 Sites Worker에서 공개 OpenID 설정, 키 없는 토큰 요청, 익명 위치 조회가 모두 약 19.5초에 Cloudflare HTTP 522를 반환했습니다. Worker 외부에서는 공개 OpenID 설정이 HTTP 200, 키 없는 토큰 요청이 HTTP 401 `invalid_client`였습니다. Dots 경로에서는 데이터 응답까지 도달하지 않아 계정의 실제 `X-Rate-Limit-Remaining`을 확인하지 못했습니다. [OpenSky REST 인증 문서](https://openskynetwork.github.io/opensky-api/rest.html#authentication) · [Cloudflare 522 문서](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-522/)
- **2026-11-25 Flightradar24**. 17개 경로의 요청 형식과 원본 반환, 플랜별 제한을 모의 테스트로 확인했습니다. 과거 이벤트 Count 경로는 FR24 서버가 키 없는 요청에 HTTP 401을 반환했습니다.
- 초기 배포에서는 Dots의 adsb.aero 과거편 조회와 권장 시각 전 재조회가 모두 HTTP 200이었습니다. 초기 실시간 조회에서 adsb.fi는 403, adsb.lol과 AvioADSB는 429를 반환했습니다. 공공데이터포털의 JSON/XML 요청 형식은 모의 키로 검증했습니다.

## 로컬 검증

Node.js와 npm을 사용합니다. 테스트는 공급자 응답을 모의하며 실제 API 호출이 없습니다. 빌드 결과는 `dist/server/`에 생성됩니다.

```sh
npm test
npm run build
```

저장소에는 값이 비어 있는 `.env.example`을 둡니다. 로컬 `.env` 파일과 OpenSky에서 내려받은 `credentials.json`은 Git 무시 대상입니다. [Sites 배포 설정](.openai/hosting.json)에는 이 프로젝트의 기존 비공개 Site 연결 정보가 들어 있습니다.
