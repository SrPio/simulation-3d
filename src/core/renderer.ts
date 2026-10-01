import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';

/** Above 1.5 the extra pixels cost far more GPU time than they add sharpness on this scene. */
export const MAX_PIXEL_RATIO = 1.5;

export function createRenderer(): WebGLRenderer {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!context) throw new Error('WEBGL_UNAVAILABLE');
  let renderer: WebGLRenderer | undefined;
  try {
    renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    canvas.setAttribute('aria-label', 'Visor 3D del personaje. Arrastra para girar; usa la rueda para acercar. Las vistas también se pueden elegir en Cámara.');
    canvas.setAttribute('role', 'img');
    return renderer;
  } catch (error) {
    renderer?.dispose();
    context.getExtension('WEBGL_lose_context')?.loseContext();
    throw error;
  }
}
