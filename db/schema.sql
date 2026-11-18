-- Hostel allotment schema.
-- Re-runnable: drops everything and recreates it, so all data is lost.

DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS hostels;
DROP TABLE IF EXISTS students;

CREATE TABLE students (
  student_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  registration_no TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  -- Stored, never derived from registration_no: a repeater keeps an old
  -- registration number but has a lower current year.
  current_year    SMALLINT NOT NULL CHECK (current_year BETWEEN 1 AND 4),
  gender          TEXT    NOT NULL CHECK (gender IN ('BOYS', 'GIRLS')),
  fees_paid       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE hostels (
  hostel_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      TEXT     NOT NULL UNIQUE,
  year      SMALLINT NOT NULL CHECK (year BETWEEN 1 AND 4),
  gender    TEXT     NOT NULL CHECK (gender IN ('BOYS', 'GIRLS'))
);

CREATE TABLE rooms (
  room_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hostel_id      INTEGER  NOT NULL REFERENCES hostels (hostel_id),
  room_number    TEXT     NOT NULL,
  capacity       SMALLINT NOT NULL CHECK (capacity > 0),
  occupied_count SMALLINT NOT NULL DEFAULT 0,

  CONSTRAINT rooms_number_unique_per_hostel UNIQUE (hostel_id, room_number),

  -- Last line of defence: no code path can overbook a room or push the
  -- count below zero, whatever the application does.
  CONSTRAINT rooms_occupied_within_capacity
    CHECK (occupied_count >= 0 AND occupied_count <= capacity)
);

CREATE TABLE bookings (
  booking_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES students (student_id),
  room_id      INTEGER NOT NULL REFERENCES rooms (room_id),
  status       TEXT    NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,

  -- A booking has a cancellation time exactly when it is cancelled.
  CONSTRAINT bookings_cancelled_at_matches_status
    CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

-- One ACTIVE booking per student across all hostels and rooms.
-- Cancelled bookings are kept for history and are not limited.
CREATE UNIQUE INDEX bookings_one_active_per_student
  ON bookings (student_id)
  WHERE status = 'ACTIVE';

CREATE INDEX bookings_room_id_idx ON bookings (room_id);
