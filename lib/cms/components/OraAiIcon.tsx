'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface OraAiIconProps {
  size?: number;
  /** When true, the bubble pulses to draw attention. Used on the closed floating bubble. */
  pulse?: boolean;
  /** Stroke / glyph color. Defaults to currentColor so the icon picks up the parent's text color. */
  color?: string;
}

/**
 * ORA AI Assistant glyph — a stylized speech bubble with three orbiting dots.
 * Uses the ORA wordmark stroke vibe (geometric, sharp triangle/circle/square mix)
 * so it sits naturally next to the brand. Animated with framer-motion:
 *   - the bubble outline gently breathes (scale)
 *   - the three dots stagger-pulse ("typing"/"thinking" feel)
 *   - optional outer pulse ring when `pulse` is set (closed floating button)
 */
export function OraAiIcon({ size = 28, pulse = false, color }: OraAiIconProps) {
  const stroke = color ?? 'currentColor';
  const fill = color ?? 'currentColor';

  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        position: 'relative',
        width: size,
        height: size,
      }}
    >
      {pulse && (
        <motion.span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '9999px',
            background: 'currentColor',
            opacity: 0.35,
          }}
          initial={{ scale: 0.85, opacity: 0.45 }}
          animate={{ scale: [0.85, 1.4, 0.85], opacity: [0.45, 0, 0.45] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      <motion.svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        fill="none"
        style={{ position: 'relative', display: 'block' }}
        initial={{ scale: 0.96 }}
        animate={{ scale: [0.96, 1.02, 0.96] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Bubble outline — geometric like the ORA wordmark */}
        <motion.path
          d="M12 14
             L52 14
             A6 6 0 0 1 58 20
             L58 38
             A6 6 0 0 1 52 44
             L36 44
             L28 54
             L28 44
             L12 44
             A6 6 0 0 1 6 38
             L6 20
             A6 6 0 0 1 12 14 Z"
          stroke={stroke}
          strokeWidth={3}
          strokeLinejoin="round"
          fill="none"
        />

        {/* Three thinking dots */}
        {[0, 1, 2].map((i) => (
          <motion.circle
            key={i}
            cx={20 + i * 12}
            cy={29}
            r={3}
            fill={fill}
            initial={{ opacity: 0.3, y: 0 }}
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -1.5, 0] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.18,
            }}
          />
        ))}
      </motion.svg>
    </span>
  );
}

export default OraAiIcon;
