import { AnimationClip, MathUtils, PropertyBinding } from 'three'

// The exported bind pose has several doors deployed. Apply frame zero of every track
// once so the true rest pose is the closed/stowed state before actions bind.
export function applyClosedRestPose(model, animations) {
  const appliedTracks = new Set()

  animations.forEach((clip) => {
    clip.tracks.forEach((track) => {
      if (appliedTracks.has(track.name)) return

      const binding = PropertyBinding.create(model, track.name)
      binding.setValue(track.createInterpolant().evaluate(0), 0)
      binding.unbind()
      appliedTracks.add(track.name)
    })
  })

  model.updateMatrixWorld(true)
}

function trackHasMotion(track) {
  const valueSize = track.getValueSize()
  if (track.times.length < 2 || !valueSize) return false

  const first = track.values.slice(0, valueSize)
  const isQuaternion = track.name.endsWith('.quaternion')

  for (let offset = valueSize; offset < track.values.length; offset += valueSize) {
    if (isQuaternion) {
      let dot = 0
      let firstLengthSq = 0
      let sampleLengthSq = 0

      for (let component = 0; component < valueSize; component += 1) {
        const firstValue = first[component]
        const sampleValue = track.values[offset + component]
        dot += firstValue * sampleValue
        firstLengthSq += firstValue * firstValue
        sampleLengthSq += sampleValue * sampleValue
      }

      const length = Math.sqrt(firstLengthSq * sampleLengthSq)
      const cosine = length
        ? MathUtils.clamp(Math.abs(dot / length), -1, 1)
        : 1
      if (2 * Math.acos(cosine) > 0.0001) return true
      continue
    }

    for (let component = 0; component < valueSize; component += 1) {
      if (Math.abs(track.values[offset + component] - first[component]) > 0.00001) {
        return true
      }
    }
  }

  return false
}

// Blender sampled every bone into several independent clips. Keeping those static
// tracks makes AnimationMixer average unrelated actions, which reduces the travel of
// doors and landing gear. Retain only properties that move.
export function stripStaticTracks(animations) {
  return animations.map((clip) => new AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.filter(trackHasMotion).map((track) => track.clone()),
    clip.blendMode,
  ))
}

// Both steps together: what a surface that plays the embedded clips needs. A surface
// that only flies the airframe (no mixer) calls applyClosedRestPose on its own.
export function prepareModelAnimations(model, animations) {
  applyClosedRestPose(model, animations)
  return stripStaticTracks(animations)
}
