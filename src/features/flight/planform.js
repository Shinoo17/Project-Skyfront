import {
  Box3,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Matrix4,
  RGBAFormat,
  Vector3,
} from 'three'

/*
The wing, seen from above, measured off the airframe itself.

A vapour sheet is not a rectangle floating over the wing — its outline *is* the wing's
outline, and the airshow photographs are unmistakable about it: the cloud runs out to the
tips along the leading-edge sweep, crosses the fuselage between the wing roots, and only
loses the shape once it is aft of the trailing edge and shredding. So the sheet cannot be
drawn from a bounding box. It needs the planform.

This bakes one, once, by rasterising the airframe's own triangles straight down onto a
grid: which cells the aircraft covers when you look at it from directly overhead, and how
high its upper surface stands in each of them. Three fields come out, packed into one
texture the shader reads:

  R  coverage, blurred — the planform outline, feathered so the cloud fades in a little
     inside the edge rather than being clipped off at it
  G  the height of the upper surface, so the sheet drapes over the spine and the wings
     instead of arching over them by a formula that knows nothing about either
  B  the same coverage smeared aft with distance — the wake, which is what lets the cloud
     stream off the trailing edge still carrying the shape of what shed it

Everything is done in the airframe's own frame, by walking local matrices up to the model
root, so the measurement is the same whether the aircraft is parked, inverted, or halfway
through a turn — and it never depends on the model having been added to a scene.
*/

// Chordwise cells across the footprint. Fine enough that the leading-edge sweep reads as a
// straight edge rather than a staircase, coarse enough that the bake is a few milliseconds
// on one mount and the texture stays under a couple of hundred kilobytes.
const DEFAULT_RESOLUTION = 192

// Cells left unmeasured — everything aft of the trailing edge, everything outboard of the
// tips — take their height from their neighbours. This is the furthest that fill will
// reach before it gives up, in cells; the aft extension is the widest gap it has to cross.
const MAX_FILL_PASSES = 96

const vertexA = new Vector3()
const vertexB = new Vector3()
const vertexC = new Vector3()

// A mesh's transform relative to the airframe group. Walking the local matrices up to the
// model root rather than reading matrixWorld keeps this independent of where the aircraft
// is sitting, and of whether it has been added to the scene yet.
function matrixInAirframeSpace(mesh, model, target) {
  target.identity()
  for (let node = mesh; node; node = node.parent) {
    node.updateMatrix()
    target.premultiply(node.matrix)
    if (node === model) break
  }
  return target
}

function boxInAirframeSpace(mesh, model, target, relative) {
  matrixInAirframeSpace(mesh, model, relative)
  mesh.geometry.computeBoundingBox()
  return target.copy(mesh.geometry.boundingBox).applyMatrix4(relative)
}

function unionOf(names, model, box) {
  const meshBox = new Box3()
  const relative = new Matrix4()
  box.makeEmpty()
  names.forEach((name) => {
    const mesh = model.getObjectByName(name)
    if (!mesh?.geometry) return
    box.union(boxInAirframeSpace(mesh, model, meshBox, relative))
  })
  return box
}

/*
The patch of sky the sheet occupies, in the airframe's frame.

The wing meshes give the leading edge, the trailing edge and the span; the footprint is
that, carried further aft because the cloud does not stop where the structure does, and a
little wider because it does not stop at the tip rib either. X runs aft to fore, Z across.
*/
export function measureFootprint(model, tuning) {
  const box = unionOf(tuning.wingMeshes, model, new Box3())
  if (box.isEmpty()) return null

  const leading = box.max.x
  const chord = Math.max(leading - box.min.x, 1e-3)
  const trailing = box.min.x - (chord * tuning.chordExtension)
  const margin = (box.max.z - box.min.z) * tuning.spanMargin * 0.5

  return {
    chord,
    leading,
    trailing,
    length: leading - trailing,
    minZ: box.min.z - margin,
    maxZ: box.max.z + margin,
    width: (box.max.z - box.min.z) + (margin * 2),
  }
}

// Every triangle of one mesh, dropped straight down onto the grid. `solid` records that the
// aircraft is there at all; `height` keeps the topmost surface, which is the one the cloud
// sits on — a cell that sees both the upper skin and the bay roof under it must take the skin.
function rasterize(mesh, matrix, grid) {
  const { nx, nz, solid, height, originX, originZ, cellX, cellZ } = grid
  const position = mesh.geometry.attributes.position
  if (!position) return
  const index = mesh.geometry.index
  const count = index ? index.count : position.count

  for (let i = 0; i < count; i += 3) {
    const i0 = index ? index.getX(i) : i
    const i1 = index ? index.getX(i + 1) : i + 1
    const i2 = index ? index.getX(i + 2) : i + 2
    vertexA.fromBufferAttribute(position, i0).applyMatrix4(matrix)
    vertexB.fromBufferAttribute(position, i1).applyMatrix4(matrix)
    vertexC.fromBufferAttribute(position, i2).applyMatrix4(matrix)

    // Cell-index space: an integer coordinate is the centre of that cell, which is also
    // where the texture samples it.
    const ax = ((vertexA.x - originX) / cellX) - 0.5
    const az = ((vertexA.z - originZ) / cellZ) - 0.5
    const bx = ((vertexB.x - originX) / cellX) - 0.5
    const bz = ((vertexB.z - originZ) / cellZ) - 0.5
    const cx = ((vertexC.x - originX) / cellX) - 0.5
    const cz = ((vertexC.z - originZ) / cellZ) - 0.5

    const minI = Math.max(0, Math.ceil(Math.min(ax, bx, cx)))
    const maxI = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx)))
    const minJ = Math.max(0, Math.ceil(Math.min(az, bz, cz)))
    const maxJ = Math.min(nz - 1, Math.floor(Math.max(az, bz, cz)))
    if (minI > maxI || minJ > maxJ) {
      // A triangle smaller than a cell, or one seen edge-on, still says the aircraft is
      // there. Stamping its centroid keeps the skin from developing pinholes the blur
      // would then have to close.
      const ci = Math.round((ax + bx + cx) / 3)
      const cj = Math.round((az + bz + cz) / 3)
      if (ci < 0 || ci >= nx || cj < 0 || cj >= nz) continue
      const cell = ci + (cj * nx)
      const y = (vertexA.y + vertexB.y + vertexC.y) / 3
      solid[cell] = 1
      if (y > height[cell]) height[cell] = y
      continue
    }

    const denominator = ((bz - cz) * (ax - cx)) + ((cx - bx) * (az - cz))
    if (Math.abs(denominator) < 1e-9) continue

    for (let j = minJ; j <= maxJ; j += 1) {
      for (let i = minI; i <= maxI; i += 1) {
        const u = (((bz - cz) * (i - cx)) + ((cx - bx) * (j - cz))) / denominator
        if (u < 0) continue
        const v = (((cz - az) * (i - cx)) + ((ax - cx) * (j - cz))) / denominator
        if (v < 0) continue
        const w = 1 - u - v
        if (w < 0) continue

        const cell = i + (j * nx)
        const y = (u * vertexA.y) + (v * vertexB.y) + (w * vertexC.y)
        solid[cell] = 1
        if (y > height[cell]) height[cell] = y
      }
    }
  }
}

// Separable box blur, clamped at the edges. Used to feather the outline and to take the
// facets out of the height field.
function blur(field, nx, nz, radius, passes = 1) {
  if (radius < 1) return field
  const scratch = new Float32Array(field.length)
  for (let pass = 0; pass < passes; pass += 1) {
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        let sum = 0
        for (let k = -radius; k <= radius; k += 1) {
          sum += field[Math.min(nx - 1, Math.max(0, i + k)) + (j * nx)]
        }
        scratch[i + (j * nx)] = sum / ((radius * 2) + 1)
      }
    }
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        let sum = 0
        for (let k = -radius; k <= radius; k += 1) {
          sum += scratch[i + (Math.min(nz - 1, Math.max(0, j + k)) * nx)]
        }
        field[i + (j * nx)] = sum / ((radius * 2) + 1)
      }
    }
  }
  return field
}

// Off the airframe there is no surface to measure, but the sheet still has to sit
// somewhere — so empty cells grow their height outward from the skin they border. The
// sheet then leaves the trailing edge at the height the trailing edge left it, rather
// than dropping to the floor of the grid.
function fillHeight(height, solid, nx, nz) {
  const known = Float32Array.from(solid)
  const nextKnown = new Float32Array(known.length)
  const next = new Float32Array(height.length)

  for (let pass = 0; pass < MAX_FILL_PASSES; pass += 1) {
    let remaining = 0
    next.set(height)
    nextKnown.set(known)

    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const cell = i + (j * nx)
        if (known[cell]) continue

        let sum = 0
        let count = 0
        if (i > 0 && known[cell - 1]) { sum += height[cell - 1]; count += 1 }
        if (i < nx - 1 && known[cell + 1]) { sum += height[cell + 1]; count += 1 }
        if (j > 0 && known[cell - nx]) { sum += height[cell - nx]; count += 1 }
        if (j < nz - 1 && known[cell + nx]) { sum += height[cell + nx]; count += 1 }

        if (count) {
          next[cell] = sum / count
          nextKnown[cell] = 1
        } else {
          remaining += 1
        }
      }
    }

    height.set(next)
    known.set(nextKnown)
    if (!remaining) break
  }
}

// The wake: coverage carried aft, losing strength with distance. Air leaving the wing keeps
// the shape of what it left for a while, which is why the cloud streaming off the trailing
// edge is still wing-shaped and not a fringe.
function smearAft(solid, nx, nz, decay) {
  const wake = new Float32Array(solid.length)
  for (let j = 0; j < nz; j += 1) {
    let carry = 0
    // Fore to aft: index runs aft-to-fore, so this walks from the leading edge backwards.
    for (let i = nx - 1; i >= 0; i -= 1) {
      const cell = i + (j * nx)
      carry = Math.max(solid[cell], carry * decay)
      wake[cell] = carry
    }
  }
  return wake
}

/*
One bake. Returns the placement the sheet mesh takes in the airframe group, the texture the
shader reads, and the two numbers that turn its height channel back into airframe units.

Null if the airframe has none of the named meshes — a second aircraft that has not been
given a condensation block simply shows no vapour, rather than showing it in the wrong place.
*/
export function bakePlanform(model, tuning) {
  const footprint = measureFootprint(model, tuning)
  if (!footprint) return null

  const nx = tuning.resolution ?? DEFAULT_RESOLUTION
  const nz = Math.max(16, Math.round((nx * footprint.width) / footprint.length))
  const cellX = footprint.length / nx
  const cellZ = footprint.width / nz

  const solid = new Float32Array(nx * nz)
  const height = new Float32Array(nx * nz).fill(-Infinity)
  const grid = {
    nx,
    nz,
    solid,
    height,
    originX: footprint.trailing,
    originZ: footprint.minZ,
    cellX,
    cellZ,
  }

  const relative = new Matrix4()
  const meshes = tuning.planformMeshes ?? tuning.wingMeshes
  meshes.forEach((name) => {
    const mesh = model.getObjectByName(name)
    if (!mesh?.geometry) return
    rasterize(mesh, matrixInAirframeSpace(mesh, model, relative), grid)
  })

  let covered = 0
  for (let cell = 0; cell < solid.length; cell += 1) {
    if (solid[cell]) covered += 1
    else height[cell] = 0
  }
  if (!covered) return null

  const wake = smearAft(solid, nx, nz, Math.exp(-cellX / (footprint.chord * tuning.wakeLength)))
  blur(wake, nx, nz, 1, 1)

  fillHeight(height, solid, nx, nz)
  // Light: enough to take the facets out from under the sheet, not enough to sand the
  // spine flat. The standoff covers whatever it does take off.
  blur(height, nx, nz, 1, 2)

  const outline = Float32Array.from(solid)
  blur(outline, nx, nz, Math.max(1, Math.round((tuning.edgeFeather * footprint.chord) / cellX)), 2)

  let minY = Infinity
  let maxY = -Infinity
  for (let cell = 0; cell < height.length; cell += 1) {
    if (height[cell] < minY) minY = height[cell]
    if (height[cell] > maxY) maxY = height[cell]
  }
  const heightScale = Math.max(maxY - minY, 1e-4)

  const data = new Uint8Array(nx * nz * 4)
  for (let cell = 0; cell < solid.length; cell += 1) {
    data[cell * 4] = Math.round(Math.min(1, outline[cell]) * 255)
    data[(cell * 4) + 1] = Math.round(((height[cell] - minY) / heightScale) * 255)
    data[(cell * 4) + 2] = Math.round(Math.min(1, wake[cell]) * 255)
    data[(cell * 4) + 3] = 255
  }

  const texture = new DataTexture(data, nx, nz, RGBAFormat)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true

  return {
    texture,
    // The mesh sits at the footprint's centre in plan and at the airframe's own origin in
    // the vertical, so the shader can write absolute heights: its scale leaves Y at 1.
    position: [
      (footprint.leading + footprint.trailing) / 2,
      0,
      (footprint.minZ + footprint.maxZ) / 2,
    ],
    scale: [footprint.length, 1, footprint.width],
    heightMin: minY,
    heightScale,
    chord: footprint.chord,
    // One texel, in the mesh's own 0..1 grid space — the step the shader reads the height
    // gradient over when it works out which way the draped sheet is facing.
    texel: [1 / nx, 1 / nz],
  }
}
