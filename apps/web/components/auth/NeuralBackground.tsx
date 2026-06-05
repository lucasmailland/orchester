"use client";

import { useEffect, useRef } from "react";

export function NeuralBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = (canvas.width = canvas.offsetWidth);
    let h = (canvas.height = canvas.offsetHeight);

    type Node = { x: number; y: number; vx: number; vy: number; r: number; pulse: number };

    const nodes: Node[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: Math.random() * 1.4 + 0.4,
      pulse: Math.random() * Math.PI * 2,
    }));

    let raf: number;
    let frame = 0;

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      frame++;

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const ni = nodes[i]!;
          const nj = nodes[j]!;
          const dx = ni.x - nj.x;
          const dy = ni.y - nj.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            const alpha = (1 - dist / 140) * 0.11;
            ctx!.beginPath();
            ctx!.strokeStyle = `rgba(139,92,246,${alpha})`;
            ctx!.lineWidth = 0.5;
            ctx!.moveTo(ni.x, ni.y);
            ctx!.lineTo(nj.x, nj.y);
            ctx!.stroke();
          }
        }
      }

      nodes.forEach((n) => {
        const glowAlpha = 0.15 + Math.sin(n.pulse + frame * 0.015) * 0.08;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r + 1.5, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(139,92,246,${glowAlpha * 0.4})`;
        ctx!.fill();

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(167,139,250,${glowAlpha})`;
        ctx!.fill();

        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      });

      raf = requestAnimationFrame(draw);
    }

    draw();

    const onResize = () => {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
