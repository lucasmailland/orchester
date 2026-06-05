"use client";

import type React from "react";
import { useRef, useState, Suspense } from "react";
import * as THREE from "three";
import { Canvas, extend, useFrame } from "@react-three/fiber";
import { shaderMaterial, OrthographicCamera } from "@react-three/drei";

// Orchester palette: violet → indigo → cyan
// Inigo Quilez cosine-palette tuned to land on those hues.
const WaveMaterial = shaderMaterial(
  {
    time: 0,
    resolution: new THREE.Vector2(1, 1),
    pointer: new THREE.Vector2(0, 0),
    tiles: 1.5,
  },
  /* glsl */ `
    varying vec2 vUv;
    void main() {
      vec4 modelPosition = modelMatrix * vec4(position, 1.0);
      vec4 viewPosition = viewMatrix * modelPosition;
      vec4 projectionPosition = projectionMatrix * viewPosition;
      gl_Position = projectionPosition;
      vUv = uv;
    }
  `,
  /* glsl */ `
    uniform float time;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float tiles;
    varying vec2 vUv;

    // Cosine palette tuned for violet → indigo → cyan (Orchester accent)
    vec3 palette(float t) {
      vec3 a = vec3(0.42, 0.40, 0.58);
      vec3 b = vec3(0.45, 0.35, 0.50);
      vec3 c = vec3(1.00, 1.00, 1.10);
      vec3 d = vec3(0.10, 0.55, 0.75);
      return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      vec2 uv0 = uv;
      vec3 finalColor = vec3(0.0);

      uv = uv * tiles - pointer;

      float d = length(uv) * exp(-length(uv0));
      vec3 col = palette(length(uv0) + time * 0.35);
      d = sin(d * 8.0 + time) / 8.0;
      d = abs(d);
      d = pow(0.018 / d, 1.7);
      finalColor += col * d;

      float alpha = clamp(length(finalColor) * 0.85, 0.0, 1.0);
      gl_FragColor = vec4(finalColor, alpha);
    }
  `
);

extend({ WaveMaterial });

// Augment JSX intrinsic elements for the extended material
declare module "@react-three/fiber" {
  interface ThreeElements {
    waveMaterial: ThreeElements["shaderMaterial"];
  }
}

export type WaveProps = {
  width?: number | string;
  height?: number | string;
  speed?: number;
  tiles?: number;
  pointer?: { x: number; y: number };
  disablePointerTracking?: boolean;
  dpr?: number | [number, number];
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  className?: string;
  style?: React.CSSProperties;
};

function WaveQuad({
  speed = 1,
  tiles = 1.5,
  pointerOverride,
  trackPointer = true,
}: {
  speed?: number;
  tiles?: number;
  pointerOverride?: { x: number; y: number } | null;
  trackPointer?: boolean;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  useFrame((state, delta) => {
    const mat = matRef.current;
    if (!mat) return;
    const u = mat.uniforms as {
      time: { value: number };
      resolution: { value: THREE.Vector2 };
      pointer: { value: THREE.Vector2 };
      tiles: { value: number };
    };
    u.time.value += delta * speed;
    u.resolution.value.set(state.size.width, state.size.height);

    if (pointerOverride) {
      u.pointer.value.set(pointerOverride.x, pointerOverride.y);
    } else if (trackPointer) {
      u.pointer.value.set(state.pointer.x, state.pointer.y);
    }

    u.tiles.value = tiles;
  });

  return (
    <group>
      <OrthographicCamera makeDefault position={[0, 0, 10]} />
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[2000, 2000]} />
        <waveMaterial ref={matRef} transparent />
      </mesh>
    </group>
  );
}

export function Wave({
  width = "100%",
  height = "100%",
  speed = 0.5,
  tiles = 1,
  pointer: pointerOverride,
  disablePointerTracking = false,
  dpr = [1, 2],
  onPointerMove,
  className,
  style,
}: WaveProps) {
  const [localPointer, setLocalPointer] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className={className}
      style={{
        width,
        height,
        overflow: "hidden",
        ...style,
      }}
      onPointerMove={(e) => {
        if (!disablePointerTracking && !pointerOverride) {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
          setLocalPointer({ x: nx, y: ny });
        }
        onPointerMove?.(e);
      }}
    >
      <Canvas
        dpr={dpr}
        frameloop="always"
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0, 10] }}
        style={{ background: "transparent" }}
      >
        <Suspense fallback={null}>
          <WaveQuad
            speed={speed}
            tiles={tiles}
            pointerOverride={pointerOverride ?? localPointer ?? null}
            trackPointer={!disablePointerTracking && !pointerOverride}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
