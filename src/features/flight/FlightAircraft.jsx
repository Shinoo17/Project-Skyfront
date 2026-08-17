import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, MathUtils, Mesh, Raycaster, Vector3 } from 'three'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'

import { makeHinges } from '../../three/hinge'
import { applyClosedRestPose } from '../../three/pose'
import {
  DEFAULT_CAMERA_ROLL_MODE,
  FLIGHT_FOV_RANGE,
  createChaseCameraState,
  resetChaseCamera,
  updateChaseCamera,
} from './chaseCamera'
import ExhaustPlumes from './ExhaustPlumes'
import VaporSheets from './VaporSheets'
import {
  createCondensationState,
  resetCondensationState,
  stepCondensation,
} from './condensation'
import {
  FLIGHT_FIXED_STEP,
  createFlightState,
  resetFlightState,
  stepFlight,
} from './flightModel'
import {
  createAfterburnerState,
  readMach,
  readTargetAirspeedKmh,
  readThrottlePower,
  resetAfterburnerState,
  stepAfterburner,
} from './performance'
import { applySurfaceTargets } from './surfaces'
import {
  centreMouseStick,
  clearAnalogFlightInput,
  readMouseStickAxes,
  resetFlightInput,
  setAnalogFlightInput,
  stepFlightInput,
} from './useFlightControls'

/*
The flying aircraft: one airframe, the 6-DOF-lite model that moves it, and the telemetry
both the HUD and the debug overlay read.

It drives a chase camera but does not choose one. `chaseCamera` is the camera the pilot's
view is flown through — the sortie passes the Canvas's own camera, so its behaviour is
unchanged, and the observer page passes a detached camera it renders into a corner while a
free-orbit camera owns the main view. Everything else in here is identical for both.
*/

const FORWARD = new Vector3(1, 0, 0)
const LOCAL_UP = new Vector3(0, 1, 0)
const DOWN = new Vector3(0, -1, 0)

// Height above the terrain is a downward raycast against the whole range mesh, which is
// far too expensive to run per frame. Sampling at 10 Hz and easing toward the sample
// costs a tenth as much and still leads the aircraft by more than a wingspan at full
// throttle. CRASH_CLEARANCE is the eased value, not the raw one, so a single stale
// sample over rising ground cannot end the sortie on its own.
const GROUND_SAMPLE_INTERVAL = 0.1
const CRASH_CLEARANCE = 9

// The pointer publishes through the ordinary analogue contract, under its own name, so the
// keyboard mix, the bot, and `strongestAxis` are untouched by its existence.
const MOUSE_STICK_SOURCE = 'mouse-stick'

export default function FlightAircraft({
  aircraft,
  scene,
  animations,
  controls,
  resetId,
  spawn,
  flightBounds,
  terrainRef,
  telemetry,
  chaseCamera,
  cameraMode = 'chase',
  cameraRoll = DEFAULT_CAMERA_ROLL_MODE,
  cameraDistance = 'normal',
  cameraFov = FLIGHT_FOV_RANGE.default,
  paused = false,
}) {
  const envelope = aircraft.flight.envelope
  const group = useRef()
  const previousResetId = useRef(resetId)
  const defaultCamera = useThree((state) => state.camera)
  const camera = chaseCamera ?? defaultCamera

  const model = useMemo(() => {
    const clone = cloneSkeleton(scene)
    applyClosedRestPose(clone, animations)

    aircraft.removedObjects.forEach((name) => {
      clone.getObjectByName(name)?.removeFromParent()
    })

    const bounds = new Box3().setFromObject(clone)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const scale = aircraft.flight.scale / Math.max(size.x, size.y, size.z)
    clone.scale.setScalar(scale)
    clone.position.copy(center).multiplyScalar(-scale)

    clone.traverse((child) => {
      if (!(child instanceof Mesh)) return
      if (aircraft.flight.isFlightDetail(child.name)) child.visible = false
      child.castShadow = false
      child.receiveShadow = false
      child.frustumCulled = true
    })

    return clone
  }, [aircraft, animations, scene])

  const surfaces = useMemo(
    () => makeHinges(model, aircraft.controlSurfaces),
    [aircraft, model],
  )

  const flight = useRef({
    // The 6-DOF-lite state — position, attitude, velocity, and body rates — lives in the
    // flight model. Everything else here is presentation: the attitude basis the HUD and
    // the camera share, ground samples, FPS accounting.
    model: createFlightState(),
    accumulator: 0,
    spawn: new Vector3(),
    attitude: {
      forward: new Vector3(),
      up: new Vector3(),
      levelUp: new Vector3(),
      cross: new Vector3(),
    },
    chase: createChaseCameraState(),
    rayOrigin: new Vector3(),
    raycaster: new Raycaster(),
    groundHeight: 0,
    groundSample: 0,
    groundSampledAt: -1,
    fps: 0,
    fpsFrames: 0,
    fpsSampledAt: 0,
    resetAt: -99,
    resetCause: '',
  })

  // Reheat lives beside the flight state rather than on the control ref: the keyboard says
  // only that the pilot is holding the burner, and everything about whether it is alight —
  // the reserve, the spool, the lockout — belongs to the flight model. The plume reads the
  // same object, so the flame can never show thrust the aircraft is not making.
  const reheat = useRef(createAfterburnerState())

  // How much vapour the wing is condensing, on the same terms: the sheet is not something
  // the renderer decides to show, it is a reading off the load the flight model is putting
  // through the wing this frame.
  const condensation = useRef(createCondensationState())

  const resetFlight = (cause, keepThrottle = true) => {
    const state = flight.current
    // A held stick survives nothing: respawning under the full back pressure that just flew
    // the aircraft into a hill would only fly it into the next one. The pointer keeps the
    // capture — only the deflection goes.
    centreMouseStick(controls.current)
    resetAfterburnerState(reheat.current)
    resetCondensationState(condensation.current)
    state.spawn.copy(spawn)
    // A reset starts in level-flight trim for the current dry-power intent. This is only an
    // initial condition: once flying, forces are the sole writer of velocity.
    if (!keepThrottle) {
      resetFlightInput(
        controls.current,
        readThrottlePower(envelope.idleThrottle, envelope),
      )
    }
    controls.current.throttle = envelope.minThrottle
      + (controls.current.commandedThrottle * (1 - envelope.minThrottle))
    const spawnSpeedKmh = readTargetAirspeedKmh(
      controls.current.throttle,
      state.spawn.y,
      0,
      envelope,
    )
    resetFlightState(
      state.model,
      state.spawn,
      spawnSpeedKmh,
      envelope,
      controls.current.throttle,
    )
    reheat.current.coreLevel = state.model.engineCoreLevel
    state.accumulator = 0
    state.groundHeight = 0
    state.groundSample = 0
    state.groundSampledAt = -1
    state.resetCause = cause
    if (group.current) {
      group.current.position.copy(state.model.position)
      group.current.quaternion.identity()
    }
    resetChaseCamera(state.chase, camera, state.model)
  }

  useEffect(() => {
    resetFlight('', false)
    // The reset function intentionally reads stable refs and Three objects only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawn, camera])

  useFrame((state, delta) => {
    if (!group.current) return
    // A paused surface withholds the render tick, but any React commit inside the Canvas —
    // the pause menu's own debug toggle, for one — still asks for a frame. The model refuses
    // to integrate on it, so nothing the menu does can nudge the aircraft.
    if (paused) return
    if (previousResetId.current !== resetId) {
      previousResetId.current = resetId
      resetFlight('manual')
      flight.current.resetAt = state.clock.elapsedTime
    }

    // Frame delta is capped so a stalled tab cannot feed the physics a huge step; the
    // model itself always integrates at FLIGHT_FIXED_STEP regardless of refresh rate.
    const step = Math.min(delta, 0.1)

    // The pointer's stick joins the mix here rather than being written by the surface that
    // moves it, so the shaping curve stays beside every other axis in the input layer and
    // one frame can never see half of a stick move. A middle-drag steers the camera instead,
    // and centres the stick while it does: the pointer is aiming the lens, so it has stopped
    // saying anything about where the pilot wants the stick.
    //
    // The correction is the previous frame's, because the camera has not run yet — it moves
    // after the physics for the reasons set out in the rig. A frame of lag on a quantity that
    // changes at the aircraft's roll rate is well under a degree, and the alternative is
    // reordering the loop so the camera composes a frame the aircraft has not flown.
    const stickAxes = readMouseStickAxes(
      controls.current.mouseStick,
      flight.current.chase.screenRoll,
    )
    if (stickAxes) {
      setAnalogFlightInput(controls.current, MOUSE_STICK_SOURCE, stickAxes, { direct: true })
    } else {
      clearAnalogFlightInput(controls.current, MOUSE_STICK_SOURCE)
    }

    const input = stepFlightInput(
      controls.current,
      step,
      envelope,
      flight.current.model.position.y,
      {
        speedKmh: flight.current.model.speedKmh,
      },
    )

    const current = flight.current
    const aircraftState = current.model
    const burnerRequested = input.afterburner
    const burner = stepAfterburner(reheat.current, {
      // Shift first drives the dry core through the MIL detent. Reheat is allowed to light
      // only once the core has enough airflow to support it.
      commanded: burnerRequested
        && aircraftState.engineCoreLevel >= envelope.afterburner.ignitionCorePower,
      step,
    }, envelope)

    const attitude = current.attitude

    const command = {
      pitch: input.pitch,
      roll: input.roll,
      yaw: input.yaw,
      throttle: input.throttle,
      commandedThrottle: input.commandedThrottle,
      airBrake: input.airBrake,
      // The four semantic intents, published exactly as the input layer resolved them. The
      // bot writes the same actions into the same layer, so player and AI hand the model
      // the same object and fly the same physics.
      accelerate: input.accelerate,
      decelerate: input.decelerate,
      highG: input.highG,
      psmArm: input.psmArm,
      extremeManeuverActive: input.extremeManeuverActive,
      afterburnerCommanded: burnerRequested,
      burnerLevel: burner.level,
    }

    current.accumulator += step
    while (current.accumulator >= FLIGHT_FIXED_STEP) {
      stepFlight(aircraftState, command, envelope, FLIGHT_FIXED_STEP)
      current.accumulator -= FLIGHT_FIXED_STEP
    }
    // The plume consumes this same spooled core reading, so the visible dry exhaust cannot
    // lag behind or race ahead of the force the aircraft is actually making.
    reheat.current.coreLevel = aircraftState.engineCoreLevel

    // An airframe that ships no condensation block simply makes no vapour, the same way one
    // with no engines list draws no plume.
    if (aircraft.flight.condensation) {
      stepCondensation(
        condensation.current,
        {
          gLoad: aircraftState.gLoad,
          aoaDeg: aircraftState.aoaDeg,
          speedKmh: aircraftState.speedKmh,
          step,
        },
        aircraft.flight.condensation,
      )
    }

    const speed = aircraftState.velocity.length()
    attitude.forward.copy(FORWARD).applyQuaternion(aircraftState.orientation).normalize()
    attitude.up.copy(LOCAL_UP).applyQuaternion(aircraftState.orientation).normalize()
    attitude.levelUp
      .copy(LOCAL_UP)
      .addScaledVector(attitude.forward, -LOCAL_UP.dot(attitude.forward))
    if (attitude.levelUp.lengthSq() < 0.0001) attitude.levelUp.copy(LOCAL_UP)
    attitude.levelUp.normalize()
    attitude.cross.crossVectors(attitude.levelUp, attitude.up)

    const now = state.clock.elapsedTime
    if (!current.fpsSampledAt) current.fpsSampledAt = now
    current.fpsFrames += 1
    const fpsElapsed = now - current.fpsSampledAt
    if (fpsElapsed >= 0.5) {
      current.fps = Math.round(current.fpsFrames / fpsElapsed)
      current.fpsFrames = 0
      current.fpsSampledAt = now
    }

    if (terrainRef.current && now - current.groundSampledAt > GROUND_SAMPLE_INTERVAL) {
      current.groundSampledAt = now
      current.rayOrigin.copy(aircraftState.position).setY(aircraftState.position.y + 4)
      current.raycaster.set(current.rayOrigin, DOWN)
      current.raycaster.near = 0
      current.raycaster.far = aircraftState.position.y + 60
      const hit = current.raycaster.intersectObject(terrainRef.current, true)[0]
      current.groundSample = hit ? hit.point.y : 0
    }
    current.groundHeight = MathUtils.lerp(
      current.groundHeight,
      current.groundSample,
      1 - Math.exp(-9 * step),
    )
    const groundClearance = aircraftState.position.y - current.groundHeight

    const resetCause =
      Math.abs(aircraftState.position.x) > flightBounds.x
        || Math.abs(aircraftState.position.z) > flightBounds.z
        ? 'range'
        : groundClearance < CRASH_CLEARANCE || aircraftState.position.y < 8
          ? 'terrain'
          : aircraftState.position.y > flightBounds.altitude
            ? 'ceiling'
            : ''
    if (resetCause) {
      resetFlight(resetCause)
      current.resetAt = now
    }

    group.current.position.copy(aircraftState.position)
    group.current.quaternion.copy(aircraftState.orientation)

    // The surfaces animate from the FCC's smoothed stick, so they move with the same
    // response the airframe answers to. The nozzles are still not driven out here: the
    // chase camera never frames them closely enough to pay for the extra hinge work.
    applySurfaceTargets(
      surfaces,
      aircraft.mixControlSurfaces({
        pitch: aircraftState.input.pitch,
        roll: aircraftState.input.roll,
        yaw: aircraftState.input.yaw,
        maneuverSurface: aircraftState.maneuverSurface,
        leadingEdgeDeflection: aircraftState.leadingEdgeDeflection,
        trailingEdgeDeflection: aircraftState.trailingEdgeDeflection,
        flaperonDeflection: aircraftState.flaperonDeflection,
      }),
      1 - Math.exp(-10 * step),
    )

    updateChaseCamera(current.chase, camera, {
      aircraftState,
      attitude,
      speed,
      burnerLevel: burner.level,
      step,
      mode: cameraMode,
      rollMode: cameraRoll,
      distance: cameraDistance,
      fov: cameraFov,
      cameraLook: controls.current.cameraLook,
      rearView: controls.current.pressed.has('rear-view'),
      // The same landscape the ground probe above samples, so the boom is constrained by
      // the terrain the aircraft is actually flying over rather than a second copy of it.
      terrain: terrainRef?.current ?? null,
    })

    // Published every frame straight into the caller's ref. Nothing here calls setState:
    // the HUD reads this object from its own animation frame and writes the DOM directly,
    // so a 60 Hz range does not re-render the React tree 60 times a second.
    const readout = telemetry.current
    // Stable references, assigned rather than copied: the HUD projects the ladder through
    // this camera and off this position, so it must see the same objects the scene renders.
    readout.camera = camera
    // What the rig composed, for the debug overlay. Same reference discipline as the camera
    // above: these are the rig's own vectors, so an arrow drawn from them cannot be showing
    // a different frame from the one on screen.
    readout.cameraState = current.chase.stateLabel
    readout.cameraForward = current.chase.followForward
    readout.cameraBodyUp = current.chase.bodyUp
    readout.cameraDesired = current.chase.desiredPosition
    readout.cameraRollDeg = MathUtils.radToDeg(current.chase.rollAngle)
    readout.cameraScreenRollDeg = MathUtils.radToDeg(current.chase.screenRoll)
    readout.cameraCollision = current.chase.collision.blocked
    // The stick gate the HUD draws. Published only while the pointer is actually flying,
    // because the cursor is hidden behind it: a gate left on the glass after the mouse
    // stopped commanding the aircraft would be a lie about what is being held.
    readout.mouseStick = stickAxes ? controls.current.mouseStick : null
    readout.position = aircraftState.position
    readout.forward = attitude.forward
    readout.velocity = aircraftState.velocity
    readout.liftForce = aircraftState.liftForce
    readout.dragForce = aircraftState.dragForce
    readout.thrustForce = aircraftState.thrustForce
    readout.heading = MathUtils.euclideanModulo(
      MathUtils.radToDeg(Math.atan2(attitude.forward.z, attitude.forward.x)),
      360,
    )
    readout.pitch = MathUtils.radToDeg(Math.asin(MathUtils.clamp(attitude.forward.y, -1, 1)))
    readout.roll = MathUtils.radToDeg(Math.atan2(
      attitude.cross.dot(attitude.forward),
      attitude.levelUp.dot(attitude.up),
    ))
    readout.altitude = Math.max(0, aircraftState.position.y)
    readout.groundClearance = Math.max(0, groundClearance)
    readout.ceiling = Math.max(0, flightBounds.altitude - aircraftState.position.y)
    readout.edge = Math.max(0, Math.min(
      flightBounds.x - Math.abs(aircraftState.position.x),
      flightBounds.z - Math.abs(aircraftState.position.z),
    ))
    readout.fps = current.fps
    readout.afterburner = burner.lit
    readout.afterburnerLevel = burner.level
    readout.afterburnerReserve = burner.reserve
    readout.afterburnerSeconds = burner.seconds
    readout.afterburnerCooldown = burner.cooldown
    // One word for the whole burner, so the HUD never has to re-derive the state machine.
    readout.afterburnerState = burner.lockedOut
      ? 'depleted'
      : burner.lit
        ? 'engaged'
        : burnerRequested
          ? 'spooling'
          : 'off'
    readout.mach = readMach(aircraftState.speedKmh, aircraftState.position.y, envelope)
    readout.speed = aircraftState.speedKmh
    readout.forwardSpeed = aircraftState.forwardSpeedKmh
    readout.backwardFlight = aircraftState.backwardFlight
    readout.verticalSpeed = aircraftState.velocity.y
    readout.acceleration = aircraftState.acceleration
    readout.commandedThrottle = aircraftState.commandedThrottle
    readout.engineThrottle = aircraftState.engineThrottle
    readout.thrust = aircraftState.thrust
    readout.parasiteDrag = aircraftState.parasiteDrag
    readout.inducedDrag = aircraftState.inducedDrag
    readout.airbrakeDrag = aircraftState.airbrakeDrag
    readout.totalDrag = aircraftState.totalDrag
    readout.airbrakeAmount = aircraftState.airbrakeAmount
    readout.afterburnerActive = aircraftState.afterburnerActive
    readout.currentG = aircraftState.gLoad
    readout.extremeManeuverActive = aircraftState.extremeManeuverActive
    readout.maneuverSurface = aircraftState.maneuverSurface
    readout.leadingEdgeDeflection = aircraftState.leadingEdgeDeflection
    readout.trailingEdgeDeflection = aircraftState.trailingEdgeDeflection
    readout.flaperonDeflection = aircraftState.flaperonDeflection
    readout.maneuverSurfaceEffectiveness = aircraftState.maneuverSurfaceEffectiveness
    readout.aoa = aircraftState.aoaDeg
    readout.sideslip = aircraftState.sideslipDeg
    readout.gLoad = aircraftState.gLoad
    readout.pitchRate = MathUtils.radToDeg(aircraftState.angularVelocity.z)
    readout.rollRate = MathUtils.radToDeg(aircraftState.angularVelocity.x)
    readout.yawRate = MathUtils.radToDeg(aircraftState.angularVelocity.y)
    readout.stallBlend = aircraftState.stallBlend
    readout.postStallBlend = aircraftState.postStallBlend
    readout.postStallActive = aircraftState.postStallActive
    readout.highGBlend = aircraftState.highGBlend
    readout.flightRegime = aircraftState.flightRegime
    readout.departureBlend = aircraftState.departureBlend
    readout.psmPhase = aircraftState.psmPhase
    readout.psmBlend = aircraftState.psmBlend
    readout.psmFloatBlend = aircraftState.psmFloatBlend
    readout.gravityScale = aircraftState.gravityScale
    readout.aeroAuthority = aircraftState.aeroAuthority
    readout.vectorAuthority = aircraftState.vectorAuthority
    readout.lift = aircraftState.liftForce.length()
    readout.drag = aircraftState.dragForce.length()
    readout.flightPath = aircraftState.flightPathDeg
    readout.noseOffPath = aircraftState.noseOffPathDeg
    readout.airBrake = aircraftState.airBrake
    readout.thrustVector = aircraftState.thrustVectorDeg
    readout.maneuver = aircraftState.maneuver
    readout.positionX = MathUtils.clamp(aircraftState.position.x / flightBounds.x, -1, 1)
    readout.positionZ = MathUtils.clamp(aircraftState.position.z / flightBounds.z, -1, 1)
    readout.resetCause = current.resetCause
    readout.sinceReset = now - current.resetAt
    readout.live = true
  })

  return (
    <group ref={group} position={spawn}>
      <primitive object={model} />
      <ExhaustPlumes
        aircraft={aircraft}
        model={model}
        controls={controls}
        reheat={reheat}
        continuous
      />
      <VaporSheets aircraft={aircraft} model={model} condensation={condensation} />
    </group>
  )
}
