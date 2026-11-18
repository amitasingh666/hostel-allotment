# Hostel Seat Allotment Service

A backend service where college students log in and book a seat in a hostel room. Each hostel serves one academic year and one gender; each room has a fixed number of seats.

The central requirement is that every rule holds when requests arrive at the same instant, even across several app processes sharing one database. All of that correctness lives in PostgreSQL (transactions, row locks and constraints). Nothing depends on a lock held in Node's memory.

**Stack:** Node.js 20, Express 5, PostgreSQL 16 (in Docker), `pg`, `bcrypt`, `jsonwebtoken`. There is no UI; the API is used with Postman or `curl`.

## Contents

1. [Setup](#setup)
2. [How the app connects to the database](#how-the-app-connects-to-the-database)
3. [Seeded data and logins](#seeded-data-and-logins)
4. [API](#api)
5. [Project structure](#project-structure)

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
