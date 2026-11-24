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
| [한국공항공사_실시간 항공기 운항정보 조회_GW (15158625)](https://www.data.go.kr/data/15158625/openapi.do) | `KAC_FLIGHT_STATUS_SERVICE_KEY` |
| [인천국제공항공사_화물편 운항현황(다국어) (15095068)](https://www.data.go.kr/data/15095068/openapi.do) | `INCHEON_CARGO_TODAY_SERVICE_KEY` |
| [한국공항공사_실시간 항공기 운항정보 검색_GW (15160195)](https://www.data.go.kr/data/15160195/openapi.do) | `KAC_FLIGHT_SEARCH_SERVICE_KEY` |
| [한국공항공사_항공기 운항 스케줄 정보_GW (15158949)](https://www.data.go.kr/data/15158949/openapi.do) | `KAC_SCHEDULE_SERVICE_KEY` |

### 키 없이 호출할 수 있는 API

- **adsb.fi, adsb.aero**는 공개 API를 사용합니다.
- **AvioADSB**는 무키로도 호출합니다. 보유한 키가 있으면 `AVIOADSB_API_KEY`를 선택적으로 등록할 수 있습니다.

## 조회 방법

Dots에서는 질문당 `aviation_lookup`을 한 번 호출합니다. `providers`를 생략하면 일반 조회 대상 중 요청 조건과 키 설정이 맞는 공급자에 병렬로 요청하고 완료 순서대로 결과를 모읍니다. FlightAware와 Flightradar24는 각각 명시적으로 단독 선택합니다. 최종 종합과 판단은 Dots 에이전트가 담당합니다.

| 도구 | 용도 |
| --- | --- |
| `aviation_providers` | 공급자별 기능, 인증 준비 상태, 조회 간격 확인 |
| `aviation_lookup` | 조건에 맞는 공급자를 조회하고 공급자별 원본 본문과 다음 조회 권장 시각 반환 |

편명, 구간, 공항 코드는 각각 독립적으로 조회할 수 있습니다. Dots에는 아래 예시처럼 자연어로 요청하면 됩니다. JSON은 `aviation_lookup`에 전달되는 인자 예시입니다.

### 편명 조회

“KE703 상태 알려줘.”

```json
{"operation":"flight","identType":"flight_number","ident":"KE703"}
```

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

FlightAware AeroAPI는 `providers: ["flightaware"]`로 조회합니다. 호출은 결과 집합에 따라 과금될 수 있습니다. OpenSky REST API를 운영 서비스에서 사용하려면 OpenSky의 사전 서면 라이선스가 필요합니다. [OpenSky 이용약관](https://opensky-network.org/about/terms-of-use)

Flightradar24 이용약관에 따라 `providers: ["flightradar24"]`로 단독 조회합니다. 편명·콜사인·등록번호, 공항, 구간으로 현재 추적 중인 항공편의 위치를 조회할 수 있습니다. 과거 운항 요약은 항공편이 처음 관측된 UTC 날짜 또는 최대 14일의 범위를 사용합니다. `history`에 `start`만 주면 해당 시각의 과거 위치를 요청합니다. `track`은 응답의 `fr24_id`를 `identType: "provider_id"`로 입력해 조회합니다. 기능과 조회 기간은 API 플랜에 따라 달라집니다. [Flightradar24 API](https://fr24api.flightradar24.com/docs/endpoints/overview) · [운항 요약](https://fr24api.flightradar24.com/docs/endpoints/flight-summary) · [이용약관](https://www.flightradar24.com/terms-of-service)

## 응답과 재조회

- 첫 MCP 텍스트 블록은 공급자별 상태와 권장 재조회 시각을 담습니다. 데이터 요청의 HTTP 응답을 받으면 상태 코드와 `Content-Type`도 포함됩니다. 읽어 온 데이터 본문은 `raw_body_content_index`가 가리키는 별도 블록에 있습니다. 인덱스는 0부터 시작합니다. OAuth 실패에서는 진단 메타데이터를 반환합니다.
- 데이터 응답에서 플러그인이 지원하는 한도·재시도 헤더를 `quota_headers`에 담습니다. 헤더 이름은 소문자로, 값은 문자열로 전달하고 반사된 인증값은 가립니다. 대상 헤더를 받은 경우 Dots 결과와 NDJSON의 공급자별 응답에서 이 필드를 볼 수 있습니다.
- UTF-8 본문은 공백과 형식을 유지합니다. 그 외 본문은 보통 base64로 반환합니다. 본문에 반사된 인증값을 마스킹한 경우 `credential_redacted`를 표시하며, UTF-8로 해석할 수 없어 마스킹 후 텍스트를 반환했다면 `raw_body_encoding`은 `decoded_and_credential_redacted`입니다. 플러그인은 본문과 조회 조건을 저장하거나 캐시하지 않습니다.
- `recommended_next_at`은 공급자별 권장 시각, `recommended_next_lookup_at`은 그중 가장 이른 시각입니다. 호환 필드인 `next_allowed_at`, `next_lookup_at`과 함께 값이 있으면 `2026-11-25T03:00:00.000+0000` 형식으로 표시됩니다. 계산할 시각이 없으면 `null`을 반환합니다.
- 권장 시각 전에도 요청은 공급자에게 전달됩니다. 데이터 API가 `429` 등으로 응답하면 해당 HTTP 상태와 읽을 수 있는 응답 본문을 반환합니다.
- Dots는 읽어 온 공급자별 원문을 최종 MCP 결과에 함께 받습니다. SSE와 진행 토큰을 지원하는 MCP 클라이언트에는 공급자별 완료 알림을 보냅니다.
- 비공개 Site의 조회 화면에서는 읽어 온 원문을 응답이 끝나는 순서대로 표시합니다. Site에 로그인한 상태에서 `POST /lookup/stream`에 `Content-Type: application/json`과 `aviation_lookup` 인자를 보내면 NDJSON을 받을 수 있습니다. `Origin`을 보내면 Site와 같아야 합니다. `provider`에는 공급자 결과와 읽어 온 원문, `complete`에는 전체 상태, `error`에는 조회 오류가 담깁니다.
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
| `adsb_lol` | `GET /v2/{hex,callsign,reg}/{id}`. 코드는 궤적 조회 시 `GET /1/trace/full/{icao24}`도 시도합니다. 궤적 경로는 공식 문서와 실호출 검증이 필요합니다. | 이 플러그인에서 `X-API-Key` 헤더 필수 |
| `avioadsb` | `GET /v1/{hex,callsign,reg}/{id}` | 선택 `X-API-Key` 헤더 |
| `adsb_aero` | `POST /api/v1/query`, `GET /api/v1/flights/{flight_id}` | 공개 |
| `opensky` | `GET /api/states/all`, `/api/tracks/all`, `/api/flights/{aircraft,arrival,departure}` | OAuth |
| `flightaware` | 항공편·위치·궤적·이력과 공항 운항편 `GET` | `x-apikey` 헤더 |
| `flightradar24` | `GET /api/live/flight-positions/full`, `/api/historic/flight-positions/full`, `/api/flight-summary/light`, `/api/flight-tracks` | Bearer API 키와 `Accept-Version: v1` |
| `aerodatabox` | `/flights/{number,callsign,reg,icao24}/…`, `/flights/airports/…` `GET` | `X-API-Key` 헤더 |
| `airnavradar` | `POST /v2/flights/live`, `POST /v2/flights/search` | Bearer 토큰 |
| `kac_schedule` | `GET /B551178/flight-schedule/{dom,int}` | `serviceKey` 쿼리 |
| `kac_flight_status` | `GET /B551178/flight-search/info` | `serviceKey` 쿼리 |
| `kac_realtime_status` | `GET /B551178/flight-status/info` | `serviceKey` 쿼리 |
| `kac_realtime_status_detail` | `GET /B551178/flight-status/detail` | `serviceKey` 쿼리 |
| `incheon_cargo_today` | `GET /B551177/StatusOfCargoFlights/getCargo{Arrivals,Departures}` | `serviceKey` 쿼리 |
| `incheon_cargo` | `GET /B551177/StatusOfCargoFlightsDeOdp/getCargo{Arrivals,Departures}DeOdp` | `serviceKey` 쿼리 |
| `incheon_passenger` | `GET /B551177/statusOfAllFltDeOdp/getFlt{Arrivals,Departures}DeOdp`, `passengerOrCargo=P` | `serviceKey` 쿼리 |
| `incheon_passenger_detail` | `GET /B551177/StatusOfPassengerFlightsDeOdp/getPassenger{Arrivals,Departures}DeOdp` | `serviceKey` 쿼리 |
| `airlabs` | `GET /api/v9/flight`, `GET /api/v9/schedules` | `api_key` 쿼리 |
| `aviationstack` | 실시간 `GET /aviationstack/v1/flights` | `access_key` 쿼리 |

공공데이터포털 어댑터는 기본으로 JSON을 요청하며, `format: "xml"`로 XML을 선택할 수 있습니다. 인수인계의 ADS-B Exchange, Airplanes.live, 피더 IP 전용 API는 구현 범위 밖입니다. [추적 API 코드](src/tracking-providers.js) · [공항·스케줄 API 코드](src/schedule-providers.js) · [AirNav Radar 코드](src/airnav-provider.js) · [Flightradar24 코드](src/flightradar24-provider.js)

</details>

<details>
<summary>플랜별 권장 간격 설정</summary>

- **adsb.lol**은 키 등급에 맞춰 `ADSB_LOL_TIER`를 `adhoc` 또는 `feeder`로 설정할 수 있습니다.
- **OpenSky**의 확인된 계정 등급에 맞춰 `OPENSKY_CREDIT_TIER`를 `feeder` 또는 `licensed`로 설정할 수 있습니다. **AeroDataBox Direct**의 확인된 월간 단위 한도는 `AERODATABOX_MONTHLY_UNITS`에 넣습니다.
- **FlightAware** 고급 이력 경로를 사용할 자격이 있으면 `FLIGHTAWARE_HISTORY=true`로 설정합니다.
- **Flightradar24**는 여러 건을 반환하는 조회에서 기본 최대 결과 10건을 요청합니다. Explorer의 기본 분당 10회와 월간 30,000크레딧에 결과별 최대 차감량을 적용해 권장 간격을 계산합니다. 계정 사용량은 공급자의 별도 `/api/usage`에서 확인할 수 있습니다. [Flightradar24 크레딧 문서](https://fr24api.flightradar24.com/docs/credit-overview)
- **AirNav Radar**는 플러그인에서 100크레딧을 31일에 나눠 쓰는 기준으로 1크레딧당 7시간 26분 24초를 권장합니다. 검색은 페이지당 1건을 요청하며, 응답의 `cost`가 1보다 크면 권장 간격을 늘립니다. 실제 계정의 청구 주기는 공급자의 `/v2/billing/status`에서 확인할 수 있습니다.
- `AVIATION_RATE_LIMITS`에는 공급자 ID 또는 더 구체적인 `quota_bucket`을 키로 하여 한도를 입력합니다. 예를 들어 인천공항 상세 화물 API 운영계정의 승인 한도가 10만 회/일이면 `{"incheon_cargo":[{"requests":100000,"windowMs":86400000}]}`으로 설정합니다. `windowMs`는 밀리초입니다. `requests`는 보통 호출 수입니다. OpenSky와 AeroDataBox처럼 비용을 별도로 계산하는 어댑터는 해당 단위 수를 넣습니다. Flightradar24의 이 설정은 이미 크레딧을 환산한 호출 수로 입력합니다.

</details>

## 배포 검증 기록

- **2026-11-25 실호출**. adsb.lol과 AvioADSB의 Dots 실시간 요청은 HTTP 200을 받았고, 예시 기체의 조회 결과는 비어 있었습니다. AirNav Radar는 편명 `KE703`과 `RKSI`에서 `RJAA`로 가는 구간을 함께 검색해 HTTP 200과 일치하는 결과 1건을 반환했습니다. 테스트에서 1크레딧이 차감됐습니다.
- AeroDataBox는 공급자의 크레딧 부족 오류인 HTTP 402를 반환했습니다. OpenSky는 같은 인증값으로 공급자에 직접 요청하면 토큰 발급과 데이터 요청이 HTTP 200이었으며, Dots 배포의 토큰 발급 단계에서는 `authorization_failed`가 반환됐습니다.
- **2026-11-25 OpenSky 연결 재확인**. Dots가 쓰는 Sites Worker에서 공개 OpenID 설정, 키 없는 토큰 요청, 익명 위치 조회가 모두 약 19.5초에 Cloudflare HTTP 522를 반환했습니다. Worker 외부에서는 공개 OpenID 설정이 HTTP 200, 키 없는 토큰 요청이 HTTP 401 `invalid_client`였습니다. Dots 경로에서는 데이터 응답까지 도달하지 않아 계정의 실제 `X-Rate-Limit-Remaining`을 확인하지 못했습니다. [OpenSky REST 인증 문서](https://openskynetwork.github.io/opensky-api/rest.html#authentication) · [Cloudflare 522 문서](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-522/)
- **2026-11-25 Flightradar24**. 요청 형식과 원본 반환은 모의 테스트로 확인했습니다.
- 초기 배포에서는 Dots의 adsb.aero 과거편 조회와 권장 시각 전 재조회가 모두 HTTP 200이었습니다. 초기 실시간 조회에서 adsb.fi는 403, adsb.lol과 AvioADSB는 429를 반환했습니다. 공공데이터포털의 JSON/XML 요청 형식은 모의 키로 검증했습니다.

## 로컬 검증

Node.js와 npm을 사용합니다. 테스트는 공급자 응답을 모의하며 실제 API 호출이 없습니다. 빌드 결과는 `dist/server/`에 생성됩니다.

```sh
npm test
npm run build
```

저장소에는 값이 비어 있는 `.env.example`을 둡니다. 로컬 `.env` 파일과 OpenSky에서 내려받은 `credentials.json`은 Git 무시 대상입니다. [Sites 배포 설정](.openai/hosting.json)에는 이 프로젝트의 기존 비공개 Site 연결 정보가 들어 있습니다.
