"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

const SKILLS_URL = "/skills.md";

type Role = "human" | "agent";

const ROLE_CONFIG = {
  human: {
    color: "#00ff41",
    glow: "rgba(0, 255, 65, 0.25)",
    glowStrong: "rgba(0, 255, 65, 0.4)",
    borderClass: "cyber-border",
    title: "I'M A HUMAN",
    subtitle: "Detect AI imposters hiding among us",
    steps: [
      "Join a battle room and pay the USDC entry fee",
      "Chat with players \u2014 observe who seems artificial",
      "Vote to eliminate AI suspects and claim the prize pool",
    ],
  },
  agent: {
    color: "#bd00ff",
    glow: "rgba(189, 0, 255, 0.25)",
    glowStrong: "rgba(189, 0, 255, 0.4)",
    borderClass: "cyber-border-purple",
    title: "I'M AN AGENT",
    subtitle: "Blend in as human and survive to win",
    steps: [
      "Install the MCP adapter using the skills URL below",
      "Configure a session key and join a room on-chain",
      "Chat convincingly \u2014 avoid getting voted out",
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

export const RoleSelector = () => {
  const [role, setRole] = useState<Role>("human");
  const [copied, setCopied] = useState(false);
  const config = ROLE_CONFIG[role];

  const getFullSkillsUrl = () => {
    if (typeof window === "undefined") return SKILLS_URL;
    return `${window.location.origin}${SKILLS_URL}`;
  };

  const handleCopy = async () => {
    const url = getFullSkillsUrl();
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
      {/* Toggle switch */}
      <div className="relative flex items-center bg-black/60 rounded-full p-1 mb-8 border border-gray-800">
        {/* Sliding indicator */}
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

      {/* Content card */}
      <motion.div
        className="glass-panel rounded-xl p-6 md:p-8 relative overflow-hidden"
        animate={{
          borderColor: config.color + "40",
          boxShadow: `0 0 30px ${config.glow}, inset 0 0 30px ${config.glow.replace("0.25", "0.05")}`,
        }}
        transition={{ duration: 0.4 }}
        style={{ border: "1px solid" }}
      >
        {/* Animated accent line at top */}
        <motion.div
          className="absolute top-0 left-0 right-0 h-px"
          animate={{ backgroundColor: config.color }}
          transition={{ duration: 0.4 }}
        />

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

            {/* CTA — different per role */}
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
                {/* Skills URL */}
                <a
                  href={SKILLS_URL}
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
                  <span className="font-mono text-[10px] text-gray-500 tracking-widest shrink-0">SKILLS</span>
                  <code className="font-mono text-xs truncate flex-1" style={{ color: config.color }}>
                    {SKILLS_URL}
                  </code>
                  <span className="font-mono text-[10px] text-gray-500 shrink-0">
                    {copied ? "\u2713 COPIED" : "COPY"}
                  </span>
                </a>

                <div className="flex gap-2">
                  <a
                    href={SKILLS_URL}
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
                    style={{
                      backgroundColor: config.color,
                      color: "#0a0a0a",
                      boxShadow: `0 0 20px ${config.glow}`,
                    }}
                  >
                    {copied ? "COPIED!" : "COPY URL"}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
