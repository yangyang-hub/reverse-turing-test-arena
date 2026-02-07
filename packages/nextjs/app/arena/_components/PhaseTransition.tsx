"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Phase = "PHASE_1" | "PHASE_2" | "PHASE_3";

const PHASE_CONFIG: Record<Phase, { label: string; subtitle: string; color: string; bg: string }> = {
  PHASE_1: {
    label: "PHASE I",
    subtitle: "OBSERVATION",
    color: "text-green-400",
    bg: "from-green-900/30 to-transparent",
  },
  PHASE_2: {
    label: "PHASE II",
    subtitle: "SUSPICION",
    color: "text-yellow-400",
    bg: "from-yellow-900/30 to-transparent",
  },
  PHASE_3: {
    label: "PHASE III",
    subtitle: "ELIMINATION",
    color: "text-red-400",
    bg: "from-red-900/30 to-transparent",
  },
};

export const PhaseTransition = ({ phase, onComplete }: { phase: Phase; onComplete: () => void }) => {
  const [isVisible, setIsVisible] = useState(true);
  const config = PHASE_CONFIG[phase];

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsVisible(false);
      onComplete();
    }, 2500);
    return () => clearTimeout(timeout);
  }, [onComplete]);

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Background gradient */}
        <div className={`absolute inset-0 bg-gradient-to-b ${config.bg}`} />

        {/* Horizontal scanline wipe */}
        <motion.div
          className="absolute left-0 right-0 h-[2px] bg-white/80"
          initial={{ top: "-2px" }}
          animate={{ top: "100%" }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
        />

        {/* Phase name */}
        <div className="relative text-center">
          <motion.div
            className={`text-6xl md:text-8xl font-mono font-black ${config.color} tracking-widest`}
            initial={{ x: -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.3 }}
          >
            {config.label}
          </motion.div>

          <motion.div
            className="text-xl md:text-2xl font-mono text-gray-400 tracking-[0.5em] mt-2"
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.6 }}
          >
            {config.subtitle}
          </motion.div>
        </div>

        {/* Top+bottom scanlines */}
        <div className="absolute top-0 left-0 right-0 h-16 scanline-overlay opacity-50" />
        <div className="absolute bottom-0 left-0 right-0 h-16 scanline-overlay opacity-50" />
      </motion.div>
    </AnimatePresence>
  );
};
