import { Quaternion } from 'three'

// Orientation of a bone relative to the aircraft body, independent of where the model
// currently sits in the scene graph.
export function bodyQuaternion(bone, root) {
  const quaternion = new Quaternion()
  for (let node = bone; node; node = node.parent) {
    quaternion.premultiply(node.quaternion)
    if (node === root) break
  }
  return quaternion
}

// Resolves one control surface into a hinge the render loop can drive: the bone that
// owns it, a hinge axis flipped to agree with `reference` so left/right halves deflect
// symmetrically, and preallocated quaternions so no garbage is produced per frame.
export function makeHinge(model, meshName, hingeAxis, reference, limit) {
  const bone = model.getObjectByName(meshName)?.parent
  if (!bone) return null

  const localAxis = hingeAxis.clone()
  const bodyAxis = localAxis.clone().applyQuaternion(bodyQuaternion(bone, model))
  if (bodyAxis.dot(reference) < 0) localAxis.negate()

  return {
    bone,
    localAxis,
    limit,
    rest: bone.quaternion.clone(),
    rotation: new Quaternion(),
    target: new Quaternion(),
  }
}

// Builds every hinge described by an aircraft manifest's control-surface map.
export function makeHinges(model, surfaceMap) {
  return Object.fromEntries(
    Object.entries(surfaceMap).map(([name, [meshName, axis, reference, limit]]) => [
      name,
      makeHinge(model, meshName, axis, reference, limit),
    ]),
  )
}
