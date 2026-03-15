# Miami-Dade Clerk Developers API Extraction

- Source: `https://www2.miamidadeclerk.gov/Developers/Help`
- Base URL prefix: `https://www2.miamidadeclerk.gov/Developers/`
- Note: Please precede your API call with the secure web URL www2.miamidadeclerk.gov/Developers/
- Extracted (UTC): `2026-02-17T12:30:36.190785+00:00`
- Total endpoints found: `12`

## Endpoint Catalog

| Category | Endpoint |
|---|---|
| Civil | `GET api/Civil?caseNumber={caseNumber}&AuthKey={AuthKey}` |
| Civil | `GET api/Civil?civilCaseNumber={civilCaseNumber}&AuthKey={AuthKey}` |
| Civil | `GET api/Civil?caseNumber={caseNumber}&docketNumber={docketNumber}&AuthKey={AuthKey}` |
| OfficialRecords | `GET api/OfficialRecords?parameter1={parameter1}&parameter2={parameter2}&authKey={authKey}` |
| Criminal | `GET api/Criminal?CaseNumber={CaseNumber}&AuthKey={AuthKey}` |
| FTPapi | `GET api/FTPapi?fileName={fileName}&folderName={folderName}&AuthKey={AuthKey}` |
| FTPapi | `GET api/FTPapi?folderName={folderName}&AuthKey={AuthKey}` |
| FTPapi | `GET api/FTPapi?folderListName={folderListName}&AuthKey={AuthKey}` |
| TrafficWeb | `GET api/TrafficWeb?CaseNumber={CaseNumber}&AuthKey={AuthKey}` |
| TrafficWeb | `GET api/TrafficWeb?DL={DL}&AuthKey={AuthKey}` |
| ParkingWeb | `GET api/ParkingWeb?citationNumber={citationNumber}&AuthKey={AuthKey}` |
| ParkingWeb | `GET api/ParkingWeb?tag={tag}&state={state}&AuthKey={AuthKey}` |

## Endpoint Details

### GET api/Civil?caseNumber={caseNumber}&AuthKey={AuthKey}

- Category: `Civil`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-Civil_caseNumber_AuthKey`
- Description: Get civil case information by case number. Your Developer account must be enabled and contain units.
- URI parameters:
  - `caseNumber` (required) — Alpha Numeric
  - `AuthKey` (required) — Your Developer Key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/Civil?civilCaseNumber={civilCaseNumber}&AuthKey={AuthKey}

- Category: `Civil`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-Civil_civilCaseNumber_AuthKey`
- Description: Get civil case dockets, associated with an image, by case number. Your Developer account must be enabled and contain units.
- URI parameters:
  - `civilCaseNumber` (required) — Alpha Numeric
  - `AuthKey` (required) — Your Developer Key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/Civil?caseNumber={caseNumber}&docketNumber={docketNumber}&AuthKey={AuthKey}

- Category: `Civil`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-Civil_caseNumber_docketNumber_AuthKey`
- Description: Get civil case documents (images) by case number and docket number. Your Developer account must be enabled and contain units.
- URI parameters:
  - `caseNumber` (required) — Alpha Numeric
  - `docketNumber` (required) — Numeric
  - `AuthKey` (required) — Your Developer Key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/OfficialRecords?parameter1={parameter1}&parameter2={parameter2}&authKey={authKey}

- Category: `OfficialRecords`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-OfficialRecords_parameter1_parameter2_authKey`
- Description: Your Developer account must be enabled and contain units.
- URI parameters:
  - `parameter1` (required) — Alpha Numeric [MAX 25 DIGITS] - [MIN 1 DIGIT] If using CFN parameter1 = CFN YEAR in 4 digit year format Example: 1985 If using BOOK and PAGE parameter1 = BOOK in 4 digit format Example: 2005 If using FOLIO NUMBER parameter1 = FOLIO_NUMBER in 25 or less digit format Example: 1234567891011
  - `parameter2` (required) — String If using CFN parameter2 = Letter "R" + CFN SQN Example: R123456789 If using BOOK and PAGE parameter2 = PAGE Example: 22471 If using FOLIO NUMBER parameter2 must be = "FN" Example: FN
  - `authKey` (required) — Your Developer Key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/Criminal?CaseNumber={CaseNumber}&AuthKey={AuthKey}

- Category: `Criminal`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-Criminal_CaseNumber_AuthKey`
- Description: Please note that in addition to criminal charges such as felonies and misdemeanors, our system also includes civil infractions and municipal ordinances that are not considered criminal offenses. Your Developer account must be enabled and contain units.
- URI parameters:
  - `CaseNumber` (required) — F: Felony M: Misdemeanor, Civil Infraction, Municipal Ordinance Violation B: Misdemeanor, Civil Infraction, Municipal Ordinance Violation heard in a Branch Court Example: M12345678
  - `AuthKey` (required) — Your Developer Key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
  - `CaseData`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/FTPapi?fileName={fileName}&folderName={folderName}&AuthKey={AuthKey}

- Category: `FTPapi`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-FTPapi_fileName_folderName_AuthKey`
- Description: Get FTP File. A valid folder subscription is required.
- URI parameters:
  - `fileName` (required) — File Name
  - `folderName` (required) — Folder Name
  - `AuthKey` (required) — Authorization key
- Body parameters: None.
- Top-level response fields:
  - `Version`
  - `Content`
  - `StatusCode`
  - `ReasonPhrase`
  - `Headers`
  - `RequestMessage`
  - `IsSuccessStatusCode`
- Response formats: `not listed`

### GET api/FTPapi?folderName={folderName}&AuthKey={AuthKey}

- Category: `FTPapi`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-FTPapi_folderName_AuthKey`
- Description: Download Folder Content. A valid folder subscription is required.
- URI parameters:
  - `folderName` (required) — Folder Name
  - `AuthKey` (required) — Authorization Key
- Body parameters: None.
- Top-level response fields:
  - `Version`
  - `Content`
  - `StatusCode`
  - `ReasonPhrase`
  - `Headers`
  - `RequestMessage`
  - `IsSuccessStatusCode`
- Response formats: `not listed`

### GET api/FTPapi?folderListName={folderListName}&AuthKey={AuthKey}

- Category: `FTPapi`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-FTPapi_folderListName_AuthKey`
- Description: Get Folder Files List. A valid folder subscription is required.
- URI parameters:
  - `folderListName` (required) — Folder Name
  - `AuthKey` (required) — Authorization key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/TrafficWeb?CaseNumber={CaseNumber}&AuthKey={AuthKey}

- Category: `TrafficWeb`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-TrafficWeb_CaseNumber_AuthKey`
- Description: Your Developer account must be enabled and contain units.
- URI parameters:
  - `CaseNumber` (required) — Alpha Numeric
  - `AuthKey` (required) — Your Developer Key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/TrafficWeb?DL={DL}&AuthKey={AuthKey}

- Category: `TrafficWeb`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-TrafficWeb_DL_AuthKey`
- Description: Your Developer account must be enabled and contain units.
- URI parameters:
  - `DL` (required) — [ Drivers License with Dashes]
  - `AuthKey` (required) — Authorization Key
- Body parameters: None.
- Top-level response fields:
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/ParkingWeb?citationNumber={citationNumber}&AuthKey={AuthKey}

- Category: `ParkingWeb`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-ParkingWeb_citationNumber_AuthKey`
- Description: Your Developer account must be enabled and contain units.
- URI parameters:
  - `citationNumber` (required) — Alpha Numeric
  - `AuthKey` (required) — Your Developer Key
- Body parameters: None.
- Top-level response fields:
  - `ParkingCitation`
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`

### GET api/ParkingWeb?tag={tag}&state={state}&AuthKey={AuthKey}

- Category: `ParkingWeb`
- Detail page: `https://www2.miamidadeclerk.gov/Developers/Help/Api/GET-api-ParkingWeb_tag_state_AuthKey`
- Description: Your Developer account must be enabled and contain units.
- URI parameters:
  - `tag` (required) — [Tag Number]
  - `state` (required) — [Tag's State]
  - `AuthKey` (required) — Authorization Key
- Body parameters: None.
- Top-level response fields:
  - `ParkingCitation`
  - `Status`
  - `StatusDesc`
  - `UnitsBalance`
  - `IPAddress`
- Response formats: `application/json, text/json`, `application/xml, text/xml`
