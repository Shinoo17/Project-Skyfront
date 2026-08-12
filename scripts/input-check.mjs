import assert from 'node:assert/strict'

import f22 from '../src/aircraft/f22.js'
import {
  FLIGHT_BINDINGS,
  MOUSE_SENSITIVITY_RANGE,
  centreMouseStick,
  clampMouseSensitivity,
  clearAnalogFlightInput,
  clearMouseStick,
  createFlightInputState,
  mouseStickRadiusPx,
  moveMouseStick,
  setMouseStick,
  MOUSE_STICK_GATE,
  readCommandSpeedLimits,
  readMouseStickAxes,
  setAnalogFlightInput,
  setCommandSpeedKmh,
  stepFlightInput,
} from '../src/features/flight/flightInput.js'
import {
  readTargetAirspeedKmh,
  readThrottleForAirspeedKmh,
} from '../src/features/flight/performance.js'

const FRAME = 1 / 60
const envelope = f22.flight.envelope
// The band the range flies in. Everything below is checked at one altitude, because the
// speed-to-power map is altitude-dependent by design.
const ALTITUDE = 815
const CRUISE_KMH = readTargetAirspeedKmh(envelope.idleThrottle, ALTITUDE, 0, envelope)
const limits = readCommandSpeedLimits(envelope)
const input = createFlightInputState(CRUISE_KMH)
const step = () => stepFlightInput(input, FRAME, envelope, ALTITUDE)

// The whole arcade control rests on this round trip: the pilot names a speed, the model is
// handed the power that holds it, and nothing is lost in between.
assert.ok(
  Math.abs(readThrottleForAirspeedKmh(CRUISE_KMH, ALTITUDE, envelope) - envelope.idleThrottle) < 1e-9,
  'speed and power must be exact inverses, or a seeded sortie drifts off its own trim',
)

// The two intents are two keys, and which key is which is the whole control scheme.
assert.equal(FLIGHT_BINDINGS.Space, 'high-g',
  'Space must be the max-performance turn, not a post-stall request')
assert.equal(FLIGHT_BINDINGS.AltLeft, 'maneuver-assist',
  'Left Alt must be the deliberate post-stall control modifier')

// The left hand stays on WASD: A and D are roll, and the arrows remain a second set for a
// pilot who would rather fly them, so neither hand is forced off what it is already doing.
assert.equal(FLIGHT_BINDINGS.KeyA, 'roll-left', 'A must roll left')
assert.equal(FLIGHT_BINDINGS.KeyD, 'roll-right', 'D must roll right')
assert.equal(FLIGHT_BINDINGS.ArrowLeft, 'roll-left', 'the arrows must still fly the aircraft')
assert.equal(FLIGHT_BINDINGS.ArrowRight, 'roll-right', 'the arrows must still fly the aircraft')

input.pressed.add('pitch-up')
const firstPitch = step().pitch
assert.ok(firstPitch > 0 && firstPitch < 0.2, 'keyboard pitch must ramp instead of snapping')

for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.pitch, 1, 'held keyboard pitch must still reach full authority')

input.pressed.clear()

const commandBeforePsm = input.commandSpeedKmh
input.pressed.add('maneuver-assist')
const psmIntent = step()
assert.equal(psmIntent.psmArm, true, 'Maneuver Assist must arm PSM')
assert.equal(psmIntent.highG, false, 'Maneuver Assist must not also request a high-G turn')
assert.equal(psmIntent.airBrake, 0, 'Maneuver Assist must not spend energy through the brake')
assert.equal(input.commandSpeedKmh, commandBeforePsm,
  'Maneuver Assist must not move the commanded speed')
input.pressed.clear()

/*
Space is the other intent entirely, and it is one key with two readings: the board with the
stick centred, the max-performance turn with it deflected. Both cut the power while they
are held and neither one touches the commanded speed, so letting go is the whole recovery.
*/
const commandBeforeHighG = input.commandSpeedKmh
const servingThrottle = input.throttle
input.pressed.add('high-g')
const highGIntent = step()
assert.equal(highGIntent.highG, true, 'Space must publish high-G turn intent')
assert.equal(highGIntent.psmArm, false, 'Space must never arm PSM')
assert.ok(highGIntent.airBrake > 0, 'Space with a centred stick must start opening the board')
assert.equal(input.throttle, envelope.minThrottle,
  'Space must cut the power for as long as it is held')
assert.equal(input.commandSpeedKmh, commandBeforeHighG,
  'Space must not move the commanded speed')

for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.airBrake, 1,
  'a held Space with a centred stick must settle at the full board')

// Deflect the stick and the same key is a turn instead: the board shuts, because the turn
// is already being paid for in induced drag.
input.pressed.add('pitch-up')
for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.airBrake, 0, 'a deflected stick must shut the board')
assert.equal(input.intent.highG, true, 'the turn is still the same intent')

input.pressed.clear()
step()
assert.equal(input.throttle, servingThrottle,
  'releasing Space must hand back the power that serves the commanded speed')
assert.equal(input.commandSpeedKmh, commandBeforeHighG,
  'the commanded speed must survive the whole manoeuvre untouched')

/*
The brake reads the resolved stick, so the mouse reaches it too — and a mouse stick is a
position that is live wherever the pointer was left. A small standing deflection is the
pilot holding a heading while they slow down, not a turn, and it has to leave the board out.
*/
input.pressed.add('high-g')
setAnalogFlightInput(input, 'test-mouse', { pitch: 0.2 }, { direct: true })
for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.airBrake, 1,
  'a small standing mouse deflection must not close the board')
setAnalogFlightInput(input, 'test-mouse', { pitch: 0.8 }, { direct: true })
for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.airBrake, 0, 'a committed mouse pull must shut the board')
clearAnalogFlightInput(input, 'test-mouse')
input.pressed.clear()
for (let frame = 0; frame < 20; frame += 1) step()

// A held key let go of comes back through the same filter it went out on, rather than
// snapping: the aircraft stops being asked, it is not commanded to centre.
input.pressed.add('pitch-up')
for (let frame = 0; frame < 20; frame += 1) step()
assert.equal(input.intent.pitch, 1, 'the stick must be full before the release is measured')
input.pressed.clear()
const firstRelease = step().pitch
assert.ok(firstRelease > 0 && firstRelease < 1, 'released pitch must return continuously')
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.pitch, 0, 'released pitch must recentre')

input.pressed.add('roll-left')
input.pressed.add('roll-right')
for (let frame = 0; frame < 10; frame += 1) step()
assert.equal(input.intent.roll, 0, 'opposing digital controls must cancel')
input.pressed.clear()

/*
W and S are the speed control and nothing else. Held together they are two commands
cancelling — not a turn chord, because the turn has its own key — and neither of them
reaches for the board: S is "ask for a lower speed", and the aircraft slows down by being
asked to, at the rate the engine and the drag settle between them.
*/
const commandBeforeOpposing = input.commandSpeedKmh
input.pressed.add('throttle-up')
input.pressed.add('throttle-down')
const chord = step()
assert.equal(chord.highG, false, 'W+S must not request a turn')
assert.equal(chord.psmArm, false, 'W+S must never arm PSM')
assert.equal(chord.accelerate, false, 'W+S must not also read as an accelerate command')
assert.equal(chord.decelerate, false, 'W+S must not also read as a decelerate command')
assert.equal(input.commandSpeedKmh, commandBeforeOpposing,
  'opposing speed commands must cancel')
assert.equal(chord.airBrake, 0, 'W+S must not open the board')

input.pressed.clear()
for (let frame = 0; frame < 12; frame += 1) step()

const commandBeforeSlowing = input.commandSpeedKmh
input.pressed.add('throttle-down')
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.decelerate, true, 'S alone must publish decelerate intent')
assert.equal(input.intent.highG, false, 'S alone must not request a high-G turn')
assert.equal(input.intent.airBrake, 0,
  'S is a speed command, not a board: the brake belongs to Space')
assert.ok(input.commandSpeedKmh < commandBeforeSlowing, 'held S must walk the command down')
input.pressed.add('pitch-up')
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.airBrake, 0, 'a pull does not promote S into the board either')
input.pressed.clear()
for (let frame = 0; frame < 12; frame += 1) step()
assert.equal(input.intent.pitch, 0, 'the pull must settle before the next device takes control')
setCommandSpeedKmh(input, CRUISE_KMH, envelope)

setAnalogFlightInput(input, 'test-stick', { roll: 0.42, pitch: -0.25 })
for (let frame = 0; frame < 10; frame += 1) step()
assert.equal(input.intent.roll, 0.42, 'analogue roll must retain its requested magnitude')
assert.equal(input.intent.pitch, -0.25, 'analogue pitch must retain its requested magnitude')
clearAnalogFlightInput(input, 'test-stick')

/*
The mouse is a positional stick, and everything worth checking about it follows from that one
claim: where the pointer sits inside the gate is where the stick sits, the gate is a disc
rather than a box, and the middle of the screen is the only neutral there is.
*/
{
  const stick = input.mouseStick
  const EXTENT = 1000
  // The gate at 1×: 340px from the middle of a 1000px-short-side window is full deflection.
  const RADIUS = mouseStickRadiusPx(EXTENT, 1)
  assert.equal(RADIUS, 340, 'the gate must be 34% of the short side at 1x')
  const aim = (x, y, options = {}) => setMouseStick(input, x, y, { extent: EXTENT, ...options })

  assert.equal(readMouseStickAxes(stick), null,
    'a mouse that is not flying must clear its source, not publish a neutral stick')

  // Right is roll right; up the screen — negative offsetY — is pitch up.
  aim(230, 0)
  assert.ok(readMouseStickAxes(stick).roll > 0.3, 'pointing right must roll right')
  assert.equal(readMouseStickAxes(stick).pitch, 0, 'a lateral aim must not touch pitch')

  aim(0, -230)
  assert.ok(readMouseStickAxes(stick).pitch > 0.3, 'pointing up the screen must pull')
  aim(0, -230, { invertPitch: true })
  assert.ok(readMouseStickAxes(stick).pitch < -0.3, 'the inversion setting must reverse pitch')

  /*
  Position, not travel. The same pointer position must give the same stick however it was
  arrived at — this is the property the old relative stick did not have, and the whole reason
  a reversal used to cost two sweeps of the desk instead of one movement of the hand.
  */
  aim(0, -RADIUS)
  const full = readMouseStickAxes(stick).pitch
  aim(0, RADIUS)
  aim(0, 0)
  aim(0, -RADIUS)
  assert.equal(readMouseStickAxes(stick).pitch, full,
    'the same pointer position must give the same stick, whatever route it took')
  assert.equal(full, 1, 'the edge of the gate must be full deflection')

  // A reversal is one movement across the gate and it saturates at the far edge, however far
  // past it the pointer goes.
  aim(0, RADIUS)
  assert.equal(readMouseStickAxes(stick).pitch, -1, 'the far edge must be full opposite stick')
  aim(0, RADIUS * 40)
  assert.equal(readMouseStickAxes(stick).pitch, -1,
    'past the gate must saturate, not accumulate — there is no slack to unwind')

  /*
  The gate is a disc, and this is the assertion that says so. A diagonal must reach full
  deflection at the same distance from the middle as a straight pull; shaped per axis it
  would need 1.41 times as far, and a rolling pull-up would answer unevenly.
  */
  const diagonal = RADIUS / Math.SQRT2
  aim(diagonal, -diagonal)
  const corner = readMouseStickAxes(stick)
  assert.ok(
    Math.abs(Math.hypot(corner.pitch, corner.roll) - 1) < 1e-12,
    `a diagonal must reach full deflection at the gate radius, got ${Math.hypot(corner.pitch, corner.roll)}`,
  )
  assert.ok(
    Math.abs(corner.pitch - corner.roll) < 1e-12,
    'a 45° aim must split evenly between the two axes',
  )

  // Direction survives saturation: a pointer well outside the gate and off to one side must
  // still be flown where it is pointing, not folded into the nearest corner of a box.
  aim(RADIUS * 3, -RADIUS)
  const far = readMouseStickAxes(stick)
  assert.ok(
    Math.abs((far.roll / far.pitch) - 3) < 1e-9,
    `saturation must clamp the length and keep the direction, got ${far.roll / far.pitch}`,
  )

  centreMouseStick(input)
  assert.deepEqual(readMouseStickAxes(stick), { pitch: 0, roll: 0, yaw: 0 },
    'centring must neutralise both axes while the mouse keeps flying')

  /*
  The dead zone is a disc too, and that is a different claim from a wide dead zone. A point
  just outside the old square's edge on one axis but inside the circle must read zero: with
  per-axis shaping it would not, and the aircraft would answer to a pointer the pilot had
  put back in the middle.
  */
  const inside = RADIUS * MOUSE_STICK_GATE.deadZone * 0.7
  aim(inside, -inside)
  assert.deepEqual(readMouseStickAxes(stick), { pitch: 0, roll: 0, yaw: 0 },
    'a diagonal inside the dead-zone disc must read zero on both axes')
  aim(RADIUS * MOUSE_STICK_GATE.deadZone * 1.4, 0)
  assert.ok(readMouseStickAxes(stick).roll > 0,
    'just outside the dead zone must be live, not a second dead band')

  // Soft in the middle, decisive at the edge. Half the gate must be well under half the
  // authority, which is what keeps small corrections placeable.
  aim(RADIUS * 0.5, 0)
  const halfway = readMouseStickAxes(stick).roll
  assert.ok(halfway > 0 && halfway < 0.25,
    `the middle of the gate must stay soft, got ${halfway} at half deflection`)

  /*
  Sensitivity scales the gate and only the gate. Twice the setting must be exactly half the
  screen for the same deflection — anything else and the number in the menu stops describing
  what it does — and the band has to be closed at both ends, because a stored value from an
  older build or a hand-edited entry must never come back as an unflyable aircraft.
  */
  aim(120, 0, { sensitivity: 1 })
  const atUnity = readMouseStickAxes(stick).roll
  aim(60, 0, { sensitivity: 2 })
  assert.ok(Math.abs(readMouseStickAxes(stick).roll - atUnity) < 1e-12,
    'doubling sensitivity must halve the screen a deflection costs, exactly')

  /*
  A positional stick is live wherever the pointer happens to be resting, which a relative one
  never was — it only moved when the hand did. So the keyboard has to be able to take an axis
  back from a pointer nobody is holding, at any deflection including a saturated one, or the
  arrow keys stop working for anyone whose mouse is sitting off to one side of the screen.

  It holds because a held key is ±1 and `strongestAxis` needs a strictly larger deflection to
  override the digital value. Worth asserting rather than inferring: the tie at full stick is
  the whole margin, and a stick that published 1.0000001 would silently take the axis.
  */
  for (const frac of [0.5, 1, 4]) {
    aim(RADIUS * frac, 0)
    input.pressed.add('roll-left')
    for (let frame = 0; frame < 40; frame += 1) {
      setAnalogFlightInput(input, 'mouse-probe', readMouseStickAxes(stick), { direct: true })
      step()
    }
    assert.equal(input.intent.roll, -1,
      `a held arrow key must win the axis from a pointer resting at ${frac}x the gate`)
    input.pressed.clear()
    clearAnalogFlightInput(input, 'mouse-probe')
    for (let frame = 0; frame < 40; frame += 1) step()
  }
  clearMouseStick(input)

  assert.equal(clampMouseSensitivity(0), MOUSE_SENSITIVITY_RANGE.min,
    'sensitivity must not be settable to zero — the mouse would stop flying the aircraft')
  assert.equal(clampMouseSensitivity(99), MOUSE_SENSITIVITY_RANGE.max,
    'sensitivity must stay inside the band a pilot can actually hold')
  assert.equal(clampMouseSensitivity('not a number'), MOUSE_SENSITIVITY_RANGE.default,
    'an unreadable stored setting must fall back to the default, never to NaN')
  centreMouseStick(input)

  clearMouseStick(input)
  assert.equal(readMouseStickAxes(stick), null, 'releasing the pointer must stop the source')
  assert.equal(stick.x, 0,
    'a released stick must be centred, or re-entering the surface starts mid-deflection')

  /*
  The locked pointer. Under Pointer Lock there is no cursor position to read, so the stick is
  walked by raw motion instead — but it is still the same positional stick, and these are the
  properties that say so rather than it having quietly become a relative one.
  */
  {
    const move = (dx, dy, options = {}) => moveMouseStick(input, dx, dy, {
      extent: EXTENT,
      ...options,
    })

    clearMouseStick(input)
    move(0, -RADIUS)
    assert.equal(readMouseStickAxes(stick).pitch, 1,
      'walking the pointer to the edge of the gate must be full deflection')

    // The windup test, and the reason the held position is clamped rather than integrated
    // freely: a hand that has shoved far past the gate must not owe that distance back.
    move(0, -RADIUS * 20)
    assert.equal(readMouseStickAxes(stick).pitch, 1, 'past the gate must saturate, not bank')
    move(0, RADIUS)
    assert.ok(readMouseStickAxes(stick).pitch < 0.01,
      'one gate radius back from saturation must reach neutral, with no slack to unwind')

    // Same place, same stick, whatever route the hand took to get there.
    clearMouseStick(input)
    move(RADIUS * 0.4, 0)
    const direct = readMouseStickAxes(stick).roll
    clearMouseStick(input)
    move(RADIUS * 0.9, 0)
    move(-RADIUS * 0.5, 0)
    assert.ok(Math.abs(readMouseStickAxes(stick).roll - direct) < 1e-12,
      'a locked pointer must still be a position: the same place must give the same stick')

    // Clamped by length, so the gate stays a disc for a locked pointer too.
    clearMouseStick(input)
    move(RADIUS * 9, -RADIUS * 3)
    const far = readMouseStickAxes(stick)
    assert.ok(Math.abs((far.roll / far.pitch) - 3) < 1e-9,
      `a saturated locked pointer must keep its direction, got ${far.roll / far.pitch}`)

    // Free look and a crash reset both centre the stick, and the held position has to go with
    // it — otherwise the first movement afterwards snaps back to a deflection nobody held.
    centreMouseStick(input)
    move(1, 0)
    assert.ok(Math.abs(readMouseStickAxes(stick).roll) < 1e-9,
      'centring must clear the held position, not just the published axes')

    clearMouseStick(input)
  }

  // Direct sources bypass the key-softening filter: the stick must be most of the way to its
  // command inside a few frames, or the airframe visibly trails the hand.
  setAnalogFlightInput(input, 'mouse-stick', { pitch: 0.8 }, { direct: true })
  for (let frame = 0; frame < 6; frame += 1) step()
  assert.ok(input.intent.pitch > 0.8 * 0.85,
    'a direct analogue source must reach its command without the keyboard smoothing lag')
  for (let frame = 0; frame < 12; frame += 1) step()
  assert.equal(input.intent.pitch, 0.8, 'the mouse stick must reach the shared flight intent')
  clearAnalogFlightInput(input, 'mouse-stick')
  for (let frame = 0; frame < 20; frame += 1) step()
  assert.equal(input.intent.pitch, 0, 'a cleared stick source must hand the axis back')

  // The bot is analogue too and is deliberately not direct, so its authored response stands.
  setAnalogFlightInput(input, 'test-bot', { pitch: 0.8 })
  for (let frame = 0; frame < 6; frame += 1) step()
  assert.ok(input.intent.pitch < 0.8 * 0.85,
    'an ordinary analogue source must keep the softened response it was tuned against')
  clearAnalogFlightInput(input, 'test-bot')
  for (let frame = 0; frame < 20; frame += 1) step()
}

/*
W and S name a speed. The three things that matter about that: the command holds where it
was left, it moves at a rate a player can aim with, and it stops at the ends of the band.
*/
setCommandSpeedKmh(input, CRUISE_KMH, envelope)
input.pressed.add('throttle-up')
step()
assert.ok(input.commandSpeedKmh > CRUISE_KMH, 'W must raise the commanded speed')
assert.ok(
  Math.abs((input.commandSpeedKmh - CRUISE_KMH) - (FRAME * envelope.commandKmhPerSecond)) < 1e-9,
  'the command must walk at exactly the authored rate, so a tap is a predictable amount',
)

input.pressed.clear()
const held = input.commandSpeedKmh
for (let frame = 0; frame < 600; frame += 1) step()
assert.equal(input.commandSpeedKmh, held,
  'a released speed command must hold — this is a selector, not a spring')

input.pressed.add('throttle-up')
for (let frame = 0; frame < 600; frame += 1) step()
assert.equal(input.commandSpeedKmh, limits.max, 'the command must stop at the top of the band')
assert.equal(input.throttle, 1, 'a command at or above the local ceiling must ask for full power')
input.pressed.delete('throttle-up')
input.pressed.add('throttle-down')
for (let frame = 0; frame < 600; frame += 1) step()
assert.equal(input.commandSpeedKmh, limits.min, 'the command must stop at the bottom of the band')
assert.equal(input.throttle, envelope.minThrottle,
  'the slowest command must ask for the flight-idle stop')

/*
The number row is not a speed control. It briefly was, and it is gone rather than merely
unbound: the row belongs to weapon selection, and a key that means two things means neither.
W and S are the whole of the speed control.
*/
assert.equal(FLIGHT_BINDINGS.Digit1, undefined, 'the number row must not fly the aircraft')
assert.equal(FLIGHT_BINDINGS.Digit2, undefined, 'the number row must not fly the aircraft')
assert.equal(FLIGHT_BINDINGS.Digit3, undefined, 'the number row must not fly the aircraft')
assert.equal(envelope.speedDetentsKmh, undefined,
  'the envelope must not carry named speeds nothing reads')
input.pressed.clear()
setCommandSpeedKmh(input, CRUISE_KMH, envelope)
input.pressed.add('speed-detent-2')
step()
assert.equal(input.commandSpeedKmh, CRUISE_KMH,
  'a stale detent action must not move the commanded speed')
input.pressed.clear()
step()

// Altitude changes what a speed costs, not what the pilot asked for. Same command, thinner
// air, less power — and the number on the HUD never moves by itself.
input.pressed.clear()
setCommandSpeedKmh(input, 900, envelope)
const lowPower = stepFlightInput(input, FRAME, envelope, 0).throttle
const highPower = stepFlightInput(input, FRAME, envelope, ALTITUDE).throttle
assert.equal(input.commandSpeedKmh, 900, 'altitude must never move the commanded speed')
assert.ok(highPower < lowPower,
  'the same speed must cost less power where the dry ceiling is higher')

setCommandSpeedKmh(input, CRUISE_KMH, envelope)
input.pressed.add('throttle-up')
const accelerating = step()
assert.equal(accelerating.accelerate, true,
  'W alone must publish engine acceleration intent for a PSM exit')
assert.equal(accelerating.decelerate, false, 'W alone must not read as a decelerate command')
assert.equal(accelerating.highG, false, 'W alone must not request a high-G turn')

console.log('PASS input: smooth axes, A/D roll, Space as board and turn with the power cut,'
  + ' post-stall on Left Alt, analogue intent, speed command that holds, a free number row,'
  + ' bounded band,'
  + ' altitude-aware power')
