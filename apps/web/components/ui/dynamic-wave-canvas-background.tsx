"use client";

import { useEffect, useRef } from "react";

/**
 * Canvas-based animated wave background.
 *
 * Pixel-by-pixel render using a downscaled offscreen buffer (controlled by
 * SCALE). Tuned for the Orchester palette — base coloring leans toward
 * violet/indigo with cyan highlights.
 *
 * Performance notes:
 *  - The inner double loop is O(width * height) per frame. We render at
 *    1/SCALE resolution then `putImageData` directly (no upscale draw — the
 *    canvas element is scaled visually via CSS).
 *  - SIN/COS lookup tables avoid Math.sin/cos calls in the hot path.
 *  - The frame loop is cancelled on unmount via requestAnimationFrame id.
 */
export default function HeroWave({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let imageData: ImageData;
    let data: Uint8ClampedArray;
    const SCALE = 3; // 1/3 resolution buffer — keeps the CPU loop affordable

    const resizeCanvas = () => {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(w / SCALE);
      canvas.height = Math.floor(h / SCALE);
      width = canvas.width;
      height = canvas.height;
      imageData = ctx.createImageData(width, height);
      data = imageData.data;
    };

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    const startTime = Date.now();

    // Precomputed sin/cos tables (1024 entries → bitmask wraparound)
    const SIN_TABLE = new Float32Array(1024);
    const COS_TABLE = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const angle = (i / 1024) * Math.PI * 2;
      SIN_TABLE[i] = Math.sin(angle);
      COS_TABLE[i] = Math.cos(angle);
    }

    const TAU = Math.PI * 2;
    const fastSin = (x: number) => {
      const norm = x - Math.floor(x / TAU) * TAU;
      const index = Math.floor((norm / TAU) * 1024) & 1023;
      return SIN_TABLE[index]!;
    };
    const fastCos = (x: number) => {
      const norm = x - Math.floor(x / TAU) * TAU;
      const index = Math.floor((norm / TAU) * 1024) & 1023;
      return COS_TABLE[index]!;
    };

    let rafId = 0;
    const render = () => {
      const time = (Date.now() - startTime) * 0.001;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const u_x = (2 * x - width) / height;
          const u_y = (2 * y - height) / height;

          let a = 0;
          let d = 0;

          // 4 iterations of the wave equation — classic shadertoy pattern
          for (let i = 0; i < 4; i++) {
            a += fastCos(i - d + time * 0.5 - a * u_x);
            d += fastSin(i * u_y + a);
          }

          const wave = (fastSin(a) + fastCos(d)) * 0.5;
          const intensity = 0.28 + 0.42 * wave;
          const baseVal = 0.09 + 0.14 * fastCos(u_x + u_y + time * 0.3);
          const blueAccent = 0.22 * fastSin(a * 1.5 + time * 0.2);
          const violetAccent = 0.18 * fastCos(d * 2 + time * 0.1);

          // Orchester palette weights:
          //  R channel leans violet (gets violetAccent)
          //  G channel slightly muted
          //  B channel gets the strongest blue/violet kick
          const r = Math.max(0, Math.min(1, baseVal + violetAccent * 0.95)) * intensity;
          const g = Math.max(0, Math.min(1, baseVal * 0.85 + blueAccent * 0.55)) * intensity;
          const b =
            Math.max(0, Math.min(1, baseVal + blueAccent * 1.3 + violetAccent * 0.55)) * intensity;

          const index = (y * width + x) * 4;
          data[index] = r * 255;
          data[index + 1] = g * 255;
          data[index + 2] = b * 255;
          data[index + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "absolute inset-0 h-full w-full"}
      style={{ imageRendering: "auto" }}
      aria-hidden="true"
    />
  );
}
