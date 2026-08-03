/*
Vite resolves extensionless relative imports; Node does not, and `src/` is written for
Vite. This resolver hook lets a plain `node` process import the flight model unchanged —
no build step, no duplicated copy of the physics for the checker to drift away from.
*/
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      for (const suffix of ['.js', '.jsx', '/index.js']) {
        try {
          return await next(specifier + suffix, context)
        } catch { /* try the next shape */ }
      }
    }
    throw error
  }
}
