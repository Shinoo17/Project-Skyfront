/*
Scripted demonstrations, written in the same controls a pilot holds.

A script is a throttle to enter on and a list of steps, each one a duration and the set of
held controls — the exact strings in `FLIGHT_BINDINGS`. Nothing here talks to the flight
model: the bot that runs these writes into the same `pressed` set the keyboard writes into,
so a demonstration is subject to every limiter, every authority curve and every energy cost
the pilot is. If a script stops working after a tuning change, that is the point of it.

`expect` names the regime `detectManeuver` in the flight model should report while the
script runs. It is an assertion the panel shows a tick or a cross for, not an instruction —
nothing anywhere forces the label, so a cross means the airframe did not actually do it.

`requires` gates a script on an aircraft manifest flag. The post-stall set is only flyable
with the nozzles: past the stall the surfaces have lost most of their authority and it is
`thrustVectorEffectiveness` alone that still points the nose.

Every number below was found by replaying these scripts through the flight model itself
rather than guessed, and two constraints shaped them:

  The Cobra needs the nozzles, not airspeed. Nose rate comes from surface authority (which
  scales with speed) plus vector authority (which scales with thrust). Path rate comes from
  lift, which scales with speed squared. Enter fast and lift swings the flight path around
  as quickly as the nose moves and the jet simply loops. Enter slow and light the burner and
  the nose wins: that is the difference between the Cobra script and the post-stall one,
  which is the same pull with the reheat left out.

  Nothing may descend more than about 40 units below the spawn. The spawn clears the highest
  ground by `map.spawn.clearance` (58) and the range resets a sortie below 9 units of ground
  clearance, so 40 is the margin that holds over any terrain the registry can load. Loops and
  the Split-S are entered slow, or from a climb, for exactly that reason.
*/

// Throttle settings, named by the airspeed they hold at demonstration altitude.
// power = (throttle - minThrottle) / (1 - minThrottle), speed = lerp(260, dryLimit, power).
const THROTTLE_SLOW = 0.26 // ~475 km/h
const THROTTLE_LOW = 0.32 // ~550 km/h
const THROTTLE_CRUISE = 0.36 // ~595 km/h
const THROTTLE_MIL = 0.4 // ~645 km/h
const THROTTLE_FAST = 0.52 // ~790 km/h

const MANEUVERS = [
  {
    id: 'cobra',
    name: 'Pugachev’s Cobra',
    expect: 'cobra',
    requires: 'thrustVectoring',
    brief:
      'Slow, then reheat and full aft stick with the limiter relaxed. The nose goes past '
      + 'the vertical while the flight path carries straight on, the wing stops flying, and '
      + 'drag does the braking.',
    entry: { throttle: THROTTLE_SLOW, settleSeconds: 2.5 },
    steps: [
      { seconds: 1.8, hold: ['high-aoa', 'pitch-up', 'afterburner'], label: 'PULL' },
      { seconds: 1.2, hold: ['high-aoa'], label: 'HANG' },
      { seconds: 1.4, hold: ['pitch-down'], label: 'NOSE DOWN' },
      { seconds: 2.0, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'j-turn',
    name: 'J-turn (Herbst)',
    expect: 'j-turn',
    requires: 'thrustVectoring',
    brief:
      'A Cobra with the pedal in: the nose swings across the flight path in yaw as well as '
      + 'pitch, and the jet comes out pointing somewhere it never flew.',
    entry: { throttle: THROTTLE_SLOW, settleSeconds: 2.5 },
    steps: [
      { seconds: 1.8, hold: ['high-aoa', 'pitch-up', 'afterburner'], label: 'PULL' },
      // The stick stays back through the pedal input. Releasing it lets the nose fall back
      // toward the flight path, and the sideslip alone is not a J-turn.
      { seconds: 2.2, hold: ['high-aoa', 'pitch-up', 'yaw-right', 'afterburner'], label: 'PEDAL IN' },
      { seconds: 1.4, hold: ['pitch-down'], label: 'UNLOAD' },
      { seconds: 2.0, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'pedal-turn',
    name: 'Pedal turn',
    expect: 'pedal-turn',
    requires: 'thrustVectoring',
    brief:
      'Zoom until the nose is near vertical and the speed has gone, then pedal. The rudders '
      + 'have nothing left to bite; the nozzles pivot the jet about its own vertical.',
    entry: { throttle: THROTTLE_LOW, settleSeconds: 2.2 },
    steps: [
      { seconds: 2.2, hold: ['pitch-up'], label: 'ZOOM' },
      { seconds: 4.0, hold: ['high-aoa', 'yaw-right', 'afterburner'], label: 'PEDAL' },
      { seconds: 1.6, hold: ['pitch-down'], label: 'NOSE DOWN' },
      { seconds: 2.0, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'post-stall',
    name: 'Post-stall pass',
    expect: 'post-stall',
    requires: 'thrustVectoring',
    brief:
      'The Cobra pull with the reheat left out. Without the burner feeding the nozzles the '
      + 'nose stops short of the flight path’s beam — deep past the stall, but not a Cobra.',
    entry: { throttle: THROTTLE_SLOW, settleSeconds: 2.5 },
    steps: [
      { seconds: 1.8, hold: ['high-aoa', 'pitch-up'], label: 'PULL' },
      { seconds: 1.6, hold: ['high-aoa'], label: 'HOLD ALPHA' },
      { seconds: 1.4, hold: ['pitch-down'], label: 'UNLOAD' },
      { seconds: 2.0, hold: [], label: 'RECOVER' },
    ],
  },

  {
    id: 'loop',
    name: 'Inside loop',
    brief:
      'The plain one, and the reference the others are read against. Entered without reheat '
      + 'so it stays inside the range floor.',
    entry: { throttle: THROTTLE_CRUISE, settleSeconds: 2.0 },
    steps: [
      { seconds: 9.0, hold: ['pitch-up'], label: 'PULL THROUGH' },
      { seconds: 2.0, hold: [], label: 'LEVEL' },
    ],
  },

  {
    id: 'aileron-roll',
    name: 'Aileron roll',
    brief: 'Pure roll rate, stick centred in pitch — the jet corkscrews along its flight path.',
    entry: { throttle: THROTTLE_FAST, settleSeconds: 2.0 },
    steps: [
      { seconds: 3.2, hold: ['roll-right'], label: 'ROLL' },
      { seconds: 1.6, hold: [], label: 'LEVEL' },
    ],
  },

  {
    id: 'barrel-roll',
    name: 'Barrel roll',
    brief: 'Roll and back stick together: a helix around the flight path, loaded the whole way.',
    entry: { throttle: THROTTLE_FAST, settleSeconds: 2.0 },
    steps: [
      { seconds: 4.0, hold: ['roll-right', 'pitch-up'], label: 'ROLL THROUGH' },
      { seconds: 1.6, hold: [], label: 'LEVEL' },
    ],
  },

  {
    id: 'split-s',
    name: 'Split-S',
    brief:
      'Climb for the room it will need, half roll onto the back, then pull through the '
      + 'bottom half of a loop and come out reversed.',
    entry: { throttle: THROTTLE_LOW, settleSeconds: 2.0 },
    steps: [
      { seconds: 1.8, hold: ['pitch-up', 'afterburner'], label: 'CLIMB' },
      { seconds: 1.0, hold: [], label: 'EASE' },
      { seconds: 1.4, hold: ['roll-right'], label: 'ROLL INVERTED' },
      { seconds: 3.0, hold: ['pitch-up'], label: 'PULL THROUGH' },
      { seconds: 1.6, hold: [], label: 'LEVEL' },
    ],
  },

  {
    id: 'immelmann',
    name: 'Immelmann',
    brief: 'Half a loop up, then half a roll upright — height traded for a reversal.',
    entry: { throttle: THROTTLE_MIL, settleSeconds: 2.0 },
    steps: [
      { seconds: 3.0, hold: ['pitch-up', 'afterburner'], label: 'PULL UP' },
      { seconds: 1.5, hold: ['roll-right'], label: 'ROLL UPRIGHT' },
      { seconds: 1.6, hold: [], label: 'LEVEL' },
    ],
  },
]

export default MANEUVERS

export function listManeuvers(aircraft) {
  return MANEUVERS.filter((maneuver) => !maneuver.requires || aircraft?.[maneuver.requires])
}

export function getManeuver(id) {
  return MANEUVERS.find((maneuver) => maneuver.id === id) ?? null
}

// Total scripted time, entry settle included — what the panel draws its progress bar over.
export function readManeuverSeconds(maneuver) {
  return maneuver.entry.settleSeconds
    + maneuver.steps.reduce((total, step) => total + step.seconds, 0)
}
