# Tyre Tracker — to do

## Pressure alarm — shipped in 1.0.0, leftovers only

Both ways in landed: a companion `problem` binary_sensor is picked up on the
TPMS device beside the pressure, and a target pressure per axle sits in the
set's record next to its size — cold, in bar, with a fixed −15 % / +30 % band
around it. The alarm surfaces as a red corner in the card's pressure grid, a
red dot on the floorplan badge, and a `pressure_alarm` attribute on the
vehicle sensor. The threshold flag and the silent-sensor flag stay separate,
as they should.

Still open, none blocking:

- The band is two constants (`PRESSURE_LOW_RATIO`, `PRESSURE_HIGH_RATIO` in
  `const.py`), not a setting. Worth a per-vehicle option only if someone asks.
- Targets are entered in bar. An imperial household would want psi — the
  comparison already converts whatever the sensor publishes, only the form
  is bar-bound.
- The flag says *wrong*, not which way. Low and high could be told apart in
  the reading dict the day a card wants to say « needs air » against
  « overfilled ».
