"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const SEQUENCE = ["3", "2", "1", "FIGHT"];

export const GameCountdown = ({ onComplete }: { onComplete: () => void }) => {
  const [current, setCurrent] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (current >= SEQUENCE.length) {
      const timeout = setTimeout(() => {
        setIsVisible(false);
        onComplete();
      }, 600);
      return () => clearTimeout(timeout);
    }

    const timeout = setTimeout(() => {
      setCurrent(prev => prev + 1);
    }, 800);

    return () => clearTimeout(timeout);
  }, [current, onComplete]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <AnimatePresence mode="wait">
        {current < SEQUENCE.length && (
          <motion.div
            key={SEQUENCE[current]}
            className={`relative font-mono font-black text-center ${
              current === 3 ? "text-red-500 text-8xl md:text-[12rem]" : "text-cyan-400 text-9xl md:text-[16rem]"
            }`}
            initial={{ scale: 3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, duration: 0.4 }}
          >
            {SEQUENCE[current]}

            {/* Shockwave ripple */}
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-cyan-400/30"
              initial={{ scale: 0.8, opacity: 1 }}
              animate={{ scale: 3, opacity: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
