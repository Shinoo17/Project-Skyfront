import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

const KTX2_TRANSCODER_PATH = '/basis/'

// One transcoder per renderer. Each surface mounts its own Canvas, so the loader
// is keyed weakly and disposed along with the WebGL context it detected support on.
const ktx2Loaders = new WeakMap()

export function getKTX2Loader(renderer) {
  if (!ktx2Loaders.has(renderer)) {
    ktx2Loaders.set(
      renderer,
      new KTX2Loader()
        .setTranscoderPath(KTX2_TRANSCODER_PATH)
        .detectSupport(renderer),
    )
  }

  return ktx2Loaders.get(renderer)
}

// Pass to useGLTF's extendLoader argument so compressed textures transcode.
export function withKTX2(ktx2Loader) {
  return (loader) => loader.setKTX2Loader(ktx2Loader)
}
