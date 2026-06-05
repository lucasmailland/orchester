"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useMotionValue, useTransform, animate } from "framer-motion";

interface Props {
  /** Either a numeric value (which animates from 0) or a static string like "–" */
  value: number | string;
  /** Suffix to append after the animated number (e.g. "k", "+", "%") */
  suffix?: string;
  /** Decimal places for formatting (e.g. 1 for "2.4k") */
  decimals?: number;
  className?: string;
}

/**
 * Animated counter — when the element enters the viewport, the number counts
 * up from 0 to `value` over ~1.4 s with a smooth ease-out curve.
 * Non-numeric `value` is rendered as-is without animation.
 */
export function AnimatedNumber({ value, suffix = "", decimals = 0, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  if (typeof value !== "number") {
    return (
      <span ref={ref} className={className}>
        {String(value)}
        {suffix}
      </span>
    );
  }

  return (
    <Counter
      nodeRef={ref}
      target={value}
      inView={inView}
      suffix={suffix}
      decimals={decimals}
      {...(className !== undefined && { className })}
    />
  );
}

function Counter({
  nodeRef,
  target,
  inView,
  suffix,
  decimals,
  className,
}: {
  nodeRef: React.RefObject<HTMLSpanElement | null>;
  target: number;
  inView: boolean;
  suffix: string;
  decimals: number;
  className?: string;
}) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (latest) =>
    decimals > 0 ? latest.toFixed(decimals) : Math.round(latest).toString()
  );
  const [displayed, setDisplayed] = useState("0");

  useEffect(() => {
    return rounded.on("change", (v) => setDisplayed(v));
  }, [rounded]);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, target, {
      duration: 1.4,
      ease: [0.22, 0.61, 0.36, 1],
    });
    return () => controls.stop();
  }, [inView, target, mv]);

  return (
    <span ref={nodeRef} className={className}>
      {displayed}
      {suffix}
    </span>
  );
}
