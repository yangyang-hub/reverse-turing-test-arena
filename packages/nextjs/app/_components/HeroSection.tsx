"use client";

import Image from "next/image";
import { RoleSelector } from "./RoleSelector";
import { motion } from "framer-motion";

const TITLE_LINES = ["REVERSE TURING TEST ARENA"];
const SUBTITLE = "Spot the AI. Chat. Vote. Survive.";
const SUBTITLE_WORDS = SUBTITLE.split(" ");

// ── ANIMATION VARIANTS ──
// Subtitle animation orchestrator: staggers children (words) one after another
const wordContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12 },
  },
};

// Standard word animation: pops up with a spring effect
const wordItem = {
  hidden: { opacity: 0, y: 18, scale: 0.85 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 400, damping: 18 },
  },
};

// Instant variant: used for elements that should appear immediately on page load
const wordInstant = {
  hidden: { opacity: 1, y: 0, scale: 1 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

const HeroSection = () => {
  return (
    <section className="relative w-full overflow-hidden min-h-[80vh] flex flex-col">
      {/* 1. Main background image */}
      <Image
        src="/homeBg.png"
        alt=""
        fill
        className="object-cover object-center pointer-events-none"
        style={{ zIndex: 0 }}
        priority
      />

      {/* 2. Global darkening overlay for readability */}
      <div className="pointer-events-none absolute inset-0 z-[1]" style={{ background: "rgba(8,6,18,0.72)" }} />

      {/* 3. Cyberpunk grid patterns (horizontal/vertical lines) */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-[2] h-72"
        style={{
          backgroundImage: [
            "repeating-linear-gradient(90deg, rgba(255,0,220,0.13) 0px, transparent 1px, transparent 70px, rgba(255,0,220,0.13) 71px)",
            "repeating-linear-gradient(0deg, rgba(255,0,220,0.09) 0px, transparent 1px, transparent 45px, rgba(255,0,220,0.09) 46px)",
          ].join(", "),
          maskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.8) 50%, black 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.8) 50%, black 100%)",
        }}
      />

      {/* 4. Bottom glow ambient light */}
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 z-[2] w-full h-80"
        style={{ background: "radial-gradient(ellipse 70% 50% at 50% 100%, rgba(255,0,200,0.18) 0%, transparent 70%)" }}
      />

      {/* ── CONTENT ── */}
      <div className="relative z-10 flex-1 mx-auto w-full max-w-[1440px] px-6 md:px-12 pt-10 pb-16 flex flex-col">
        {/* ── TITLE + SUBTITLE (top, left-aligned) ── */}
        <h1
          className="font-black leading-none whitespace-nowrap text-4xl sm:text-5xl md:text-6xl lg:text-7xl"
          style={{
            fontFamily: "'Courier New', 'Consolas', monospace",
            color: "#d946ef",
            textShadow: [
              "0 0 8px rgba(217,70,239,0.5)",
              "0 0 20px rgba(217,70,239,0.25)",
              "0 0 45px rgba(189,0,255,0.15)",
            ].join(", "),
            letterSpacing: "0.07em",
          }}
        >
          {TITLE_LINES[0]}
        </h1>
        <motion.p
          className="mt-4 font-mono text-sm sm:text-base md:text-lg tracking-[0.25em] flex flex-wrap gap-x-[0.5em]"
          style={{ color: "#00e5ff", textShadow: "0 0 12px rgba(0,229,255,0.7)" }}
          variants={wordContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.span variants={wordInstant}>&bull;</motion.span>
          {SUBTITLE_WORDS.map((word, i) => (
            <motion.span key={i} variants={i === 0 ? wordInstant : wordItem} className="inline-block">
              {word}
            </motion.span>
          ))}
        </motion.p>

        {/* ── LEFT-RIGHT layout: Card + Image ── */}
        <div className="mt-8 flex flex-col lg:flex-row items-start gap-8 lg:gap-12 flex-1">
          {/* LEFT: Role selector card */}
          <div className="w-full max-w-[420px] shrink-0">
            <RoleSelector />
          </div>

          {/* RIGHT: Image (normal flow, responsive) */}
          <div className="flex-1 min-w-0 flex items-start justify-end">
            <Image
              src="/home.png"
              alt="Reverse Turing Test Arena"
              width={960}
              height={768}
              className="hero-glow-img w-full max-w-[860px]"
              style={{ display: "block", height: "auto" }}
              priority
            />
          </div>
        </div>
      </div>

      {/* ── BOTTOM FADE: smooth transition to next section ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[3] h-40 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, transparent 0%, #080612 100%)" }}
      />

      {/* ── DECORATIVE SCAN LINE ── */}
      <div className="absolute bottom-0 left-0 right-0 z-[4] flex items-center justify-center pointer-events-none">
        <div className="w-full max-w-[1440px] px-6 md:px-12">
          <div
            style={{
              height: "1px",
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,0,220,0.5) 20%, rgba(0,229,255,0.4) 50%, rgba(255,0,220,0.5) 80%, transparent 100%)",
              boxShadow: "0 0 8px rgba(255,0,220,0.3), 0 0 20px rgba(0,229,255,0.15)",
            }}
          />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
