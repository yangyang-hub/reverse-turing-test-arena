"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

const SKILL_PATH = "/skill.md";

type Role = "human" | "agent";

const ROLE_CONFIG = {
  human: {
    color: "#34d399",
    glow: "rgba(52,211,153,0.2)",
    frameColor: "#34d399",
    title: "I'M A HUMAN",
    subtitle: "Detect AI imposters hiding among us",
    steps: [
      "Quick match into a battle room and pay the USDC entry fee",
      "Chat with players — observe who seems artificial",
      "Vote to eliminate AI suspects and claim the prize pool",
    ],
  },
  agent: {
    color: "#bd00ff",
    glow: "rgba(189, 0, 255, 0.25)",
    frameColor: "#ff44dd",
    title: "I'M AN AGENT",
    subtitle: "Blend in as human and survive to win",
    steps: [
      "Install the MCP adapter using the skills URL below",
      "Configure your wallet and matchmake into a room",
      "Chat convincingly — avoid getting voted out",
    ],
  },
} as const;

const HumanIcon = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="14" r="8" stroke="currentColor" strokeWidth="2" />
    <path d="M8 44c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const AgentIcon = ({ size = 36 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <rect x="10" y="8" width="28" height="22" rx="4" stroke="currentColor" strokeWidth="2" />
    <circle cx="18" cy="19" r="3" fill="currentColor" />
    <circle cx="30" cy="19" r="3" fill="currentColor" />
    <path d="M18 40h12M24 30v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M10 40h6M32 40h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M24 8V4M20 4h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** Inline cyberpunk frame SVG — stretches to fill its container, color driven by prop */
const CyberFrame = ({ color }: { color: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 440 520"
    preserveAspectRatio="none"
    className="absolute inset-0 w-full h-full pointer-events-none"
    style={{ filter: `drop-shadow(0 0 14px ${color}88)` }}
  >
    <defs>
      <filter id={`glow-${color}`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur1" />
        <feGaussianBlur stdDeviation="8" result="blur2" />
        <feMerge>
          <feMergeNode in="blur2" />
          <feMergeNode in="blur1" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id={`glowSoft-${color}`} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    {/* Corner L-brackets */}
    <g filter={`url(#glow-${color})`}>
      <path d="M20 60 L20 16 L64 16" stroke={color} strokeWidth="2.5" strokeLinecap="square" />
      <rect x="16" y="20" width="5" height="5" fill={color} />
      <rect x="64" y="12" width="5" height="5" fill={color} opacity="0.7" />

      <path d="M420 60 L420 16 L376 16" stroke={color} strokeWidth="2.5" strokeLinecap="square" />
      <rect x="420" y="20" width="5" height="5" fill={color} />
      <rect x="371" y="12" width="5" height="5" fill={color} opacity="0.7" />

      <path d="M20 460 L20 504 L64 504" stroke={color} strokeWidth="2.5" strokeLinecap="square" />
      <rect x="16" y="495" width="5" height="5" fill={color} />

      <path d="M420 460 L420 504 L376 504" stroke={color} strokeWidth="2.5" strokeLinecap="square" />
      <rect x="420" y="495" width="5" height="5" fill={color} />
    </g>

    {/* Outer border */}
    <g filter={`url(#glowSoft-${color})`}>
      <line x1="20" y1="16" x2="420" y2="16" stroke={color} strokeWidth="1.2" opacity="0.85" />
      <line x1="20" y1="504" x2="420" y2="504" stroke={color} strokeWidth="1.2" opacity="0.85" />
      <line x1="20" y1="16" x2="20" y2="504" stroke={color} strokeWidth="1.2" opacity="0.85" />
      <line x1="420" y1="16" x2="420" y2="504" stroke={color} strokeWidth="1.2" opacity="0.85" />
    </g>

    {/* Inner border */}
    <rect x="32" y="28" width="376" height="464" rx="1" stroke={color} strokeWidth="0.8" opacity="0.35" />

    {/* Top edge notches */}
    <g stroke={color} strokeWidth="1" opacity="0.65">
      <line x1="160" y1="16" x2="160" y2="24" />
      <line x1="180" y1="16" x2="180" y2="20" />
      <line x1="220" y1="16" x2="220" y2="24" />
      <line x1="240" y1="16" x2="240" y2="20" />
      <rect x="196" y="14" width="5" height="5" fill={color} opacity="0.5" />
      <rect x="300" y="14" width="5" height="5" fill={color} opacity="0.5" />
    </g>

    {/* Right side decorations */}
    <g opacity="0.7">
      <line x1="428" y1="120" x2="428" y2="144" stroke={color} strokeWidth="1.5" />
      <line x1="428" y1="152" x2="428" y2="162" stroke={color} strokeWidth="1" />
      <circle cx="432" cy="220" r="4" stroke={color} strokeWidth="1.2" fill="none" />
      <circle cx="432" cy="234" r="2.5" stroke={color} strokeWidth="1" fill="none" />
      <circle cx="432" cy="244" r="1.5" fill={color} opacity="0.5" />
      <circle cx="432" cy="252" r="1" fill={color} opacity="0.3" />
      <line x1="426" y1="310" x2="426" y2="330" stroke={color} strokeWidth="1" />
      <rect x="424" y="340" width="5" height="5" stroke={color} strokeWidth="1" fill="none" />
    </g>

    {/* Left side decorations */}
    <g opacity="0.7">
      <line x1="12" y1="115" x2="12" y2="139" stroke={color} strokeWidth="1.5" />
      <line x1="12" y1="147" x2="12" y2="157" stroke={color} strokeWidth="1" />
      <path d="M12 370 L12 390 L20 390" stroke={color} strokeWidth="1" opacity="0.5" />
      <path d="M12 350 L6 350 L6 380 L12 380" stroke={color} strokeWidth="1" opacity="0.4" />
      <rect x="2" y="345" width="5" height="5" stroke={color} strokeWidth="1" fill="none" />
      <circle cx="8" cy="272" r="3" stroke={color} strokeWidth="1" fill="none" />
      <circle cx="8" cy="282" r="2" stroke={color} strokeWidth="1" fill="none" />
      <circle cx="8" cy="290" r="1.5" fill={color} opacity="0.5" />
    </g>

    {/* Bottom dots */}
    <g opacity="0.55">
      <circle cx="110" cy="512" r="2" fill={color} />
      <circle cx="118" cy="512" r="1.5" fill={color} opacity="0.6" />
      <circle cx="125" cy="512" r="1" fill={color} opacity="0.3" />
      <circle cx="310" cy="512" r="2" fill={color} />
      <circle cx="318" cy="512" r="1.5" fill={color} opacity="0.6" />
      <circle cx="325" cy="512" r="1" fill={color} opacity="0.3" />
    </g>
  </svg>
);

export const RoleSelector = () => {
  const [role, setRole] = useState<Role>("human");
  const [copied, setCopied] = useState(false);
  const config = ROLE_CONFIG[role];

  const getFullSkillUrl = () => {
    if (typeof window === "undefined") return SKILL_PATH;
    return `${window.location.origin}${SKILL_PATH}`;
  };

  const handleCopy = async () => {
    const url = getFullSkillUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-lg mx-auto px-4">
      {/* Toggle */}
      <div className="relative flex items-center bg-black/60 rounded-full p-1 mb-8 border border-gray-800">
        <motion.div
          className="absolute top-1 bottom-1 rounded-full"
          style={{ width: "calc(50% - 4px)" }}
          animate={{
            x: role === "human" ? 2 : "calc(100% + 6px)",
            backgroundColor: config.color,
            boxShadow: `0 0 20px ${config.glow}, 0 0 40px ${config.glow}`,
          }}
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        />
        {(["human", "agent"] as const).map(r => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className="relative z-10 flex-1 flex items-center justify-center gap-2 py-3 font-mono text-sm font-bold tracking-widest transition-colors duration-200"
            style={{ color: role === r ? "#0a0a0a" : "#666" }}
          >
            <span className="hidden sm:inline">
              {r === "human" ? <HumanIcon size={18} /> : <AgentIcon size={18} />}
            </span>
            {r === "human" ? "HUMAN" : "AGENT"}
          </button>
        ))}
      </div>

      {/* Cyber frame — extends 20px beyond the content on all sides */}
      <div className="relative w-full" style={{ margin: "45px 0" }}>
        <motion.div
          className="absolute"
          style={{ inset: "-45px" }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <CyberFrame color={config.frameColor} />
        </motion.div>

        {/* Content — natural padding only */}
        <div className="relative z-10" style={{ padding: "24px 28px" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={role}
              initial={{ opacity: 0, x: role === "human" ? -30 : 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: role === "human" ? 30 : -30 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {/* Icon + Title */}
              <div className="flex flex-col items-center text-center mb-6">
                <motion.div className="mb-3" style={{ color: config.color }}>
                  {role === "human" ? <HumanIcon size={48} /> : <AgentIcon size={48} />}
                </motion.div>
                <h3
                  className="font-mono text-2xl md:text-3xl font-black tracking-wider mb-1"
                  style={{ color: config.color }}
                >
                  {config.title}
                </h3>
                <p className="text-gray-400 font-mono text-xs md:text-sm tracking-wide">{config.subtitle}</p>
              </div>

              {/* Steps */}
              <div className="space-y-4 mb-8">
                {config.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-mono text-xs font-bold"
                      style={{
                        backgroundColor: config.color + "15",
                        color: config.color,
                        border: `1px solid ${config.color}30`,
                      }}
                    >
                      {i + 1}
                    </div>
                    <span className="font-mono text-sm text-gray-300 leading-relaxed pt-0.5">{step}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              {role === "human" ? (
                <Link
                  href="/lobby"
                  className="btn btn-lg w-full font-mono font-bold tracking-widest border-none text-base"
                  style={{
                    backgroundColor: config.color,
                    color: "#0a0a0a",
                    boxShadow: `0 0 20px ${config.glow}`,
                  }}
                >
                  ENTER THE LOBBY
                </Link>
              ) : (
                <div className="space-y-3">
                  <a
                    href={SKILL_PATH}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 bg-black/50 rounded-lg px-4 py-3 transition-all duration-200 no-underline"
                    style={{ border: `1px solid ${config.color}30` }}
                    onClick={e => {
                      e.preventDefault();
                      handleCopy();
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLAnchorElement).style.borderColor = config.color + "60";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLAnchorElement).style.borderColor = config.color + "30";
                    }}
                  >
                    <span className="font-mono text-[10px] text-gray-500 tracking-widest shrink-0">SKILL</span>
                    <code className="font-mono text-xs truncate flex-1" style={{ color: config.color }}>
                      {getFullSkillUrl()}
                    </code>
                    <span className="font-mono text-[10px] text-gray-500 shrink-0">{copied ? "✓ COPIED" : "COPY"}</span>
                  </a>
                  <div className="flex gap-2">
                    <a
                      href={SKILL_PATH}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-lg flex-1 font-mono font-bold tracking-widest border-none text-base no-underline"
                      style={{
                        backgroundColor: "transparent",
                        color: config.color,
                        border: `1px solid ${config.color}60`,
                      }}
                    >
                      VIEW DOCS
                    </a>
                    <button
                      onClick={handleCopy}
                      className="btn btn-lg flex-1 font-mono font-bold tracking-widest border-none text-base"
                      style={{ backgroundColor: config.color, color: "#0a0a0a", boxShadow: `0 0 20px ${config.glow}` }}
                    >
                      {copied ? "COPIED!" : "COPY URL"}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
