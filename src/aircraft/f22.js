import { MathUtils, Vector3 } from 'three'

// Every control-surface bone hinges about its own local Y axis, and every nozzle bone
// about its own local X. Those axes already carry the real geometry — 15 degrees of
// trailing-edge sweep on the flaperons and ailerons, 42 degrees of leading-edge sweep
// on the LE flaps, and the 28 degree outward cant of the vertical tails. Rotating them
// about a straight world axis instead shears the part out of the airframe.
const SPAR_AXIS = new Vector3(0, 1, 0)
const NOZZLE_AXIS = new Vector3(1, 0, 0)

// The bone axes mirror between sides, so each hinge is flipped to point in a shared
// direction. A positive angle then means the same thing everywhere — trailing edge down,
// leading edge up on the LE flaps, trailing edge to starboard on the vertical tails, and
// trailing edge up on the nozzles.
const STARBOARD_REFERENCE = new Vector3(0, 0, 1)
const UP_REFERENCE = new Vector3(0, 1, 0)
const PORT_REFERENCE = new Vector3(0, 0, -1)

// [mesh name, hinge axis in bone space, reference direction, deflection limit in degrees].
// The limits are the values keyed in the model's own showcase animation.
const CONTROL_SURFACES = {
  stabilatorLeft: ['Tail_Stabilator_L', SPAR_AXIS, STARBOARD_REFERENCE, 20],
  stabilatorRight: ['Tail_Stabilator_R', SPAR_AXIS, STARBOARD_REFERENCE, 20],
  flaperonLeft: ['Wing_Flaperon_L', SPAR_AXIS, STARBOARD_REFERENCE, 22.6],
  flaperonRight: ['Wing_Flaperon_R', SPAR_AXIS, STARBOARD_REFERENCE, 22.6],
  aileronLeft: ['Wing_Aileron_L', SPAR_AXIS, STARBOARD_REFERENCE, 25],
  aileronRight: ['Wing_Aileron_R', SPAR_AXIS, STARBOARD_REFERENCE, 25],
  leadingEdgeFlapLeft: ['Wing_LEFlap_L', SPAR_AXIS, STARBOARD_REFERENCE, 11.4],
  leadingEdgeFlapRight: ['Wing_LEFlap_R', SPAR_AXIS, STARBOARD_REFERENCE, 11.4],
  rudderLeft: ['Tail_VerticalFin_L', SPAR_AXIS, UP_REFERENCE, 22.6],
  rudderRight: ['Tail_VerticalFin_R', SPAR_AXIS, UP_REFERENCE, 22.6],

  nozzleLeftFlapUpper: ['Engine_Nozzle_L_Flap_Upper', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleLeftFlapLower: ['Engine_Nozzle_L_Flap_Lower', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleLeftVaneUpper: ['Engine_Nozzle_L_Vane_Upper', NOZZLE_AXIS, PORT_REFERENCE, 10],
  nozzleLeftVaneLower: ['Engine_Nozzle_L_Vane_Lower', NOZZLE_AXIS, PORT_REFERENCE, 10],
  nozzleRightFlapUpper: ['Engine_Nozzle_R_Flap_Upper', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleRightFlapLower: ['Engine_Nozzle_R_Flap_Lower', NOZZLE_AXIS, PORT_REFERENCE, 20],
  nozzleRightVaneUpper: ['Engine_Nozzle_R_Vane_Upper', NOZZLE_AXIS, PORT_REFERENCE, 10],
  nozzleRightVaneLower: ['Engine_Nozzle_R_Vane_Lower', NOZZLE_AXIS, PORT_REFERENCE, 10],
}

// Vectoring geometry read straight off the showcase (frames 381-700): the flap on the
// side the exhaust turns toward swings 20 degrees, its opposite number follows at 8, and
// the vane on that side closes 10 degrees the other way. Perfectly mirrored for the
// opposite direction, so one function covers both.
function nozzleAngles(vector, side) {
  const up = Math.max(vector, 0)
  const down = Math.max(-vector, 0)
  return {
    [`nozzle${side}FlapUpper`]: (up * 20) - (down * 8),
    [`nozzle${side}FlapLower`]: (up * 8) - (down * 20),
    [`nozzle${side}VaneUpper`]: up * -10,
    [`nozzle${side}VaneLower`]: down * 10,
  }
}

// Aerodynamic sign convention, positive as defined on the hinges above. Nose up needs
// the tail pushed down, so the stabilators and the flaperons (which act as elevons) go
// trailing edge up. Rolling right needs more lift on the left wing, so the left surfaces
// go trailing edge down. Both vertical tails deflect together for yaw, and the LE flaps
// droop with the flaps.
//
// Returns degrees per surface name. Both the airframe viewer and the flight range drive
// the same mixing; only thrust vectoring differs, because the range renders no nozzles.
function mixControlSurfaces(
  { pitch = 0, roll = 0, yaw = 0, flaps = 0 },
  { thrustVectoring = false } = {},
) {
  const flapSetting = MathUtils.clamp(flaps, 0, 1)
  const angles = {
    stabilatorLeft: (pitch * -20) + (roll * 8),
    stabilatorRight: (pitch * -20) - (roll * 8),
    aileronLeft: roll * 25,
    aileronRight: -roll * 25,
    flaperonLeft: (pitch * -10) + (roll * 15) + (flapSetting * 22),
    flaperonRight: (pitch * -10) - (roll * 15) + (flapSetting * 22),
    leadingEdgeFlapLeft: flapSetting * -11,
    leadingEdgeFlapRight: flapSetting * -11,
    rudderLeft: yaw * 22,
    rudderRight: yaw * 22,
  }

  if (!thrustVectoring) return angles

  // Turning the exhaust up pushes the tail down for nose up, so pitch drives both
  // engines together. Roll is differential: for a right roll the left engine turns its
  // exhaust down and lifts that wing.
  return {
    ...angles,
    ...nozzleAngles(MathUtils.clamp(pitch - (roll * 0.5), -1, 1), 'Left'),
    ...nozzleAngles(MathUtils.clamp(pitch + (roll * 0.5), -1, 1), 'Right'),
  }
}

// Cockpit interiors, stowed weapons, gear legs, and bay internals are never visible from
// the chase camera but cost draw calls every frame. Purely F-22 mesh names.
function isFlightDetail(name) {
  if (/^(Cockpit_|Seat_|Wpn_)/.test(name)) return true
  if (/^(MLG_|NLG_)/.test(name) && !/(Door|BayFairing)/.test(name)) return true
  if (/^Bay_/.test(name) && !/(Door|Fairing|Seam|Edge|Seal|Strip)/.test(name)) return true
  if (/^Hook_(Actuator|Point|Shank|Pivot|Trunnion)/.test(name)) return true
  return /Launcher(Arm|Rail)/.test(name)
}

const CLIP_METADATA = {
  WeaponBay_Main_L_Open: {
    label: 'Main weapon bay · left',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  WeaponBay_Main_R_Open: {
    label: 'Main weapon bay · right',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  WeaponBay_Side_L_Open: {
    label: 'Side weapon bay · left',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  WeaponBay_Side_R_Open: {
    label: 'Side weapon bay · right',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  Canopy_Open: {
    label: 'Canopy',
    activeLabel: 'OPEN',
    inactiveLabel: 'CLOSED',
  },
  LandingGear_Deploy: {
    label: 'Landing gear',
    activeLabel: 'DOWN',
    inactiveLabel: 'UP',
  },
  Aero_Demo: {
    label: 'Aerodynamic demo',
    activeLabel: 'ACTIVE',
    inactiveLabel: 'REST',
  },
  Tailhook_Deploy: {
    label: 'Tail hook',
    activeLabel: 'DOWN',
    inactiveLabel: 'UP',
  },
}

// Everything a surface needs to know about this airframe. A second aircraft ships its
// own module with the same shape; nothing in features/ or three/ knows the F-22 exists.
const f22 = {
  id: 'f22',
  displayName: 'F-22 Raptor',
  // What the panel headings call it where a full name will not fit.
  shortName: 'F-22',
  url: '/F22_model.glb',

  controlSurfaces: CONTROL_SURFACES,
  mixControlSurfaces,
  thrustVectoring: true,
  clipMetadata: CLIP_METADATA,

  // Two loose bay fittings float away from the airframe in the export.
  removedObjects: ['MLG_Bay_Fitting_01', 'MLG_Bay_Fitting_02'],

  // Nozzle petals the exhaust plume brackets. The exit point and the plume direction are
  // derived from these nodes, so vectoring steers the flame for free.
  engines: [
    {
      id: 'left',
      flapUpper: 'Engine_Nozzle_L_Flap_Upper',
      flapLower: 'Engine_Nozzle_L_Flap_Lower',
    },
    {
      id: 'right',
      flapUpper: 'Engine_Nozzle_R_Flap_Upper',
      flapLower: 'Engine_Nozzle_R_Flap_Lower',
    },
  ],

  viewer: {
    // Longest axis in world units, and the resting three-quarter pose.
    scale: 9.8,
    restAttitude: [0.04, -0.34, 0],
    // Attitude rates in degrees per second for the viewer's on-the-spot manual flight.
    rates: { pitch: 38, roll: 54, yaw: 30 },
  },

  flight: {
    scale: 7,
    isFlightDetail,

    // The vapour sheet a hard pull lays over the wing. Two mesh lists, because the sheet
    // needs two different things from the airframe.
    //
    // `wingMeshes` bounds the footprint — how far forward, how far aft, how far out the
    // effect is allowed to reach at all. The leading-edge flaps give the leading edge and
    // the span, the ailerons and flaperons give the trailing edge. Keeping it to the wing's
    // own surfaces is what stops the cloud from wandering up the nose.
    //
    // `planformMeshes` is what the outline and the drape are rasterised from inside that
    // window: the fuselage (which carries the wing skin and the LEX in one mesh here), the
    // wing surfaces, and the stabilators, which the cloud reaches once it is streaming aft.
    // Deliberately not the vertical tails or the canopy — they stand well above the upper
    // surface, and a sheet draped over their height would hang in the air off the spine.
    //
    // Lengths are fractions of the wing chord. Onsets are the flight-model state the
    // suction is read from; see features/flight/condensation.js for what they mean.
    condensation: {
      wingMeshes: [
        'Wing_LEFlap_L',
        'Wing_LEFlap_R',
        'Wing_Aileron_L',
        'Wing_Aileron_R',
        'Wing_Flaperon_L',
        'Wing_Flaperon_R',
      ],
      planformMeshes: [
        'Body_Fuselage_Main',
        'Wing_LEFlap_L',
        'Wing_LEFlap_R',
        'Wing_Aileron_L',
        'Wing_Aileron_R',
        'Wing_Flaperon_L',
        'Wing_Flaperon_R',
        'Tail_Stabilator_L',
        'Tail_Stabilator_R',
      ],
      // How far past the trailing edge the sheet still streams before it shreds, and how
      // far outboard of the tips it is allowed to reach.
      chordExtension: 0.16,
      spanMargin: 0.04,
      // Chordwise cells the planform is measured in. At this figure a cell is about two
      // centimetres of real wing, which is finer than the leading edge is sharp.
      resolution: 192,
      // How far the outline is softened, and where in that soft edge the cloud starts and
      // finishes. Together they hold the vapour just inside the wing rather than letting it
      // stop dead at the tip rib — an edge this thin would otherwise alias badly side-on.
      edgeFeather: 0.03,
      edge: [0.5, 0.85],
      // How far aft the wing's shape survives in the air that has left it. Past roughly
      // this much chord the streaming cloud has forgotten what shed it.
      wakeLength: 0.1,
      // Clear of the skin so the sheet never cuts through the wing, and bulging at the
      // suction peak the way a constant-pressure surface does. It needs no arch over the
      // spine: it is draped on the measured upper surface, so the fuselage lifts it.
      standoff: 0.025,
      billow: 0.09,
      // A cloud has depth. Four sheets, each sitting a little higher and a little further
      // inside the one below it, each carrying its own patch of the same noise field, read
      // as one thick blanket instead of one flat decal.
      layers: 4,
      layerLift: 0.05,
      // Measured against what the flight model actually pulls, not against the airframe's
      // paper limit: the demonstration loop peaks at about three and a half G, and only a
      // deliberate hard pull gets past six. Set at the old two-and-a-half, a loop showed a
      // tenth of a sheet and the effect never appeared in normal flying. Level flight is
      // still nothing at all — one G is far below the onset — but a turn worth watching now
      // shows something, and the wing has to be genuinely near its limit to close it up.
      onsetG: 1.8,
      fullG: 5.5,
      // Angle of attack keeps the cloud alive through a slow nose-high pull where the load
      // factor has already dropped away, but it never makes as much of it as the pull did.
      aoaOnsetDeg: 12,
      aoaFullDeg: 28,
      aoaWeight: 0.85,
      // No dynamic pressure, no suction: below the first figure the wing makes no cloud at
      // any load, and above the second the speed is no longer what is holding it back. The
      // window is low deliberately — the airshow passes this effect is drawn from are slow
      // and nose-high, and a gate set at fighting speed would erase exactly those.
      minKmh: 260,
      fullKmh: 560,
      // Condensing is quicker than clearing — the air has to be mixed and re-warmed before
      // the sheet goes, which is why it hangs on a beat after the pull is released.
      onsetPerSecond: 6,
      decayPerSecond: 2.2,
    },

    // Flight-range envelope. Published airspeed follows the supplied F-22 performance
    // table; kmhPerWorldUnitPerSecond maps it back onto the compact arcade terrain without
    // making a Mach 2 pass cross the entire range in a few seconds.
    envelope: {
      idleThrottle: 0.42,
      minThrottle: 0.08,
      throttleRate: 0.34,
      // Reheat is a fuel state, not a switch. The F119 pushes roughly three times its dry
      // fuel flow in afterburner, so the airframe carries a burst of it rather than
      // minutes of it: hold the burner, watch the reserve drain, and get it back only
      // after the nozzle has been cold long enough to matter. Draining the reserve to
      // zero blows the burner out and locks it until enough has come back to relight,
      // which is what stops reheat from being held on permanently by tapping it.
      afterburner: {
        // Reheat lights at any throttle, from any speed. It is a burst of thrust bolted on
        // top of whatever the core is already doing, so it is worth most exactly where the
        // dry engine is worth least — slow, low, and needing speed now.
        burnSeconds: 8,
        recoverySeconds: 22,
        // The nozzle has to be cold before the tanks start giving anything back, or
        // chattering the key would refill it for free.
        recoveryDelaySeconds: 1.5,
        // After a burnout the reserve has to climb this far before it will relight, which
        // with the dwell above is the cooldown the third gauge counts down.
        relightReserve: 0.32,
        // Light-off is quick, shutdown quicker: about 1.2 s up and 0.6 s down.
        spoolUpPerSecond: 0.85,
        spoolDownPerSecond: 1.7,
      },
      performance: {
        minKmh: 260,
        kmhPerWorldUnitPerSecond: 22,
        // Compressed the same way the terrain is: a real Raptor takes tens of seconds to
        // do what the range does in a few. The ratio between dry and reheat is the honest
        // part — excess thrust in afterburner is roughly double what military power has
        // left over once drag is paid for.
        accelerationKmhPerSecond: 130,
        afterburnerAccelerationKmhPerSecond: 265,
        decelerationKmhPerSecond: 190,
        // Drag climbs with speed, so acceleration falls away toward the limit rather than
        // holding one flat figure, and a jet coasting down after the burner cuts sheds the
        // gap it is carrying instead of braking at a constant rate.
        dragFalloff: 0.45,
        dragDecayPerSecond: 0.55,
        seaLevel: {
          dryKmh: 1100,
          dryMach: 0.95,
          afterburnerKmh: 1482,
          afterburnerMach: 1.2,
        },
        highAltitude: {
          worldUnits: 800,
          supercruiseMinKmh: 1850,
          supercruiseMinMach: 1.5,
          dryKmh: 2230,
          dryMach: 1.82,
          afterburnerKmh: 2414,
          afterburnerMach: 2.25,
        },
      },
      // Normal-mode body rate ceilings, degrees per second. High-AoA mode has its own
      // pitch and roll ceilings in `maneuvering`.
      pitchRate: 58,
      rollRate: 120,
      yawRate: 42,

      /*
      Tuning for the 6-DOF-lite flight model in features/flight/flightModel.js. Speeds are
      km/h (the pilot's unit); accelerations are world units per second squared at the
      reference speed; alignment, damping, and response values are per-second gains.
      Everything here is scaled to the compressed range, not to the real atmosphere.
      */
      maneuvering: {
        gravity: 9,
        referenceSpeed: 50,
        liftGain: 175,
        sideForceGain: 55,

        stallAoADeg: 26,
        // Past the stall the lift is gone by about twenty degrees, not eighty: a wing
        // still making most of its lift at 40 degrees keeps pulling the flight path
        // round with the nose, and a Cobra is precisely the manoeuvre where it must not.
        postStallLiftEndDeg: 46,
        postStallLiftFloor: 0.12,
        normalAoALimitDeg: 24,
        // Far enough past the vertical for the nose to lie down along the flight path,
        // which is the pose the manoeuvre is named for.
        highAoALimitDeg: 105,
        aoaLimitSoftnessDeg: 9,
        negativeAoAFactor: 0.55,

        // The nose has to beat the flight path to deep AoA, not merely lead it: what
        // separates a Cobra from a hard pull is the ratio between the two rates.
        highAoAPitchRateDeg: 240,
        highAoARollRateDeg: 60,
        maxG: 9,
        maxNegativeG: 3.5,

        // The Cobra window sits where the physics puts it: fast enough that there is
        // energy to trade, slow enough that lift can no longer swing the flight path
        // after the nose. Above it the same stick is just a very hard pull.
        cobraPitchBoost: 1.35,
        cobraMinKmh: 380,
        cobraMaxKmh: 820,

        // What `detectManeuver` calls a Cobra, and the two-sided test that keeps a loop
        // from answering to the name: the nose this far off the airstream while the
        // trajectory is bending no faster than this. A hard pull satisfies the first and
        // never the second.
        cobraMinAoADeg: 62,
        cobraMaxPathRateDeg: 26,
        pathRateResponse: 9,

        // Pedal turns exist only nose-high and slow; the boost multiplies yaw authority
        // inside that window and nowhere else.
        pedalTurnMaxKmh: 560,
        pedalTurnMinPitchDeg: 55,
        pedalTurnYawBoost: 2.4,

        inputResponse: 7,
        pitchResponse: 5.5,
        rollResponse: 9,
        yawResponse: 3.5,

        authorityRefSpeed: 34,
        postStallSurfaceLoss: 0.6,

        thrustVectorEffectiveness: 0.55,
        maxThrustVectorDeg: 20,
        thrustVectorResponse: 8,
        normalThrustVectorFactor: 0.35,

        noseAlignment: 1.6,
        highAoANoseAlignment: 0.22,
        velocityAlignment: 1.5,
        highAoAVelocityAlignment: 0.12,
        sideslipDamping: 1.4,
        autoLevelGain: 0.35,
        // The leveller's window: outside this bank the wings stay where the pilot left
        // them, so held banks and inverted flight are the pilot's business.
        autoLevelMaxBankDeg: 15,
        spinDamping: 2.2,

        aoaDragGain: 26,
        highAoADragMultiplier: 1.6,
        sideslipDragGain: 9,
        airBrakeDrag: 12,
        flapsDrag: 4,

        recoveryMinKmh: 320,
      },
    },
  },

  // What this airframe carries, by weapon id from src/weapons. The registry there owns
  // every detail of the weapon itself; the airframe states only which ones are its own,
  // how many, and where they ride. A second airframe lists its own weapons the same way.
  weapons: [
    { id: 'aim9', count: 2, station: 'Side bay' },
    { id: 'aim120', count: 6, station: 'Main bay' },
  ],

  // Reserved for the missile milestone: named nodes the weapons hang from.
  hardpoints: [],
}

export default f22
