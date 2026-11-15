// Ambient type declarations for Three.js JSM extras.
// three@0.184 ships pure JS without bundled .d.ts for examples/jsm.
// These minimal stubs satisfy the compiler; runtime behaviour is unchanged.
declare module "three/examples/jsm/postprocessing/UnrealBloomPass.js" {
  import type { Vector2 } from "three";
  export class UnrealBloomPass {
    constructor(resolution: Vector2, strength?: number, radius?: number, threshold?: number);
    enabled: boolean;
    strength: number;
    radius: number;
    threshold: number;
    renderToScreen: boolean;
    dispose(): void;
  }
}

declare module "three/examples/jsm/postprocessing/EffectComposer.js" {
  import type { WebGLRenderer, WebGLRenderTarget } from "three";
  export class Pass {
    enabled: boolean;
    needsSwap: boolean;
    clear: boolean;
    renderToScreen: boolean;
  }
  export class EffectComposer {
    constructor(renderer: WebGLRenderer, renderTarget?: WebGLRenderTarget);
    passes: Pass[];
    addPass(pass: Pass): void;
    removePass(pass: Pass): void;
    render(delta?: number): void;
    dispose(): void;
  }
}
