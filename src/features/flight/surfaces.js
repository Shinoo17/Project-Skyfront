import { MathUtils } from 'three'

// Slews every resolved hinge toward its target angle. Called once per frame from both
// surfaces, so it allocates nothing: each hinge carries its own scratch quaternions.
export function applySurfaceTargets(surfaces, targetAngles, blend) {
  Object.entries(targetAngles).forEach(([name, degrees]) => {
    const surface = surfaces[name]
    if (!surface) return

    surface.target
      .copy(surface.rest)
      .multiply(
        surface.rotation.setFromAxisAngle(
          surface.localAxis,
          MathUtils.degToRad(MathUtils.clamp(degrees, -surface.limit, surface.limit)),
        ),
      )
    surface.bone.quaternion.slerp(surface.target, blend)
  })
}
