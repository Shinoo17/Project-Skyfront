/*
The small frame-rate-independent helpers the whole model leans on. They are here rather
than beside their first caller because the aerodynamics, the PSM state machine and the
High-G envelope all step the same way, and one definition is what keeps them in step.
*/

import { MathUtils } from 'three'

export function smooth01(value) {
  const clamped = MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - (2 * clamped))
}

// Frame-rate independent first-order chase.
export function approach(current, target, rate, dt) {
  return current + ((target - current) * (1 - Math.exp(-rate * dt)))
}

export function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target
  return current + (Math.sign(target - current) * maxDelta)
}