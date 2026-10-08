"use client";

import { useEffect, useRef } from "react";
import { BOT_COLORS } from "@/lib/bot/presets";
import type { BotColor, BotShape } from "@/lib/db/schema";

/**
 * The Accred muse: a small pebble with two eyes. `MuseFace` is the still
 * version (avatars, the hero). `Muse` is the companion that trails the
 * cursor around the site, eyes on the pointer. It never takes clicks and
 * stays away on touch screens and for people who prefer reduced motion.
 */

const PATHS: Record<BotShape, string> = {
  // A soft pebble.
  round: "M50 4c26 0 46 18 46 44 0 28-18 48-46 48S4 76 4 48C4 22 24 4 50 4z",
  // A drop, flat on top.
  drop: "M50 6c28 0 44 14 44 40 0 24-12 50-44 50S6 70 6 46C6 20 22 6 50 6z",
  // A peak, like a mountain with a rounded tip.
  peak: "M50 6c6 0 10 4 14 12l28 56c4 8-2 20-14 20H22C10 94 4 82 8 74l28-56c4-8 8-12 14-12z",
};

export function MuseFace({
  color = "teal",
  shape = "round",
  size = 32,
  light = false,
  className = "",
  eyes,
}: {
  color?: BotColor;
  shape?: BotShape;
  size?: number;
  /** A white face with dark eyes, for the hero. */
  light?: boolean;
  className?: string;
  /** Eye offset in viewBox units, for a face that looks somewhere. */
  eyes?: { x: number; y: number };
}) {
  const fill = light ? "#f3f1ec" : BOT_COLORS[color].bg;
  const eye = light ? "#171614" : "rgba(255,255,255,0.92)";
  const dx = eyes?.x ?? 0;
  const dy = eyes?.y ?? 0;
  const top = shape === "peak" ? 10 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <path d={PATHS[shape]} fill={fill} />
      <g transform={`translate(${dx} ${dy + top})`}>
        <rect x="31" y="34" width="11" height="22" rx="5.5" fill={eye} transform="rotate(-12 36 45)" />
        <rect x="58" y="36" width="11" height="22" rx="5.5" fill={eye} transform="rotate(12 63 47)" />
      </g>
    </svg>
  );
}

export function Muse() {
  const ref = useRef<HTMLDivElement>(null);
  const eyesRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const node = ref.current;
    const eyes = eyesRef.current;
    if (!node || !eyes) return;
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight / 2;
    let x = targetX;
    let y = targetY;
    let visible = false;
    let frame = 0;
    let lastMove = 0;
    let blinkAt = performance.now() + 2500;
    let blinking = false;

    const onMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      lastMove = performance.now();
      if (!visible) {
        visible = true;
        node.style.opacity = "1";
      }
    };
    const onLeave = () => {
      visible = false;
      node.style.opacity = "0";
    };

    const tick = (now: number) => {
      // Spring toward a spot below and to the right of the pointer, so it never covers what is under the cursor.
      const goalX = targetX + 22;
      const goalY = targetY + 26;
      x += (goalX - x) * 0.14;
      y += (goalY - y) * 0.14;
      const vx = goalX - x;
      const vy = goalY - y;
      const speed = Math.min(1, Math.hypot(vx, vy) / 140);
      // Lean into the direction of travel, squash a little when moving fast.
      const lean = Math.max(-18, Math.min(18, vx * 0.12));
      const scaleX = 1 + speed * 0.12;
      const scaleY = 1 - speed * 0.1;
      node.style.transform = `translate3d(${x - 20}px, ${y - 20}px, 0) rotate(${lean}deg) scale(${scaleX}, ${scaleY})`;

      // Eyes look toward the pointer.
      const ex = Math.max(-8, Math.min(8, (targetX - x) * 0.05));
      const ey = Math.max(-6, Math.min(6, (targetY - y) * 0.05));
      const idle = now - lastMove > 1800;
      if (now > blinkAt && !blinking) {
        blinking = true;
        eyes.style.transform = `translate(${ex}px, ${ey}px) scaleY(0.12)`;
        setTimeout(() => {
          blinking = false;
          blinkAt = performance.now() + 1800 + Math.random() * 3200;
        }, 110);
      } else if (!blinking) {
        eyes.style.transform = `translate(${ex}px, ${ey + (idle ? Math.sin(now / 600) * 1.5 : 0)}px) scaleY(1)`;
      }
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[60] h-10 w-10 opacity-0 transition-opacity duration-300 will-change-transform"
      style={{ filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.45))" }}
    >
      <svg width="40" height="40" viewBox="0 0 100 100">
        <path d={PATHS.round} fill="#f3f1ec" />
        <g ref={eyesRef} style={{ transformOrigin: "50px 46px", transition: "transform 80ms linear" }}>
          <rect x="31" y="34" width="11" height="22" rx="5.5" fill="#171614" transform="rotate(-12 36 45)" />
          <rect x="58" y="36" width="11" height="22" rx="5.5" fill="#171614" transform="rotate(12 63 47)" />
        </g>
      </svg>
    </div>
  );
}
