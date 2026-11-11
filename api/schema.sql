-- Ride Next guest stats. Everything is anonymous: "device" is a random ID made by the app, not linked to a person.

-- Real queue times: posted wait when the fan joined the queue vs how long they actually queued
CREATE TABLE IF NOT EXISTS waits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,
  resort TEXT NOT NULL,
  park_id TEXT NOT NULL,
  ride_id TEXT NOT NULL,
  posted INTEGER NOT NULL,
  actual INTEGER NOT NULL,
  single_rider INTEGER NOT NULL DEFAULT 0,
  dow INTEGER,
  hour INTEGER,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS waits_ride ON waits (resort, ride_id, created);
CREATE INDEX IF NOT EXISTS waits_device ON waits (device, created);

-- Snacks logged: one row per device, day, park and snack (the count is replaced, not added up)
CREATE TABLE IF NOT EXISTS snacks (
  device TEXT NOT NULL,
  resort TEXT NOT NULL,
  park_id TEXT NOT NULL,
  snack TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (device, day, park_id, snack)
);
CREATE INDEX IF NOT EXISTS snacks_park ON snacks (resort, day);

-- Restaurant ratings: one per device per place, can be changed
CREATE TABLE IF NOT EXISTS ratings (
  device TEXT NOT NULL,
  resort TEXT NOT NULL,
  place TEXT NOT NULL,
  stars INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (device, resort, place)
);
CREATE INDEX IF NOT EXISTS ratings_place ON ratings (resort, place);
