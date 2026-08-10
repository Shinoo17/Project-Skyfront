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
        'Canopy_Glass',
        'Canopy_Frame_Rear',
        'Wing_LEFlap_L',
        'Wing_LEFlap_R',
        'Wing_Aileron_L',
        'Wing_Aileron_R',
        'Wing_Flaperon_L',
        'Wing_Flaperon_R',
        'Tail_Stabilator_L',
        'Tail_Stabilator_R',
      ],
      // How far past the tail the veil still streams before it shreds, as a fraction of the
      // wing chord, and how far outboard of the tips it is allowed to reach.
      chordExtension: 0.16,
      // Wide enough outboard that the feathered outline has air to fade into. At the old
      // hairline margin the fade ran out of texture at the tip and the cloud finished on
      // the metal, which is the one place the eye cannot see it finish.
      spanMargin: 0.12,
      // Cells along the aircraft the planform is measured in. At this figure a cell is about
      // three centimetres of real airframe, which is finer than the leading edge is sharp.
      resolution: 256,
      // How far the outline is softened, and where in that soft edge the cloud starts and
      // finishes. Together they hold the vapour just inside the wing rather than letting it
      // stop dead at the tip rib — an edge this thin would otherwise alias badly side-on.
      // The feather is the width of the fade in real metres — about half a metre of wing at
      // this figure — and the window is deliberately opened wide inside it, low end first,
      // so the cloud spends that whole band thinning out rather than the inner third of it.
      edgeFeather: 0.07,
      edge: [0.25, 0.8],
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
      // How much of the wing's sheet the rest of the airframe carries. The same pull that
      // condenses a thick sheet over the wing lays a thin veil over the whole upper surface,
      // and the photographs show the aircraft plainly through it — so this is deliberately
      // low, and it is what makes the effect read as vapour rather than as paint.
      haze: 0.3,
      // Alpha per layer, from the faintest pull to the hardest. Four layers compound, so the
      // second figure is not what the cloud looks like — turning it up past about 0.55 is
      // where the airframe starts disappearing under it.
      opacity: [0.16, 0.24],
      // Where the noise gets cut into cloud, weak pull to hard. The hard end stays well
      // above zero so even a maximum pull keeps holes in the sheet to see the aircraft
      // through; lower it toward 0.1 for the solid white blanket of a humid-day airshow.
      density: [0.46, 0.28],
      // How much harder the noise has to work at the edge of the cloud than in the middle,
      // added to the cut where coverage has run out entirely. This is what gives the sheet
      // a fallout rather than an outline: the last of it breaks into wisps over a band of
      // its own, on top of the alpha already tapering. Too low and the cloud ends on a line
      // again; past about 0.45 the wing sheet starts losing its own edges as well.
      falloff: 0.3,
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
      // W and S do not move a power lever, they name a speed: the pilot asks for 900 and
      // the aircraft goes and gets 900. Power is derived from that number rather than
      // selected directly, which is the whole arcade simplification — one control, one
      // unit, and the same unit the HUD already shouts in.
      //
      // Per second of held key, and deliberately quick: this is the same authority the old
      // power lever had, so a dogfight can still dump or restore its whole energy state in
      // about a second and a half. Slowing it down makes the aircraft feel like it is
      // arguing with the pilot, and the engine is already the thing that decides how fast
      // the speed actually arrives — the command is only how fast it can be asked for.
      commandKmhPerSecond: 1320,
      // S is one arcade slow-down intent. It lowers the power lever and opens enough brake
      // to be immediately readable without making a short throttle correction dump all of
      // the aircraft's energy. A committed pull promotes it to the full high-G brake.
      deceleration: {
        airBrakeLevel: 0.65,
        fullBrakePitch: 0.72,
      },
      // Reheat is a fuel state, not a switch. The F119 pushes roughly three times its dry
      // fuel flow in afterburner, so the airframe carries a burst of it rather than
      // minutes of it: hold the burner, watch the reserve drain, and get it back only
      // after the nozzle has been cold long enough to matter. Draining the reserve to
      // zero blows the burner out and locks it until enough has come back to relight,
      // which is what stops reheat from being held on permanently by tapping it.
      afterburner: {
        // Shift is the game-friendly equivalent of pushing the throttle through its MIL
        // detent: the core runs toward full power first, and reheat may light only once
        // enough airflow is passing through the tailpipe.
        coreTarget: 1,
        ignitionCorePower: 0.85,
        burnSeconds: 8,
        recoverySeconds: 14,
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
        // The pilot moves a power lever, the engine follows with inertia, and thrust rises
        // progressively rather than giving half throttle the same acceleration as MIL.
        engineSpoolUpResponse: 5.5,
        engineSpoolDownResponse: 6.5,
        throttlePowerExponent: 1.35,
        // A running F119 still makes useful thrust at flight idle. Keeping that floor in
        // both thrust and drag preserves the authored trim speeds while preventing a
        // partial-power vertical manoeuvre from behaving like an engine flameout.
        idleThrustFraction: 0.18,
        // Compressed the same way the terrain is: a real Raptor takes tens of seconds to
        // do what the range does in a few. The ratio between dry and reheat is the honest
        // part — excess thrust in afterburner is roughly double what military power has
        // left over once drag is paid for.
        accelerationKmhPerSecond: 190,
        afterburnerAccelerationKmhPerSecond: 370,
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
      // Conventional body-rate ceilings, degrees per second. The automatic post-stall
      // envelope blends toward its own pitch and roll ceilings in `maneuvering`.
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

        // Where the wing starts running out of linear lift, and where it has run out. The
        // onset figure drives the HUD's approach-to-the-stall readout only; the stall angle
        // itself is what the aerodynamics are built on.
        stallOnsetDeg: 16,
        stallAoADeg: 26,
        // Arcade stall keeps a useful residual lift floor so recovery is forgiving. The
        // wing still sheds enough across this short range for an assisted Cobra to leave
        // the velocity vector behind instead of turning into a conventional loop.
        postStallLiftEndDeg: 52,
        postStallLiftFloor: 0.28,
        // Conventional response still widens with commitment, but an F-22 with Maneuver
        // Assist keeps the positive-AoA side behind a separate protected fence. The
        // negative side retains its existing push-over authority.
        normalAoALimitDeg: 24,
        performanceAoALimitDeg: 30,
        stallProtectionAoALimitDeg: 24,
        performancePullThreshold: 0.72,
        /*
        Far enough past the vertical for the nose to lie down along the flight path, which
        is the pose the manoeuvre is named for — and now far enough for it to keep going.

        The ceiling is 150 rather than the 180-and-over a tumble travels through, because
        alpha is an atan2 and wraps: a nose passing straight over the top takes it from +179
        to -179, and a fence set past the wrap can never engage. What the number therefore
        buys is the last stretch of a committed pull before the beam. Past it the tumble is
        held up by nothing but the pilot's stick against the weathervane floor and the drag
        bill, which is the intended trade — it is a manoeuvre that costs energy to fly and
        rights itself the moment the stick is released.
        */
        postStallAoALimitDeg: 120,
        // A progressive fade reaches zero at the protected limit. If inertia carries alpha
        // beyond it, a small restorative rate demand helps the pilot rather than waiting
        // for a full departure.
        aoaLimitSoftnessDeg: 10,
        stallProtectionRangeDeg: 5,
        stallProtectionPitchRateDeg: 46,
        negativeAoAFactor: 0.55,

        // The nose has to beat the flight path to deep AoA, not merely lead it: what
        // separates a Cobra from a hard pull is the ratio between the two rates.
        postStallPitchRateDeg: 210,
        // The nose has to be able to come round the flight path as well as over it, or a
        // Cobra is a pose rather than a way of pointing the aircraft somewhere. 60 was the
        // rate a wing that had stopped flying could still ask for; this is the rate the
        // engines can, and it is what makes the tumble exit in a chosen direction.
        postStallRollRateDeg: 150,
        maxG: 9,
        maxNegativeG: 3.5,

        /*
        Thin air: the continuous physical baseline underneath the arcade PSM assist.

        Above `thinAirNoneKmh` the wing is fully in charge and the aircraft is a
        conventional fighter — conventional alpha fence, conventional pitch rate, nozzles
        held to their normal schedule. Below `thinAirFullKmh` the airstream has stopped
        being able to enforce anything and the nozzles are the only vote that counts.
        Between the two it is a smooth interpolation with no threshold, no latch, and no
        test on what the pilot is asking for.

        The top of the window sits below the speeds the loop, split-s and immelmann scripts
        actually fly, so those manoeuvres never see a widened envelope; it sits above the
        Cobra and pedal-turn band, which is where an F-22 does exactly this for real.
        */
        thinAirFullKmh: 460,
        thinAirNoneKmh: 760,

        // Centred-stick recovery toward the airstream. Gated on measured alpha and on the
        // stick alone. The onset factor keeps it clear of attitudes that are merely
        // nose-high — a hands-off 30-degree pitch attitude is not a departure and must not
        // be quietly flown out of.
        postStallRecoveryOnsetFactor: 1.1,
        postStallRecoveryRangeDeg: 28,
        postStallRecoveryStickThreshold: 0.4,
        postStallRecoveryPitchRateDeg: 70,
        // How many degrees past the stall count as fully post-stall, for the HUD readout,
        // the vapour effect, and the separated-flow drag surcharge.
        postStallDisplayRangeDeg: 30,
        // Airflow remains meaningful almost to the apex of a tailslide. Below this the last
        // coherent angle is held until gravity gives the airframe a direction again.
        airflowSenseMinKmh: 12,
        backwardFlightThresholdKmh: 8,

        // What `detectManeuver` calls a Cobra, and the two-sided test that keeps a loop
        // from answering to the name: the nose this far off the airstream while the
        // trajectory is bending no faster than this. A hard pull satisfies the first and
        // never the second.
        cobraMinAoADeg: 62,
        cobraMaxPathRateDeg: 26,
        // And what separates a tumble from the Cobra it passes through: the nose is not
        // merely off the airstream, it is still going round. Measured off nose-off-path,
        // which does not wrap, and off a pitch rate that has not stopped.
        tumbleMinNoseOffDeg: 110,
        tumbleMinPitchRateDeg: 55,
        pathRateResponse: 9,
        // What separates the yaw-coupled J-turn from a pure-pitch Cobra, and the yaw rate a
        // pedal turn has to actually be producing before it earns the name. Labels only:
        // `detectManeuver` reads the physics, it never feeds it.
        jTurnMinSideslipDeg: 4,
        pedalTurnMinYawRateDeg: 18,
        tailslideMinPitchDeg: 55,
        tailslideMinNoseOffDeg: 150,
        tailslideMinReverseKmh: 22,
        tailslideMaxKmh: 260,
        flatTurnMaxKmh: 430,
        flatTurnMinYawRateDeg: 22,
        // How far alpha has to fall before the HUD stops calling it a recovery — the second,
        // lower figure applies once the label is already showing, so it does not flicker.
        recoveryLabelEnterFactor: 0.6,
        recoveryLabelHoldFactor: 0.45,

        // Pedal turns exist only nose-high and slow; the boost multiplies yaw authority
        // inside that window and nowhere else. The two blend spans are how wide the edges of
        // that window are — degrees of pitch attitude, and km/h of airspeed.
        pedalTurnMaxKmh: 560,
        pedalTurnMinPitchDeg: 45,
        pedalTurnPitchBlendDeg: 18,
        pedalTurnSpeedBlendKmh: 308,
        pedalTurnYawBoost: 2.4,
        pedalTurnYawShare: 0.4,
        postStallYawBoost: 1.2,
        postStallYawMinPitchDeg: 20,
        postStallYawPitchBlendDeg: 20,
        // Rudders are slightly less effective than the pitch and roll surfaces at the same
        // dynamic pressure. The ceiling is above 1 because the pedal-turn and post-stall
        // boosts are allowed to stack on top of plain airflow.
        yawSurfaceShare: 0.9,
        maxYawAuthority: 2.2,

        pitchResponse: 5.5,
        rollResponse: 9,
        yawResponse: 3.5,

        authorityRefSpeed: 34,
        // Control power follows dynamic pressure. Pure q (exponent 2) over a range that
        // spans 180 to 1500 km/h leaves the jet unflyable at the bottom; linear (the old
        // behaviour) let it roll at 48 deg/s while barely moving, which is what made slow
        // flight feel like a turntable. This sits between: roughly 20 deg/s of roll at
        // 180 km/h, still 115 by 700.
        authorityExponent: 1.15,
        postStallSurfaceLoss: 0.32,
        // The alpha at which separated flow has taken everything it is going to take from
        // the surfaces, and the window over which roll authority sheds against alpha. Roll
        // goes first and goes further: the ailerons are out at the wingtips, which is where
        // the flow breaks down first.
        surfaceLossFullAoADeg: 70,
        rollAuthorityOnsetDeg: 20,
        rollAuthorityRangeDeg: 45,
        rollAuthorityAoALoss: 0.35,
        // What the engines put back once the wingtips have stopped voting: differential
        // tail in the efflux, and a nozzle contribution the real airframe does not have.
        // Scaled by thin air and by thrust, so it is worth nothing at fighting speed and
        // nothing at idle — a tumble has to be flown under power. The ceiling is the same
        // stacking ceiling `maxYawAuthority` is, and for the same reason: `rollAuthority`
        // multiplies the rate ceiling rather than approaching it.
        postStallRollBoost: 1.5,
        maxRollAuthority: 1.35,
        // How much of the rate response survives when an axis has no aerodynamic authority
        // left. This is the FCS rate loop — gyro in, nozzle out — so it never goes to zero,
        // but below it the airframe's own inertia is what the pilot is fighting.
        rateResponseFloor: 0.62,

        // How much nozzle authority the spooled core and the reheat each vouch for. This is
        // what stops a 5% throttle claiming the vectoring a full-burner pull has: the numbers
        // are read off the engine that is actually running, not off the lever.
        coreThrustShare: 0.75,
        reheatThrustShare: 0.5,

        thrustVectorEffectiveness: 0.65,
        maxThrustVectorDeg: 20,
        thrustVectorResponse: 8,
        normalThrustVectorFactor: 0.35,

        // Hands-off attitude is rate-damped, not levelled. Lift and gravity own the flight
        // path, so a bank cannot be cancelled by an invisible horizon or velocity assist.
        // This is only the rudder's light weathervane stability; the side-force calculation
        // still owns how the velocity itself sheds sideslip.
        sideslipDamping: 0.55,
        // Longitudinal weathervane, rad/s of restoring pitch rate at the reference dynamic
        // pressure with the airstream square onto the airframe. This is the airstream's own
        // moment, not a control surface, so no stick input and no fence can switch it off —
        // it is what stops a held-back stick parking the nose while the flight path falls
        // away behind it. Both weathervanes saturate their q term at the same rate.
        pitchWeathervane: 18,
        // Where the restoring moment starts and where it is fully in. The onset sits above
        // the Cobra band on purpose: below the beam a vectored fighter really can hold the
        // nose off the airstream, and this term must not take that away. Past the beam the
        // airframe is broadside or backwards to the flow and no held stick should win.
        pitchWeathervaneOnsetDeg: 88,
        pitchWeathervaneRangeDeg: 40,
        // How much of that moment survives a pull held against the stops — the one thing
        // allowed to lean on it, and the reason a tumble is flyable at all. A floor rather
        // than an off switch: at a quarter strength the airstream still argues, flying
        // backwards is still not somewhere the airframe can settle, and letting go of the
        // stick still restores the moment whole and rights the jet.
        pitchWeathervaneTumbleFloor: 0.25,
        // Ceiling on the restoring rate, deg/s. The gain above is calibrated for the low
        // dynamic pressure this term actually operates at; unbounded, the same gain with the
        // q factor saturated would command four figures. Inactive at every condition the
        // checks reach — it exists so the stabiliser can never become a catapult.
        pitchWeathervaneMaxRateDeg: 90,
        weathervaneQScale: 2,
        spinDamping: 2.6,
        // Deep post-stall the roll and yaw commands are bled off over this many degrees past
        // the stall, so the jet mushes instead of departing.
        spinGuardRangeDeg: 30,
        spinGuardRollLoss: 0.22,
        spinGuardYawLoss: 0.16,

        // Bounded, deterministic falling-leaf coupling. The phase is internal physical
        // memory; the blend itself is continuous and disappears as soon as the pilot moves
        // an axis, airspeed returns, or the sink stops.
        fallingLeafFullKmh: 150,
        fallingLeafNoneKmh: 330,
        fallingLeafMinSink: 1.5,
        fallingLeafSinkRange: 5,
        fallingLeafInputThreshold: 0.06,
        fallingLeafFrequencyHz: 0.7,
        fallingLeafRollRateDeg: 6,
        fallingLeafYawRateDeg: 4,
        fallingLeafYawPhaseRad: 1.15,
        fallingLeafLabelThreshold: 0.32,

        aoaDragGain: 26,
        postStallDragMultiplier: 1.25,
        // What the separated-flow bill decays to once the airframe has come round past
        // broadside and is meeting the air the other way. Held at 1 instead, a tumble stops
        // dead in about a second; at zero — which is what an unclamped sine gives — it costs
        // nothing at all and the manoeuvre is free.
        beyondBeamDragFactor: 0.62,
        sideslipDragGain: 9,
        postStallSideForceFactor: 0.35,
        airBrakeDrag: 12,
        flapsDrag: 4,

        /*
        High-G turn. The other half of the two-button arcade scheme, and deliberately not
        the same half as the block below it.

        This is a max-performance *aerodynamic* turn: the FCC is allowed a faster pitch
        rate, a higher structural G ceiling, a slightly wider alpha fence and a quicker
        roll into the turn — and it is billed for all of it in induced drag. Nothing here
        touches `envelopeOpen`, the post-stall alpha limit, or the PSM state machine, so
        holding Space can never produce a Cobra.

        `aoaLimitDeg` is the number that keeps the regimes apart. It sits just under
        `stallAoADeg`, which means a maximum high-G pull leaves the wing flying: the nose
        stays near the flight path, `postStallActive` stays false, and the HUD never labels
        a hard turn as post-stall. The turn rate is bought with pitch rate and G, not with
        separation.
        */
        highGTurn: {
          capable: true,
          // Structural ceilings while the trigger is held. The pitch rate is what the pilot
          // feels at fighting speed; the G ceiling is what binds once fast enough that the
          // load factor, not the rate loop, is the limit.
          pitchRateDeg: 96,
          rollRateDeg: 155,
          maxG: 12,
          aoaLimitDeg: 25.5,
          // Induced drag surcharge on top of the alpha the harder pull is already making.
          // The alpha term alone is worth roughly a third of the bleed; this is what makes
          // a sustained high-G turn a decision rather than a free upgrade.
          dragMultiplier: 2.2,
          /*
          Energy gate. A wing with no dynamic pressure cannot make a high-G turn, and
          without this the pitch-rate ceiling would be the only lever still active down
          there — which is a slow aircraft spinning on the spot, i.e. the thing Alt is for.
          Below `lowEnergyKmh` the trigger is worth `lowEnergyAuthority` of itself.
          */
          lowEnergyKmh: 300,
          fullEnergyKmh: 640,
          lowEnergyAuthority: 0.22,
          // Blended in and out rather than switched, so the turn tightens and eases instead
          // of stepping. Release is slower than engage: energy already spent stays spent.
          engageResponse: 6,
          releaseResponse: 4,
        },

        /*
        Explicit arcade PSM assist. This block is aircraft-owned: another manifest may omit
        it, narrow the speed window, or provide weaker authority without teaching the shared
        flight model anything about an F-22.

        Maneuver Assist arms the system without moving the throttle. Pulling while armed
        latches the assist until the pilot chooses an exit. Orientation still comes from body
        rates and velocity still comes from forces; none of these values animates or snaps the
        aircraft onto a canned Cobra pose.
        */
        postStallAssist: {
          capable: true,
          entryMinKmh: 220,
          entryMaxKmh: 660,
          triggerPitch: 0.3,
          continuePitchThreshold: 0.55,
          holdPitchThreshold: 0.12,
          recoveryPitchThreshold: -0.16,
          recoveryCompleteAoADeg: 16,
          recoveryCompleteNoseOffDeg: 22,
          poweredExitMinActiveSeconds: 0.35,
          poweredExitMinTravelDeg: 45,
          poweredExitAoADeg: 14,
          poweredExitNoseOffDeg: 18,

          // These phase boundaries classify what the player is already doing; they never
          // clamp an angle or start a canned rotation. Signed integrated pitch travel keeps
          // the flip continuous across the 180-degree AoA wrap.
          cobraHoldMinTravelDeg: 58,
          cobraHoldMaxTravelDeg: 138,
          reversalMinNoseOffDeg: 148,
          reversalTravelWindowDeg: 34,
          flipEnterTravelDeg: 108,
          supportsPSMFlip: true,
          supportsPSMReversal: true,

          // Ordinary full aft stick remains behind the protected AoA fence. Maneuver Assist
          // is the only path to post-stall authority, so a low-speed dogfight pull cannot
          // become a Cobra by accident.
          manualEnvelopeShare: 0,
          // The consent rule applies to the signature positive-AoA manoeuvres. Preserve the
          // existing push-over authority so stall protection does not flatten nose-down
          // flight or make attitude and momentum appear coupled.
          negativeManualEnvelopeShare: 0.14,
          maxAoADeg: 180,
          // At extreme AoA the surfaces fade and pitch control transfers to artificial PSM
          // authority plus the nozzle contribution. Reheat therefore improves control as
          // well as exit acceleration, while a dry engine retains enough arcade authority
          // to hold an attitude safely.
          psmPitchAuthority: 1,
          artificialPitchAuthority: 0.9,
          thrustVectorAuthority: 1,
          psmRollAuthority: 0.55,
          psmYawAuthority: 0.5,
          engageResponse: 8,
          releaseResponse: 5,
          controlResponseBoost: 0.75,
          angularDampingBoost: 1.2,
          spinSuppression: 0.9,

          // While the player is holding the Cobra pose, the ordinary centred-stick recovery
          // and reverse-flow weathercocking stand back. Pitch-down switches both back on,
          // but recovery gets its own softer response and a cap on the combined pilot/FCS
          // demand so the nose sweeps back through the horizon instead of snapping there.
          holdWeathervaneFactor: 0,
          recoveryPitchRateDeg: 38,
          recoveryMaxPitchRateDeg: 100,
          recoveryResponseFactor: 0.72,

          // Temporary high-alpha PSM support. It is separate from aerodynamic lift and pays
          // out only for the opening 2.6 seconds before fading. Low speed and recovery reduce
          // it further, so a Cobra can hang long enough to choose an exit but cannot hover.
          floatFullAoADeg: 58,
          floatFullSeconds: 2.6,
          floatFadeSeconds: 2.2,
          floatFullSpeedKmh: 180,
          lowSpeedFloatFactor: 0.58,
          recoveryFloatFadeSeconds: 0.9,
          gravityScaleAtIdle: 0.9,
          gravityScaleAtFullPower: 0.64,
          gravityScaleAtAfterburner: 0.48,
          dragMultiplier: 1.12,
        },
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
