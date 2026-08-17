import { Axis3d, Crosshair, Eye, EyeOff, Gauge, Move, RotateCcw } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { listAircraft } from '../../aircraft'
import { listMaps } from '../../maps'
import { EMPTY_TELEMETRY } from '../flight/telemetry'

/*
The developer's side of the observer page: what is being flown, what is being drawn, and a
numeric readout of the state both views are showing.

The readout is written straight to the DOM from its own animation frame, the same way the
HUD does it — the whole point of the page is watching values change at frame rate, and
routing that through React state would re-render the tree sixty times a second for text.
*/

const READOUTS = [
  { key: 'posX', label: 'POS X' },
  { key: 'posY', label: 'POS Y' },
  { key: 'posZ', label: 'POS Z' },
  { key: 'heading', label: 'HDG' },
  { key: 'pitch', label: 'PITCH' },
  { key: 'roll', label: 'ROLL' },
  { key: 'speed', label: 'SPD km/h' },
  { key: 'forwardSpeed', label: 'FWD km/h' },
  { key: 'mach', label: 'MACH' },
  { key: 'verticalSpeed', label: 'V/S' },
  { key: 'aoa', label: 'AOA' },
  { key: 'sideslip', label: 'SIDESLIP' },
  { key: 'gLoad', label: 'G' },
  { key: 'pitchRate', label: 'P RATE' },
  { key: 'rollRate', label: 'R RATE' },
  { key: 'yawRate', label: 'Y RATE' },
  // The stall block: what the wing is doing, what is still steering, and by how far the nose
  // and the flight path disagree.
  { key: 'lift', label: 'LIFT' },
  { key: 'drag', label: 'DRAG' },
  { key: 'stallBlend', label: 'STALL' },
  { key: 'postStallBlend', label: 'POST-ST' },
  { key: 'departureBlend', label: 'DEPART' },
  // The two intents, published side by side: how much of the conventional turn envelope is
  // open, and how much of the post-stall one. They answer to different keys.
  { key: 'highGBlend', label: 'HIGH-G' },
  { key: 'maneuverSurface', label: 'FCS SURF' },
  { key: 'maneuverSurfaceEffectiveness', label: 'SURF EFF' },
  { key: 'psmBlend', label: 'PSM' },
  { key: 'psmFloatBlend', label: 'FLOAT' },
  { key: 'aeroAuthority', label: 'AERO AUTH' },
  { key: 'vectorAuthority', label: 'TVC AUTH' },
  { key: 'flightPath', label: 'PATH γ' },
  { key: 'noseOffPath', label: 'NOSE–VEL' },
  { key: 'altitude', label: 'ALT' },
  { key: 'groundClearance', label: 'AGL' },
  { key: 'fps', label: 'FPS' },
]

function readValues(telemetry) {
  const value = telemetry.live ? telemetry : EMPTY_TELEMETRY
  const position = value.position
  return {
    posX: position ? position.x.toFixed(1) : '–',
    posY: position ? position.y.toFixed(1) : '–',
    posZ: position ? position.z.toFixed(1) : '–',
    heading: `${value.heading.toFixed(1)}°`,
    pitch: `${value.pitch.toFixed(1)}°`,
    roll: `${value.roll.toFixed(1)}°`,
    speed: value.speed.toFixed(0),
    forwardSpeed: value.forwardSpeed.toFixed(0),
    mach: value.mach.toFixed(2),
    verticalSpeed: value.verticalSpeed.toFixed(1),
    aoa: `${value.aoa.toFixed(1)}°`,
    sideslip: `${value.sideslip.toFixed(1)}°`,
    gLoad: value.gLoad.toFixed(2),
    pitchRate: `${value.pitchRate.toFixed(0)}°/s`,
    rollRate: `${value.rollRate.toFixed(0)}°/s`,
    yawRate: `${value.yawRate.toFixed(0)}°/s`,
    lift: value.lift.toFixed(1),
    drag: value.drag.toFixed(1),
    stallBlend: `${Math.round(value.stallBlend * 100)}%`,
    postStallBlend: `${Math.round(value.postStallBlend * 100)}%`,
    departureBlend: `${Math.round(value.departureBlend * 100)}%`,
    highGBlend: `${Math.round(value.highGBlend * 100)}%`,
    maneuverSurface: `${Math.round(value.maneuverSurface * 100)}%`,
    maneuverSurfaceEffectiveness:
      `${Math.round(value.maneuverSurfaceEffectiveness * 100)}%`,
    psmBlend: `${Math.round(value.psmBlend * 100)}%`,
    psmFloatBlend: `${Math.round(value.psmFloatBlend * 100)}%`,
    aeroAuthority: `${Math.round(value.aeroAuthority * 100)}%`,
    vectorAuthority: `${Math.round(value.vectorAuthority * 100)}%`,
    flightPath: `${value.flightPath.toFixed(1)}°`,
    noseOffPath: `${value.noseOffPath.toFixed(1)}°`,
    altitude: value.altitude.toFixed(0),
    groundClearance: value.groundClearance.toFixed(0),
    fps: String(value.fps || 0),
  }
}

export default function DevFlightPanel({
  telemetry,
  mapId,
  onMapChange,
  aircraftId,
  onAircraftChange,
  pip,
  onPipChange,
  pilotHud,
  onPilotHudChange,
  debug,
  onDebugChange,
  track,
  onTrackChange,
  onReset,
  onRecenter,
}) {
  const cells = useRef({})

  useEffect(() => {
    let request = 0
    const paint = () => {
      request = window.requestAnimationFrame(paint)
      const values = readValues(telemetry.current)
      READOUTS.forEach(({ key }) => {
        const node = cells.current[key]
        if (node && node.textContent !== values[key]) node.textContent = values[key]
      })
    }
    request = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(request)
  }, [telemetry])

  return (
    <aside className="dev-panel" aria-label="Test flight developer controls">
      <p className="dev-panel-title">TEST FLIGHT · OBSERVER</p>

      <div className="dev-panel-row">
        <label htmlFor="dev-map">Map</label>
        <select id="dev-map" value={mapId} onChange={(event) => onMapChange(event.target.value)}>
          {listMaps().map((map) => (
            <option key={map.id} value={map.id}>{map.name} · {map.region}</option>
          ))}
        </select>
      </div>

      <div className="dev-panel-row">
        <label htmlFor="dev-aircraft">Aircraft</label>
        <select
          id="dev-aircraft"
          value={aircraftId}
          onChange={(event) => onAircraftChange(event.target.value)}
        >
          {listAircraft().map((aircraft) => (
            <option key={aircraft.id} value={aircraft.id}>{aircraft.displayName}</option>
          ))}
        </select>
      </div>

      <div className="dev-panel-buttons">
        <button type="button" onClick={onReset}>
          <RotateCcw size={14} strokeWidth={1.9} /> Reset
        </button>
        <button type="button" onClick={onRecenter}>
          <Crosshair size={14} strokeWidth={1.9} /> Centre on aircraft
        </button>
        <button
          type="button"
          className={track ? 'is-on' : ''}
          aria-pressed={track}
          onClick={() => onTrackChange(!track)}
        >
          <Move size={14} strokeWidth={1.9} /> Track position <kbd>T</kbd>
        </button>
        <button
          type="button"
          className={pip ? 'is-on' : ''}
          aria-pressed={pip}
          onClick={() => onPipChange(!pip)}
        >
          {pip ? <Eye size={14} strokeWidth={1.9} /> : <EyeOff size={14} strokeWidth={1.9} />}
          Pilot view
        </button>
        <button
          type="button"
          className={pilotHud ? 'is-on' : ''}
          aria-pressed={pilotHud}
          disabled={!pip}
          onClick={() => onPilotHudChange(!pilotHud)}
        >
          <Gauge size={14} strokeWidth={1.9} /> Pilot HUD
        </button>
        <button
          type="button"
          className={debug ? 'is-on' : ''}
          aria-pressed={debug}
          onClick={() => onDebugChange(!debug)}
        >
          <Axis3d size={14} strokeWidth={1.9} /> Force vectors <kbd>I</kbd>
        </button>
      </div>

      <dl className="dev-panel-readout">
        {READOUTS.map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd ref={(node) => { cells.current[key] = node }}>–</dd>
          </div>
        ))}
      </dl>

      <p className="dev-panel-hint">
        Drag to orbit · scroll to zoom · right-drag to pan. Arrows, <kbd>A</kbd>/<kbd>D</kbd>,
        <kbd>Q</kbd>/<kbd>E</kbd>, <kbd>W</kbd>/<kbd>S</kbd> and <kbd>SHIFT</kbd> fly the
        aircraft. <kbd>SPACE</kbd> air brakes, or turns hard while the stick is deflected.
        Hold <kbd>ALT</kbd>, then pull up to arm arcade PSM.
      </p>

      <p className="dev-panel-hint">
        {track
          ? 'Tracking: the camera is carried by the aircraft’s translation only. The angle, distance and framing never change — fly at it and it backs away, fly off and it comes along.'
          : 'Static post: the camera does not move at all. The aircraft flies past it.'}
      </p>
    </aside>
  )
}
