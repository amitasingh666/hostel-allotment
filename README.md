# Hostel Seat Allotment Service

A backend service where college students log in and book a seat in a hostel room. Each hostel serves one academic year and one gender; each room has a fixed number of seats.

The central requirement is that every rule holds when requests arrive at the same instant, even across several app processes sharing one database. All of that correctness lives in PostgreSQL (transactions, row locks and constraints). Nothing depends on a lock held in Node's memory.

**Stack:** Node.js 20, Express 5, PostgreSQL 16 (in Docker), `pg`, `bcrypt`, `jsonwebtoken`. There is no UI; the API is used with Postman or `curl`.

## Contents

1. [Setup](#setup)
2. [How the app connects to the database](#how-the-app-connects-to-the-database)
3. [Seeded data and logins](#seeded-data-and-logins)
4. [API](#api)
5. [How each rule is enforced and verified](#how-each-rule-is-enforced-and-verified)
6. [Demonstrating concurrency with two app instances](#demonstrating-concurrency-with-two-app-instances)
7. [Project structure](#project-structure)

## Setup

**Prerequisites:** Node.js 20 or later, and Docker Desktop running.

```bash
# 1. Create your settings file (on Windows cmd/PowerShell: copy .env.example .env)
cp .env.example .env

# 2. Start PostgreSQL
docker compose up -d

# 3. Install dependencies
npm install

# 4. Create the tables
npm run db:schema

# 5. Insert the test data
npm run db:seed

# 6. Start the app (http://localhost:3000)
npm run dev
```

Check it is running: `GET http://localhost:3000/health` returns `{"status":"ok","db":"connected"}`.

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app with auto-restart on file changes. |
| `npm start` | Starts the app without auto-restart. |
| `npm run db:schema` | Drops and recreates all tables. **Deletes all data**; run `db:seed` afterwards. |
| `npm run db:seed` | Empties the tables and inserts the test data. Safe to re-run at any time to reset. |
| `docker compose down` | Stops the database, keeping its data. |
| `docker compose down -v` | Stops the database and deletes its data. |

## How the app connects to the database

`docker-compose.yml` and the Node app read the same values from `.env`, so the settings are written once:

| `.env` value | Used by the container as | Used by the app as |
|---|---|---|
| `DB_USER` | the database user it creates | the user it logs in with |
| `DB_PASSWORD` | that user's password | the password it logs in with |
| `DB_NAME` | the database it creates | the database it connects to |
| `DB_PORT` | the port published on your machine | the port it connects to |
| `DB_HOST` | (not used) | the host it connects to (`localhost`) |

The container publishes PostgreSQL on `localhost:DB_PORT`, and the app opens a connection pool to it in `src/config/db.js`. The server checks the connection at startup and exits with a clear message if the database is unreachable. If port 5432 is already taken on your machine, change `DB_PORT` in `.env` and run `docker compose up -d` again.

`npm run db:schema` runs `psql` inside the container against `db/schema.sql`, so no PostgreSQL client is needed on your machine.

## Seeded data and logins

**Every seeded student has the password `Password@123`.** Passwords are stored only as bcrypt hashes, a different hash per student.

### Hostels and rooms

| room_id | Hostel | Year | Gender | Room | Capacity | State after seeding |
|---|---|---|---|---|---|---|
| 1 | Aravali | 1 | BOYS | 101 | 2 | empty |
| 2 | Aravali | 1 | BOYS | 102 | 3 | 1 seat left |
| 3 | Aravali | 1 | BOYS | 103 | 2 | full |
| 4 | Aravali | 1 | BOYS | 104 | 3 | empty |
| 5, 6 | Ganga | 1 | GIRLS | 101, 102 | 2, 3 | empty |
| 7, 8 | Nilgiri | 2 | BOYS | 101, 102 | 2, 3 | empty |
| 9 | Yamuna | 2 | GIRLS | 101 | 2 | empty |
| 10 | Shivalik | 3 | BOYS | 101 | 2 | empty |

### Students

| Registration no | Current year | Gender | Fees | Purpose |
|---|---|---|---|---|
| `2026CS001`, `2026CS002` | 1 | BOYS | paid | two students of the same year and gender, to race for one seat |
| `2026CS003` – `2026CS008` | 1 | BOYS | paid | extra students, for races with more requests than seats |
| `2025CS010` | 1 | BOYS | paid | repeater: 2025 registration number, still in year 1 |
| `2023CS020` | 1 | BOYS | paid | repeated several times: 2023 registration number, still in year 1 |
| `2025CS030` | 2 | BOYS | paid | had a backlog but was promoted: year 2 |
| `2026CS040` | 1 | BOYS | **unpaid** | fees check |
| `2026CS050` | 1 | GIRLS | paid | wrong-gender check against the boys hostels |
| `2025CS060` | 2 | BOYS | paid | wrong-year check against the year-1 hostel |
| `2026CS901` – `2026CS904` | 1 | BOYS | paid | already hold the seats in Aravali 102 and 103 (booking ids 1–4) |

Registration numbers are case-sensitive.

## API

All requests and responses are JSON. Every route except login needs the header `Authorization: Bearer <token>`.

Errors always have this shape, with a distinct `error` code per failure:

```json
{ "error": "ROOM_FULL", "message": "Room is full" }
```

### `POST /auth/login`

```json
{ "registration_no": "2026CS001", "password": "Password@123" }
```

**200:** `{ "token": "..." }`. The token is valid for 1 hour and contains only the student's id.

**401 `INVALID_CREDENTIALS`:** returned identically for an unknown registration number, a wrong password, and missing fields.

### `GET /rooms`

Rooms of the hostel(s) matching the logged-in student's stored year and gender. Full rooms are included and marked.

**200:**

```json
{
  "rooms": [
    { "room_id": 2, "hostel_name": "Aravali", "room_number": "102", "capacity": 3, "occupied_count": 2, "remaining": 1, "is_full": false },
    { "room_id": 3, "hostel_name": "Aravali", "room_number": "103", "capacity": 2, "occupied_count": 2, "remaining": 0, "is_full": true }
  ]
}
```

### `POST /bookings`

```json
{ "room_id": 2 }
```

**201:** `{ "success": true, "booking_id": 5, "remaining": 0 }`

Checks run in this order, and the first failure is returned:

| Status | Code | When |
|---|---|---|
| 401 | `NOT_LOGGED_IN` | no token, or the token is invalid or expired |
| 400 | `INVALID_ROOM_ID` | `room_id` is missing or not a positive integer |
| 403 | `CANNOT_ACT_FOR_ANOTHER_STUDENT` | the body carries a `student_id` or `registration_no` of a different student |
| 403 | `FEES_NOT_PAID` | the student's stored `fees_paid` is false ("Submit your fees first") |
| 404 | `ROOM_NOT_FOUND` | no such room |
| 403 | `ROOM_NOT_ALLOWED` | the room's hostel does not match the student's year and gender |
| 409 | `ALREADY_BOOKED` | the student already has an active booking |
| 409 | `ROOM_FULL` | no seat left |

### `POST /bookings/:booking_id/cancel`

No body. Example: `POST /bookings/5/cancel`.

**200:** `{ "success": true, "booking_id": 5, "remaining": 1 }`

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_BOOKING_ID` | the id in the URL is not a positive integer |
| 401 | `NOT_LOGGED_IN` | no valid token |
| 404 | `BOOKING_NOT_FOUND` | no such booking, or it belongs to another student |
| 409 | `ALREADY_CANCELLED` | the booking was already cancelled; nothing changes |

### `POST /bookings/:booking_id/change`

```json
{ "new_room_id": 4 }
```

**200:** `{ "success": true, "booking_id": 6, "old_booking_id": 5, "remaining": 2 }`

The old booking is kept as cancelled history and a new booking is created, so **the booking id changes**. `remaining` refers to the new room.

Errors: `INVALID_BOOKING_ID`, `INVALID_ROOM_ID`, `NOT_LOGGED_IN`, `CANNOT_ACT_FOR_ANOTHER_STUDENT`, `FEES_NOT_PAID`, `BOOKING_NOT_FOUND`, `ALREADY_CANCELLED`, `ROOM_NOT_FOUND`, `ROOM_NOT_ALLOWED` and `ROOM_FULL` as above, plus:

| Status | Code | When |
|---|---|---|
| 409 | `SAME_ROOM` | the new room is the room the student is already in |

On any failure the original booking and both room counts are left exactly as they were.

### `GET /me/booking`

**200:** the logged-in student's active booking, or `null`:

```json
{ "booking": { "booking_id": 6, "room_id": 4, "room_number": "104", "hostel_name": "Aravali", "status": "ACTIVE", "created_at": "2026-11-18T06:17:07.665Z" } }
```

```json
{ "booking": null }
```

### Other responses

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_JSON` | the request body is not valid JSON |
| 404 | `NOT_FOUND` | no such route |
| 500 | `INTERNAL_ERROR` | unexpected failure; details are logged on the server only |

## How each rule is enforced and verified

**No automated test suite ships with this repository.** Each rule was verified by running requests against the live API and checking the database afterwards. The concurrency rules can be reproduced by hand with the [two-instance procedure](#demonstrating-concurrency-with-two-app-instances) below. During development they were also exercised with a script that fired bursts of simultaneous requests split across two app processes; that script is not included here.

| Rule | How it is enforced | How it was verified |
|---|---|---|
| **A room is never booked beyond capacity** | The seat is taken by one statement, `UPDATE rooms SET occupied_count = occupied_count + 1 WHERE room_id = $1 AND occupied_count < capacity`. PostgreSQL makes a second simultaneous update wait, then re-checks the condition against the new count. A `CHECK (occupied_count BETWEEN 0 AND capacity)` constraint is a second line of defence. | 10 students booking the 1 remaining seat at once across two processes: 1 success, 9 `ROOM_FULL`, room exactly 3/3. 9 students for 3 seats: 3 successes, 6 `ROOM_FULL`. |
| **One active booking per student** | Every booking action first locks the student's own row (`SELECT ... FOR UPDATE`), so one student's requests run one after another, whichever process receives them. A unique index on `bookings (student_id) WHERE status = 'ACTIVE'` is a second line of defence. | One student sending 6 simultaneous bookings at 3 different rooms: 1 success, 5 `ALREADY_BOOKED`. Double-click on the same room: 1 success, 1 `ALREADY_BOOKED`, seat taken once. |
| **Login reveals nothing about which registration numbers exist** | Unknown number, wrong password and missing fields all throw the same error. For an unknown number, a bcrypt comparison still runs against a dummy hash so the response takes the same time. | The two failures returned byte-for-byte identical responses. Median response time over 25 requests each: 72.6 ms (wrong password) vs 72.7 ms (unknown number). |
| **Identity comes only from the token** | The token holds only the student id. The auth middleware sets `req.studentId`, and no route reads a student id from the body, query or URL. Only the HS256 algorithm is accepted. | Missing, malformed, tampered, expired, wrong-secret, `alg: none` and wrong-algorithm tokens, and a token for a student that does not exist, all returned the same 401. Adding `?student_id=` or `?year=` to requests changed nothing. |
| **Acting on another student's behalf is rejected** | A booking or change whose body names a different `student_id` or `registration_no` gets `CANNOT_ACT_FOR_ANOTHER_STUDENT`. Cancel and change look bookings up by id **and** owner together. | Both body variants were rejected. Cancelling and changing another student's booking returned `BOOKING_NOT_FOUND`. All counts unchanged. |
| **Year and gender eligibility** | Inside the booking transaction, the room is joined to the hostel it actually belongs to, and that hostel's year and gender are compared with the student's stored `current_year` and `gender`. The registration number is never parsed, and a `hostel_id` from the client is never read. | Year-2 student → year-1 hostel, both repeaters → year-2 hostel, promoted backlog student → year-1 hostel, girl → boys hostel: all `ROOM_NOT_ALLOWED`, counts unchanged, including when the body carried the student's own `hostel_id`. Both repeaters then booked the year-1 hostel successfully. |
| **Unpaid fees block booking and changing** | `fees_paid` is read from the locked student row inside the transaction, at request time. It is not in the token. | The unpaid student got `FEES_NOT_PAID`. A student holding a seat whose stored flag was then set to unpaid was refused a room change using the same, still-valid token. |
| **Cancel frees the seat exactly once, only for the owner** | The booking is marked cancelled by `UPDATE ... WHERE booking_id = $1 AND status = 'ACTIVE'`, and the seat is released only if that update changed a row. The booking row is kept for history. | 2 cancels at once: 1 success, 1 `ALREADY_CANCELLED`, count 1 → 0. 6 cancels at once on a seat in a full room: count 2 → 1. A later cancel was rejected with the count unchanged. The student could book again afterwards. |
| **Room change is atomic** | One transaction: take the new seat, cancel the old booking, release the old seat, insert the new booking. Every check, including "new room is full", passes before the old booking is touched; any failure rolls everything back. Both room rows are locked in ascending `room_id` order to prevent deadlocks. | Each failure (full, not found, wrong year, wrong gender, same room, unpaid) left the original booking and both counts untouched. A change racing a cancel of the same booking always ended in one of two states: moved to the new room, or no booking. Two students swapping rooms at once, 20 times: all succeeded, no deadlock. |
| **`GET /rooms` is correct at all times** | Counts are read directly from the `rooms` table on every request, with no cache. `occupied_count` only changes inside the same transaction as its booking. | Immediately after a burst of bookings, `GET /rooms` on both processes reported the room as full. |
| **No response exposes another student's details** | Responses contain only room and hostel fields and the caller's own booking. Another student's booking is reported as `BOOKING_NOT_FOUND`, the same as a booking that does not exist. | `GET /me/booking` with a roommate in the same room returned only the caller's booking. |
| **Counts stay consistent** | Every multi-step operation is one transaction through a single `withTransaction` helper. | After every scenario above: each room's `occupied_count` equalled its number of active bookings, no room was over capacity or below zero, and no student had more than one active booking. |

To confirm these checks were meaningful, the same scripted races were run against deliberately broken copies of the code. With the conditional update replaced by "read the count, then write count + 1", 10 students all got the last seat. With the database guards replaced by an in-memory lock inside each process, 2 students got the last seat when the requests were split across two processes.

## Demonstrating concurrency with two app instances

This reproduces "two students click Book for the last seat at the same instant" using two app processes on different ports and one database. Commands are for Windows PowerShell; a bash version of the race command follows.

### 1. Reset the data

```powershell
npm run db:seed
```

Room 2 (Aravali 102) now has exactly 1 seat left.

### 2. Start two app processes

Terminal 1 (port 3000):

```powershell
npm start
```

Terminal 2 (port 3001):

```powershell
$env:PORT=3001; node server.js
```

### 3. Log in as a different student in each of two more terminals

Terminal 3, student A, using port 3000:

```powershell
$T = (Invoke-RestMethod -Method Post -Uri http://localhost:3000/auth/login -ContentType "application/json" -Body '{"registration_no":"2026CS001","password":"Password@123"}').token
```

Terminal 4, student B, using port 3001:

```powershell
$T = (Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login -ContentType "application/json" -Body '{"registration_no":"2026CS002","password":"Password@123"}').token
```

### 4. Fire both bookings at the same clock second

Each command waits for a clock time and then sends the request. Choose a time about a minute ahead and use the same time in both terminals.

Terminal 3:

```powershell
while ((Get-Date) -lt [datetime]"13:10:00") { }; curl.exe -s -X POST http://localhost:3000/bookings -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{\"room_id\":2}'
```

Terminal 4:

```powershell
while ((Get-Date) -lt [datetime]"13:10:00") { }; curl.exe -s -X POST http://localhost:3001/bookings -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{\"room_id\":2}'
```

One terminal prints `{"success":true,"booking_id":5,"remaining":0}` and the other prints `{"error":"ROOM_FULL","message":"Room is full"}`. Which student wins can differ between runs.

Bash equivalent of the race command, with `T` holding the token:

```bash
while [[ "$(date +%H:%M:%S)" < "13:10:00" ]]; do :; done; curl -s -X POST http://localhost:3000/bookings -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{"room_id":2}'
```

### 5. Confirm the result from both processes and from the database

```powershell
curl.exe -s http://localhost:3000/rooms -H "Authorization: Bearer $T"
curl.exe -s http://localhost:3001/rooms -H "Authorization: Bearer $T"
docker compose exec db psql -c "SELECT room_id, capacity, occupied_count FROM rooms WHERE room_id = 2"
```

Both processes report room 2 as `"occupied_count":3,"remaining":0,"is_full":true`, and the database shows 3 of 3.

### Other races with the same method

Run `npm run db:seed` between races. Tokens stay valid after a re-seed.

| Race | Setup | Expected |
|---|---|---|
| Double-click | Log in as the **same** student in both terminals; book room 1 in both | one success, one `ALREADY_BOOKED` |
| One student, two rooms | Same student in both; `room_id` 1 in one terminal and 4 in the other | one success, one `ALREADY_BOOKED` |
| Cancel twice | Book first, then use `.../bookings/<id>/cancel` (no `-d` body) in the timed command in both | one success, one `ALREADY_CANCELLED` |

The two requests arrive a few milliseconds apart, and a booking takes only a few milliseconds, so they may run back to back and not strictly overlap. The slow-motion version below makes the overlap visible.

### The same race in slow motion, at the database

Open two terminals, run `docker compose exec db psql` in each, and treat each as one student.

| Step | Terminal 1 | Terminal 2 |
|---|---|---|
| 1 | `BEGIN;` | `BEGIN;` |
| 2 | `UPDATE rooms SET occupied_count = occupied_count + 1 WHERE room_id = 2 AND occupied_count < capacity;` → `UPDATE 1` | |
| 3 | | the same `UPDATE` → waits |
| 4 | `COMMIT;` | → continues and prints `UPDATE 0` |
| 5 | | `ROLLBACK;` |

`UPDATE 0` is what the app reports as `ROOM_FULL`. This is the statement the booking code runs, and it shows the database deciding the winner. Run `npm run db:seed` afterwards.

## Project structure

```
hostel-allotment/
├── server.js                  starts the server after checking the database and JWT secret
├── docker-compose.yml         PostgreSQL 16
├── .env.example               template for .env
├── db/
│   ├── schema.sql             tables and constraints
│   └── seed.js                test data
└── src/
    ├── app.js                 Express app and route registration
    ├── errors.js              AppError class and the error handlers
    ├── config/db.js           connection pool and the withTransaction helper
    ├── middleware/
    │   └── auth.middleware.js verifies the token, sets req.studentId
    ├── routes/                URL → controller
    ├── controllers/           read the request, send the response
    └── services/              business rules and SQL
        ├── auth.service.js
        ├── rooms.service.js
        └── bookings.service.js   book, cancel, change, current booking
```
