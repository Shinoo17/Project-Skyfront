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
    // Arcade envelope for the flight range. Speed is minSpeed + throttle * speedRange in
    // world units per second; rates are degrees per second at full deflection. Dogfight
    // balance between two airframes is tuned here.
    envelope: {
      idleThrottle: 0.42,
      minThrottle: 0.08,
      throttleRate: 0.34,
      minSpeed: 16,
      speedRange: 94,
      pitchRate: 48,
      rollRate: 66,
      yawRate: 42,
    },
  },

  // Reserved for the missile milestone: named nodes the stores hang from.
  hardpoints: [],
}

export default f22
