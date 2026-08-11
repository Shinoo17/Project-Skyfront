/*
The HUD painter. Framework-free: it owns a 2D canvas and one `draw(state)` call, and the
React shell in `FlightHud.jsx` decides when to call it.

The split that matters is where a symbol lives. Anything attitude-shaped — the pitch
ladder, the horizon, the flight path marker — is projected from world space through the
same camera as the scene, so it stays registered with the terrain the pilot is looking at
instead of being faked from Euler angles. Anything scale-shaped — the tapes, the boxed
readouts, the status block — is screen-fixed, the way it is on a real combat HUD.

The entire glass uses one phosphor-green family. Brightness, opacity, shape, and motion
carry hierarchy and urgency; a wider translucent green pass keeps every symbol legible
without adding a black occlusion outline.
*/

import { MathUtils, Vector3 } from 'three'

import { MOUSE_STICK_GATE } from '../flight/flightInput'

const HUD_GREEN = 'rgba(98, 255, 132, 0.98)'
const HUD_GREEN_DIM = 'rgba(98, 255, 132, 0.66)'
const HUD_GREEN_CAUTION = 'rgba(98, 255, 132, 0.84)'
const HUD_GREEN_ALERT = 'rgba(122, 255, 151, 1)'
const HUD_BLOOM = 'rgba(48, 255, 104, 0.24)'
const DISPLAY = '"DIN Alternate", "Arial Narrow", "Aptos Narrow", sans-serif'

// Tape geometry in the tape's own units — km/h for speed, world units for altitude, and
// degrees for heading. `span` is how much of the scale is visible end to end.
const SPEED_TAPE = { minor: 100, major: 500, span: 1400 }
const ALTITUDE_TAPE = { minor: 25, major: 100, span: 620 }
const HEADING_HALF_SPAN = 26

// Rungs every 5 degrees, drawn out to ±60. Past that the ladder is behind the camera far
// more often than it is useful.
const LADDER_STEP = 5
const LADDER_LIMIT = 60
const LADDER_DISTANCE = 6000

// Half-width of a rung as a fraction of its distance, which is what fixes its angular size
// and so its size on screen. Too narrow and the two halves of one rung stop reading as a
// single bar and the ladder scatters into unrelated dashes.
const LADDER_HALF_SPAN = 0.15
const LADDER_GAP = 0.2

// Full deflection on the climb bar. The envelope tops out near 110 world units per second
// straight up, so hard over is a genuinely vertical climb rather than a guess.
const VERTICAL_SPEED_FULL_SCALE = 60
const CLEARANCE_FULL_SCALE = 600

// Room the heading readout needs above its own tape to stay clear of the command bar.
const COMMAND_BAR_CLEARANCE = 130

// The burner names its own state on the glass rather than making the pilot infer it from a
// draining bar.
const AFTERBURNER_LABELS = {
  spooling: 'A/B·SPL',
  engaged: 'A/B·ON',
  depleted: 'A/B·CLD',
}

// Reserve below this is worth a caution: there is not enough left for a useful burst.
const RESERVE_CAUTION = 0.25

const WORLD_UP = new Vector3(0, 1, 0)
const scratch = new Vector3()
const scratchAcross = new Vector3()
const scratchLevel = new Vector3()
const ladderDir = new Vector3()
const ladderCentre = new Vector3()
const projected = new Vector3()

function display(size, weight = 600) {
  return `${weight} ${size}px ${DISPLAY}`
}

function wrapHeading(value) {
  return MathUtils.euclideanModulo(value, 360)
}

function headingLabel(value) {
  const heading = wrapHeading(value)
  if (heading === 0) return 'N'
  if (heading === 90) return 'E'
  if (heading === 180) return 'S'
  if (heading === 270) return 'W'
  return String(Math.round(heading / 10) % 36).padStart(2, '0')
}

function pad(value, width) {
  return String(Math.max(0, Math.round(value))).padStart(width, '0')
}

function signed(value) {
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}`
}

export function createFlightHud(canvas) {
  const ctx = canvas.getContext('2d')
  let width = 0
  let height = 0
  let camera = null

  function resize(cssWidth, cssHeight, pixelRatio) {
    width = cssWidth
    height = cssHeight
    canvas.width = Math.max(1, Math.floor(cssWidth * pixelRatio))
    canvas.height = Math.max(1, Math.floor(cssHeight * pixelRatio))
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  }

  // Straight out of the camera the scene is already using, so nothing can drift out of
  // registration with the terrain. Points behind the lens return null rather than folding
  // back into view.
  function project(point) {
    projected.copy(point).applyMatrix4(camera.matrixWorldInverse)
    if (projected.z > -0.5) return null
    projected.applyMatrix4(camera.projectionMatrix)
    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (-projected.y * 0.5 + 0.5) * height,
    }
  }

  /*
  Every stroke goes down twice: one broad translucent phosphor pass for separation, then
  one crisp green pass. Two paths cost less than a canvas shadow blur and, unlike a
  `filter`, nothing is recomposited when the frame changes.
  */
  function luminous(paint, lineWidth, color) {
    ctx.lineWidth = lineWidth + 2.4
    ctx.strokeStyle = HUD_BLOOM
    paint()
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = color
    paint()
  }

  function line(x1, y1, x2, y2, lineWidth = 1.4, color = HUD_GREEN) {
    luminous(() => {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }, lineWidth, color)
  }

  function circle(cx, cy, radius, lineWidth = 1.4, color = HUD_GREEN) {
    luminous(() => {
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()
    }, lineWidth, color)
  }

  // The ladder has no black silhouette. A broad, low-opacity green pass adds chroma and
  // apparent weight over both sky and rock, followed by one crisp phosphor stroke.
  function pitchLine(x1, y1, x2, y2, lineWidth = 1.7, color = HUD_GREEN) {
    const paint = () => {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    ctx.lineWidth = lineWidth + 3
    ctx.strokeStyle = HUD_BLOOM
    paint()
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = color
    paint()
  }

  function box(x, y, w, h, lineWidth = 1.5, color = HUD_GREEN) {
    luminous(() => {
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.stroke()
    }, lineWidth, color)
  }

  function text(value, x, y, font, color = HUD_GREEN, align = 'left', baseline = 'middle') {
    ctx.font = font
    ctx.textAlign = align
    ctx.textBaseline = baseline
    ctx.lineWidth = 3.2
    ctx.lineJoin = 'round'
    ctx.strokeStyle = HUD_BLOOM
    ctx.strokeText(value, x, y)
    ctx.fillStyle = color
    ctx.fillText(value, x, y)
  }

  function pitchText(value, x, y, font, align = 'left', baseline = 'middle') {
    ctx.font = font
    ctx.textAlign = align
    ctx.textBaseline = baseline
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.strokeStyle = HUD_BLOOM
    ctx.strokeText(value, x, y)
    ctx.fillStyle = HUD_GREEN_DIM
    ctx.fillText(value, x, y)
  }

  // --- Sightline ------------------------------------------------------------
  /*
  Each rung is a real pair of world points 6 km ahead of the aircraft, so the ladder banks
  and slides with the airframe by construction. Dashed below the horizon, solid above,
  ticks hanging toward the horizon — the conventions a pilot reads without thinking.
  */
  function drawLadder(state, layout) {
    const halfSpan = LADDER_DISTANCE * LADDER_HALF_SPAN

    scratchLevel.copy(state.forward).setY(0)
    if (scratchLevel.lengthSq() < 1e-6) return
    scratchLevel.normalize()
    scratchAcross.crossVectors(scratchLevel, WORLD_UP).normalize()

    // The ladder runs in a window, not across the whole glass.
    ctx.save()
    ctx.beginPath()
    ctx.rect(
      layout.cx - layout.half * 0.62,
      layout.ladderTop,
      layout.half * 1.24,
      layout.ladderBottom - layout.ladderTop,
    )
    ctx.clip()

    for (let angle = -LADDER_LIMIT; angle <= LADDER_LIMIT; angle += LADDER_STEP) {
      const isHorizon = angle === 0
      const radians = MathUtils.degToRad(angle)

      ladderDir
        .copy(scratchLevel)
        .multiplyScalar(Math.cos(radians))
        .addScaledVector(WORLD_UP, Math.sin(radians))
      ladderCentre.copy(state.position).addScaledVector(ladderDir, LADDER_DISTANCE)

      const span = isHorizon ? halfSpan * 1.7 : halfSpan
      const left = project(scratch.copy(ladderCentre).addScaledVector(scratchAcross, -span))
      const right = project(scratch.copy(ladderCentre).addScaledVector(scratchAcross, span))
      if (!left || !right) continue

      const dx = right.x - left.x
      const dy = right.y - left.y
      const length = Math.hypot(dx, dy)
      if (length < 12 || length > layout.half * 12) continue

      const ux = dx / length
      const uy = dy / length
      const gap = isHorizon ? length * 0.05 : length * LADDER_GAP
      const tick = isHorizon ? 0 : (angle > 0 ? 1 : -1) * length * 0.06
      const midX = (left.x + right.x) / 2
      const midY = (left.y + right.y) / 2
      const color = isHorizon ? HUD_GREEN : HUD_GREEN_DIM
      const weight = isHorizon ? 2.2 : 1.7

      ctx.setLineDash(angle < 0 ? [7, 6] : [])
      for (const side of [-1, 1]) {
        const innerX = midX + ux * gap * side
        const innerY = midY + uy * gap * side
        const outerX = midX + ux * (length / 2) * side
        const outerY = midY + uy * (length / 2) * side
        pitchLine(innerX, innerY, outerX, outerY, weight, color)
        if (tick) {
          pitchLine(outerX, outerY, outerX - uy * tick, outerY + ux * tick, weight, color)
        }
      }
      ctx.setLineDash([])

      // Both ends carry the number, rotated onto the rung: one label reads as a stray digit
      // when the ladder is steeply banked, two read as the rung's own scale.
      if (!isHorizon && angle % 10 === 0) {
        const angleOnScreen = Math.atan2(dy, dx)
        for (const side of [-1, 1]) {
          ctx.save()
          ctx.translate(
            midX + ux * side * (length / 2 + 14),
            midY + uy * side * (length / 2 + 14),
          )
          ctx.rotate(angleOnScreen)
          pitchText(String(Math.abs(angle)), 0, 0, display(12), side === 1 ? 'left' : 'right')
          ctx.restore()
        }
      }
    }

    ctx.restore()
  }

  /*
  Two symbols now, because the flight model earned them: the boresight cross sits on the
  nose, and the flight path marker rides the real velocity vector. In level flight they
  overlap to within a couple of degrees of trim AoA; pull into a Cobra and the cross
  climbs the glass while the marker stays on where the jet is actually going — the whole
  manoeuvre, told by two symbols separating.

  Both are projected from points far out along their vectors rather than pinned to the
  canvas, because the chase camera drifts behind the jet: pinned, they come adrift from
  the sightline exactly when the aircraft is manoeuvring.
  */
  function drawBoresight(state, layout) {
    const point = project(scratch.copy(state.forward).multiplyScalar(4000).add(state.position))
    if (!point) return

    const { x: cx, y: cy } = point
    const r = Math.max(layout.half * 0.02, 7)
    line(cx - r, cy, cx + r, cy, 1.5, HUD_GREEN_DIM)
    line(cx, cy - r, cx, cy + r, 1.5, HUD_GREEN_DIM)
  }

  /*
  The stick gate: how much stick the pointer is actually giving the aircraft.

  Once the sky takes the pointer the cursor is gone, and this becomes the only place the
  stick can be read at all: the deflection, the limit it saturates at, and the dead zone
  around neutral that reads as zero. Both rings are circles, because the gate is a disc;
  drawing a box here would promise corners the control does not have.

  This is why it stays on the glass rather than being a debug affordance. A pilot who has
  lost track of where the stick is has one place to look, and "put it back in the middle" is
  a thing they can then act on.

  Unlike the ladder and the two crosses it is not projected. A stick has no place in the
  world, and pinning it to one would be a lie about what it is.
  */
  function drawStickGate(state, layout) {
    const stick = state.mouseStick
    if (!stick) return

    const reach = Math.max(layout.half * 0.13, 44)
    const cx = layout.cx
    const cy = layout.cy + layout.tapeHeight / 2 + reach + 26
    // Off the bottom of a short frame the gate would sit under the bezel; there is nothing
    // useful to show in that case, and a symbol behind a control well is worse than none.
    if (cy + reach > height - 8) return

    // Clamped to the disc rather than per axis, exactly as the input layer does it, so the
    // marker sits in the direction the pilot is pointing even out past the limit.
    const magnitude = Math.max(Math.hypot(stick.x, stick.y), 1e-6)
    const scale = Math.min(magnitude, 1) / magnitude
    const x = cx + (stick.x * scale * reach)
    const y = cy - (stick.y * scale * reach)

    circle(cx, cy, reach, 1.2, HUD_GREEN_DIM)
    // Neutral is a place on the glass, and with a positional stick it is a place the pointer
    // can be put back into rather than a point it has to be balanced on. Drawn at its real
    // size so "why is nothing happening" is answerable by looking.
    circle(cx, cy, reach * MOUSE_STICK_GATE.deadZone, 1.2, HUD_GREEN_DIM)
    line(cx - 5, cy, cx + 5, cy, 1.2, HUD_GREEN_DIM)
    line(cx, cy - 5, cx, cy + 5, 1.2, HUD_GREEN_DIM)

    // The stick itself, tied back to neutral so the deflection reads as a distance rather
    // than as a dot the eye has to measure.
    line(cx, cy, x, y, 1.3, HUD_GREEN_DIM)
    luminous(() => {
      ctx.beginPath()
      ctx.arc(x, y, 5.5, 0, Math.PI * 2)
      ctx.stroke()
    }, 1.7, HUD_GREEN)
  }

  function drawFlightPathMarker(state, layout) {
    const along = state.velocity && state.velocity.lengthSq() > 1e-4
      ? scratch.copy(state.velocity).normalize()
      : scratch.copy(state.forward)
    const point = project(along.multiplyScalar(4000).add(state.position))
    if (!point) return

    const { x: cx, y: cy } = point
    const r = Math.max(layout.half * 0.032, 11)

    luminous(() => {
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }, 1.6, HUD_GREEN)

    line(cx - r, cy, cx - r * 2.3, cy, 1.6)
    line(cx + r, cy, cx + r * 2.3, cy, 1.6)
    line(cx, cy - r, cx, cy - r * 1.9, 1.6)

    luminous(() => {
      ctx.beginPath()
      ctx.rect(cx - 1.5, cy - 1.5, 3, 3)
      ctx.stroke()
    }, 1.2, HUD_GREEN)
  }

  // --- Tapes ----------------------------------------------------------------
  function drawTape(layout, options) {
    const { x, value, side, tape, label, subreadout, live, digits } = options
    const top = layout.cy - layout.tapeHeight / 2
    const bottom = layout.cy + layout.tapeHeight / 2
    const dir = side === 'left' ? -1 : 1
    const pixelsPerUnit = layout.tapeHeight / tape.span

    line(x, top, x, bottom, 1.4)

    if (live) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(Math.min(x, x + dir * 64), top, 64, layout.tapeHeight)
      ctx.clip()

      const range = tape.span / 2
      const first = Math.ceil((value - range) / tape.minor) * tape.minor
      for (let v = first; v <= value + range; v += tape.minor) {
        if (v < 0) continue
        const y = layout.cy - (v - value) * pixelsPerUnit
        // The current-value box owns this slot on the scale.
        if (Math.abs(y - layout.cy) < 15) continue
        const isMajor = Math.abs(v % tape.major) < tape.minor * 0.01
        const length = isMajor ? 13 : 7
        line(x, y, x + dir * length, y, isMajor ? 1.4 : 1.2,
          isMajor ? HUD_GREEN : HUD_GREEN_DIM)
        // Ticks run under the value box; their labels do not, or the box reads as two
        // numbers stacked on each other.
        if (isMajor && Math.abs(y - layout.cy) > 26) {
          text(String(Math.round(v)), x + dir * (length + 6), y, display(12), HUD_GREEN_DIM,
            side === 'left' ? 'right' : 'left')
        }
      }
      ctx.restore()
    }

    // Current value, in a box that points back at the scale it came from.
    const boxW = 66
    const boxH = 24
    const boxX = side === 'left' ? x - boxW - 10 : x + 10
    box(boxX, layout.cy - boxH / 2, boxW, boxH, 1.5)

    const tipX = side === 'left' ? boxX + boxW : boxX
    luminous(() => {
      ctx.beginPath()
      ctx.moveTo(tipX, layout.cy - 6)
      ctx.lineTo(tipX + dir * 9, layout.cy)
      ctx.lineTo(tipX, layout.cy + 6)
      ctx.stroke()
    }, 1.5, HUD_GREEN)

    text(
      live ? pad(value, digits) : '–'.repeat(digits),
      boxX + boxW / 2, layout.cy + 1, display(16, 700), HUD_GREEN, 'center',
    )
    text(
      label,
      side === 'left' ? boxX : boxX + boxW,
      layout.cy - boxH / 2 - 11,
      display(10),
      HUD_GREEN_DIM,
      side === 'left' ? 'left' : 'right',
    )
    if (subreadout) {
      text(
        subreadout,
        boxX + boxW / 2,
        layout.cy + boxH / 2 + 10,
        display(11, 700),
        HUD_GREEN_DIM,
        'center',
        'top',
      )
    }
  }

  function drawHeadingTape(state, layout) {
    const y = layout.cy - layout.rise
    const halfW = layout.half * 0.5
    const pixelsPerDegree = halfW / HEADING_HALF_SPAN
    const heading = wrapHeading(state.heading)

    line(layout.cx - halfW, y, layout.cx + halfW, y, 1.4)

    if (state.live) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(layout.cx - halfW, y - 24, halfW * 2, 46)
      ctx.clip()
      const first = Math.ceil((heading - HEADING_HALF_SPAN) / 5) * 5
      for (let deg = first; deg <= heading + HEADING_HALF_SPAN; deg += 5) {
        const x = layout.cx + (deg - heading) * pixelsPerDegree
        const isMajor = MathUtils.euclideanModulo(deg, 10) === 0
        line(x, y, x, y - (isMajor ? 10 : 5), isMajor ? 1.4 : 1.2,
          isMajor ? HUD_GREEN : HUD_GREEN_DIM)
        if (isMajor) {
          text(headingLabel(deg), x, y + 6, display(11), HUD_GREEN_DIM, 'center', 'top')
        }
      }
      ctx.restore()
    }

    luminous(() => {
      ctx.beginPath()
      ctx.moveTo(layout.cx - 7, y - 15)
      ctx.lineTo(layout.cx, y - 5)
      ctx.lineTo(layout.cx + 7, y - 15)
      ctx.stroke()
    }, 1.6, HUD_GREEN)

    text(
      state.live ? `${pad(heading, 3)}°` : '–––',
      layout.cx, y - 21, display(15, 700), HUD_GREEN, 'center', 'bottom',
    )
  }

  // --- Status block ---------------------------------------------------------
  function bar(x, y, w, h, fill, color) {
    box(x, y - h / 2, w, h, 1.2, HUD_GREEN_DIM)
    ctx.fillStyle = color
    ctx.fillRect(x + 1.5, y - h / 2 + 1.5, Math.max(0, (w - 3) * fill), h - 3)
  }

  function drawStatusBlock(state, layout) {
    // How far the readouts may spread is set by the bezel, not by the glass. On a tall frame
    // the decks are clamped to the corners and two columns fit between them. On a crowded
    // one the decks reach into this band from both sides, so everything stacks into the one
    // strip left between them. On a narrow one the decks have dropped below the sightline
    // entirely and the columns run out to the edges.
    const left = layout.cx - layout.half * (layout.tight ? 0.45 : 0.72)
    const right = layout.tight ? left : layout.cx + layout.half * (layout.compact ? 0.98 : 0.55)
    const align = layout.tight ? 'left' : 'right'
    // How far below its first row the block still has something to draw: two stacked rows
    // when the decks have reached in from both sides, three when they have dropped away
    // entirely and the outboard gauges have collapsed into digits, and nothing beyond the
    // two bars when the decks are clamped to the corners.
    const depth = layout.tight ? 86 : layout.compact ? 104 : 42
    // On a short frame the tapes reach far enough down that the last row would land past
    // the bezel. The block sits on the floor rather than through it.
    const first = Math.min(
      layout.cy + layout.tapeHeight / 2 + 46,
      height - depth - 14,
    )
    const second = first + 22
    const barX = left + (layout.compact ? 32 : 40)
    const barW = layout.compact ? 72 : 116

    text(state.afterburner ? 'THR·AB' : 'THR', left, first, display(12), HUD_GREEN_DIM)
    bar(barX, first, barW, 12, state.throttle, HUD_GREEN)
    text(`${String(Math.round(state.throttle * 100)).padStart(3, ' ')}%`,
      barX + barW + 10, first, display(12, 700), HUD_GREEN)

    // Ground clearance earns a bar as well as digits: it is the number that ends the
    // sortie, and the colour says how much of it is left without anything to read.
    const clearance = state.live
      ? Math.min(1, state.groundClearance / CLEARANCE_FULL_SCALE)
      : 0
    const clearanceColor = state.groundClearance < 120 ? HUD_GREEN_ALERT
      : state.groundClearance < 260 ? HUD_GREEN_CAUTION : HUD_GREEN
    text('GND', left, second, display(12), HUD_GREEN_DIM)
    bar(barX, second, barW, 10, clearance, state.live ? clearanceColor : HUD_GREEN_DIM)
    text(state.live ? pad(state.groundClearance, 3) : '–––',
      barX + barW + 10, second, display(12, 700),
      state.live ? clearanceColor : HUD_GREEN_DIM)

    const pitch = state.live ? signed(state.pitch) : '––'
    const bank = state.live ? signed(state.roll) : '––'
    const verticalSpeed = state.live ? signed(state.verticalSpeed) : '––'
    // AoA and load factor join the attitude row: they are the two numbers a post-stall
    // manoeuvre is flown by. AoA brightens once past the stall so the state is legible at
    // a glance.
    const aoa = state.live ? signed(state.aoa) : '––'
    const g = state.live ? state.gLoad.toFixed(1) : '–.–'
    const aoaColor = state.live && Math.abs(state.aoa) > 26 ? HUD_GREEN_CAUTION : HUD_GREEN_DIM
    // Stacked under the bars when the frame is crowded, beside them when it is not.
    const attitudeRow = layout.tight ? second + 21 : first
    text(`PITCH ${pitch}°   BANK ${bank}°`, right, attitudeRow, display(12), HUD_GREEN_DIM, align)
    // Its own slot in every layout: under the flap row when the block is stacked, under
    // the attitude row when the columns are side by side.
    const aoaRow = layout.tight ? attitudeRow + 40 : layout.compact ? second + 80 : second
    text(`α ${aoa}°   ${g}G${state.postStallActive ? '   STALL' : ''}${state.airBrake ? '   BRAKE' : ''}`,
      right, aoaRow, display(12), aoaColor, align)

    // Flap and range-edge state belong to the tacmap deck, which is opaque, larger, and the
    // only copy a screen reader can reach. The glass picks them up exactly on the frames
    // where the stylesheet has dropped that deck, so the two never appear at once and
    // neither ever disappears.
    if (layout.tight) {
      const edge = state.live ? pad(state.edge, 4) : '––––'
      text(`${state.flaps ? 'FLAPS DOWN' : 'FLAPS UP'}   EDGE ${edge}`,
        right, attitudeRow + 20, display(12),
        state.flaps ? HUD_GREEN_CAUTION : HUD_GREEN_DIM, align)
    } else if (layout.compact) {
      text(state.flaps ? 'FLAPS DOWN' : 'FLAPS UP',
        right, second, display(12, 700),
        state.flaps ? HUD_GREEN_CAUTION : HUD_GREEN_DIM, 'right')
      text(state.live ? `EDGE ${pad(state.edge, 4)}` : 'EDGE ––––',
        right, second + 20, display(12),
        state.live && state.edge < 620 ? HUD_GREEN_CAUTION : HUD_GREEN_DIM, 'right')
    }

    // Climb rate, hung off the altitude tape: the bar the pilot flies level by, with the
    // digits under it for the rate a bar cannot resolve. Narrow frames have no room beside
    // the tape for it, so there the rate joins the column as digits alone.
    /*
    Reheat is the one control the pilot spends rather than sets, so it reads as a budget:
    a column that drains, and a clock for what the column is worth. The clock is the number
    that matters — a reserve at 40% means nothing until it says three seconds — and after a
    burnout it turns around and counts the cooldown down instead, so the same digits always
    answer "how long until I can burn again".

    It hangs outboard of the speed tape, mirroring the climb bar on the altitude side.
    Reheat is energy the aircraft is buying, and it belongs beside the scale that shows what
    the money bought.
    */
    const reserve = state.live ? state.afterburnerReserve : 0
    const cooling = state.afterburnerState === 'depleted'
    const burnerColor = !state.live ? HUD_GREEN_DIM
      : cooling ? HUD_GREEN_ALERT
        : state.afterburnerState === 'engaged' ? HUD_GREEN_ALERT
          : reserve < RESERVE_CAUTION ? HUD_GREEN_CAUTION : HUD_GREEN
    const burnerLabel = AFTERBURNER_LABELS[state.afterburnerState] ?? 'A/B'
    const burnerClock = state.live
      ? `${(cooling ? state.afterburnerCooldown : state.afterburnerSeconds).toFixed(1)}s`
      : '––.–s'

    // Narrow frames have no room outboard of the tapes, so both gauges fall back to digits
    // in the status column.
    if (layout.compact) {
      text(`V/S ${verticalSpeed}`, right, second + 40, display(12), HUD_GREEN_DIM, 'right')
      text(`${burnerLabel} ${burnerClock}`, right, second + 60, display(12),
        burnerColor, 'right')
      return
    }

    const gaugeTop = layout.cy - layout.tapeHeight * 0.28
    const gaugeBottom = layout.cy + layout.tapeHeight * 0.28
    const gaugeSpan = gaugeBottom - gaugeTop

    const climb = state.live
      ? MathUtils.clamp(state.verticalSpeed / VERTICAL_SPEED_FULL_SCALE, -1, 1)
      : 0
    const climbX = layout.cx + layout.half * layout.tapeOffset + 92
    const climbMid = (gaugeTop + gaugeBottom) / 2
    line(climbX, gaugeTop, climbX, gaugeBottom, 1.2, HUD_GREEN_DIM)
    line(climbX - 5, climbMid, climbX + 5, climbMid, 1.2, HUD_GREEN_DIM)
    line(climbX - 4, climbMid, climbX - 4, climbMid - (climb * gaugeSpan) / 2, 3, HUD_GREEN)
    text('V/S', climbX, gaugeTop - 12, display(10), HUD_GREEN_DIM, 'center')
    text(verticalSpeed, climbX, gaugeBottom + 14, display(12, 700), HUD_GREEN, 'center')

    // Fuel reads bottom-up, so the reserve empties toward the floor of its own scale. The
    // tick is the point below which what is left is no longer worth a burst.
    const reheatX = layout.cx - layout.half * layout.tapeOffset - 92
    const cautionY = gaugeTop + (gaugeSpan * (1 - RESERVE_CAUTION))
    line(reheatX, gaugeTop, reheatX, gaugeBottom, 1.2, HUD_GREEN_DIM)
    line(reheatX - 5, cautionY, reheatX + 5, cautionY, 1.2, HUD_GREEN_DIM)
    line(reheatX + 4, gaugeBottom, reheatX + 4, gaugeBottom - (reserve * gaugeSpan), 3,
      burnerColor)
    text(burnerLabel, reheatX, gaugeTop - 12, display(10), HUD_GREEN_DIM, 'center')
    text(burnerClock, reheatX, gaugeBottom + 14, display(12, 700), burnerColor, 'center')
  }

  function draw(state) {
    ctx.clearRect(0, 0, width, height)
    if (!state) return
    camera = state.camera

    const half = Math.min(width * 0.42, height * 0.72)
    const layout = {
      cx: width / 2,
      cy: height / 2,
      half,
      tapeHeight: Math.min(height * 0.42, half * 0.95),
      // On a phone the horizontal reach collapses long before the vertical one does, so the
      // heading tape takes its distance from the sightline off the taller of the two or it
      // lands on the flight path marker in portrait. The ceiling is the command bar: the
      // heading readout sits above its own tape, and unclamped it climbs into the bar.
      rise: Math.min(Math.max(half * 0.58, height * 0.3), height / 2 - COMMAND_BAR_CLEARANCE),
      // Narrow enough that the two status columns would meet in the middle. Same threshold
      // as the phone media query, which drops the bezel decks below the sightline.
      compact: width <= 760,
      // Crowded: the decks still flank the sightline but reach into the status band, either
      // because the window is short or because it is narrow enough that they meet in the
      // middle. Same thresholds as the media query that hides the tacmap on those frames.
      tight: width > 760 && (height <= 720 || width <= 1100),
    }
    // How far off the sightline the tapes stand, as a fraction of the half-frame. On a
    // phone the wider spacing drives the value box hard against the bezel, so the tapes
    // come inboard and give the reading its margin back.
    layout.tapeOffset = layout.compact ? 0.62 : 0.72
    // The ladder window is asymmetric because its neighbours are: it stops just under the
    // heading tape and just above the status block, so rungs never cross a readout.
    layout.ladderTop = layout.cy - (layout.rise - 34)
    layout.ladderBottom = layout.cy + layout.tapeHeight / 2 + 22

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])

    // The scales and readouts stand on their own; only the projected symbology waits for a
    // camera, so the standby sightline is dashes on an empty ladder rather than a blank.
    if (state.live && camera && state.position && state.forward) {
      drawLadder(state, layout)
      drawBoresight(state, layout)
      drawFlightPathMarker(state, layout)
    }
    // The gate is a control reading, not a projection, so it needs no camera — but it is
    // published only while the pointer is flying, which is the same condition as `live`.
    drawStickGate(state, layout)

    drawTape(layout, {
      x: layout.cx - half * layout.tapeOffset,
      value: state.speed,
      side: 'left',
      tape: SPEED_TAPE,
      label: 'SPEED · KM/H',
      subreadout: state.live ? `MACH ${state.mach.toFixed(2)}` : 'MACH –.–',
      digits: 4,
      live: state.live,
    })

    drawTape(layout, {
      x: layout.cx + half * layout.tapeOffset,
      value: state.altitude,
      side: 'right',
      tape: ALTITUDE_TAPE,
      label: 'ALT',
      digits: 4,
      live: state.live,
    })

    drawHeadingTape(state, layout)
    drawStatusBlock(state, layout)
  }

  return { resize, draw }
}
