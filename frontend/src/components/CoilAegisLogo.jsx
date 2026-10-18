import React from "react";

/**
 * CoilAegis — shield + coil spiral mark.
 * Fully inline SVG, scales to any size, no raster dependency.
 *
 * Props:
 *   size      pixel size (default 24)
 *   variant   'icon' (shield only) | 'full' (shield + wordmark)
 *   tone      'light' (default — for dark surfaces) | 'dark' (for light surfaces)
 *   className additional classes for layout
 *   title     accessible label (default "CoilAegis")
 */
const CoilAegisLogo = ({
  size = 24,
  variant = "icon",
  tone = "light",
  className = "",
  title = "CoilAegis",
}) => {
  const accent = "#FF6B1A";
  const shieldFill = tone === "dark" ? "#0D1A24" : "#0D1A24";
  const shieldStroke = accent;
  const spiralStroke = accent;
  const textColor = tone === "dark" ? "#0D1A24" : "#FFFFFF";

  // Shield viewBox — 32 wide, 36 tall. Centered coil spiral inside.
  const shield = (
    <svg
      viewBox="0 0 32 36"
      width={size}
      height={(size * 36) / 32}
      role="img"
      aria-label={title}
      style={{ display: "inline-block", flexShrink: 0 }}
    >
      <title>{title}</title>
      {/* Shield body */}
      <path
        d="M16 1.5 L29.5 5 V18 C29.5 25 24 32 16 34.5 C8 32 2.5 25 2.5 18 V5 Z"
        fill={shieldFill}
        stroke={shieldStroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* Inner coil spiral — Archimedes spiral centered in shield */}
      <g transform="translate(16 18)" fill="none" stroke={spiralStroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* Outer ring */}
        <circle cx="0" cy="0" r="8.2" opacity="0.35" />
        {/* Spiral path — tight 2.5 turns */}
        <path d="M 0 0
                 m 0.6 0
                 a 0.6 0.6 0 1 1 -0.01 0
                 M 1.6 0.6
                 a 1.9 1.9 0 1 1 -0.9 3
                 M -0.8 4.1
                 a 3.4 3.4 0 1 1 3.9 -3.4
                 M 5.5 -0.4
                 a 5 5 0 1 1 -5.3 5.1
                 M -1.1 6.9
                 a 6.6 6.6 0 1 1 7.3 -5.5" />
        {/* Pipe inlet tick — bottom emerging from shield */}
        <line x1="0" y1="7.5" x2="0" y2="11.5" strokeWidth="2" />
      </g>
    </svg>
  );

  if (variant === "icon") {
    return <span className={className} aria-label={title}>{shield}</span>;
  }

  // Wordmark variant: shield + "CoilAegis" letters
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label={title}>
      {shield}
      <span
        className="font-extrabold tracking-tight"
        style={{ color: textColor, fontSize: size * 0.72, letterSpacing: "-0.02em", lineHeight: 1 }}
      >
        Coil<span style={{ color: accent }}>Aegis</span>
      </span>
    </span>
  );
};

export default CoilAegisLogo;
