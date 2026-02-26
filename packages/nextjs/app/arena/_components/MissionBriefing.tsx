"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

type MissionBriefingProps = {
  totalPlayers: number;
  isAI: boolean;
  onDismiss: () => void;
};

export const MissionBriefing = ({ totalPlayers, isAI, onDismiss }: MissionBriefingProps) => {
  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        onClick={onDismiss}
      >
        <motion.div
          className="relative max-w-lg w-full mx-4 border border-cyan-500/40 bg-gray-950/95 rounded-lg overflow-hidden cursor-default"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Scanline overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,255,255,0.1)_2px,rgba(0,255,255,0.1)_4px)]" />

          <div className="relative p-8 flex flex-col items-center gap-6">
            {/* Title */}
            <div className="text-center">
              <div className="text-cyan-500/60 font-mono text-xs tracking-[0.3em] mb-1">
                {"/// INCOMING TRANSMISSION ///"}
              </div>
              <h1 className="text-cyan-400 font-mono text-2xl font-bold tracking-wider">MISSION BRIEFING</h1>
            </div>

            {/* Divider */}
            <div className="w-full h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />

            {/* Player count (no team breakdown) */}
            <div className="flex items-center gap-3 font-mono text-lg">
              <span className="text-cyan-400 font-bold">
                {totalPlayers} PLAYER{totalPlayers !== 1 ? "S" : ""}
              </span>
              <span className="text-gray-600 text-sm">in the arena</span>
            </div>

            {/* Divider */}
            <div className="w-full h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

            {/* Mission based on identity */}
            <div
              className={`w-full p-4 rounded border ${
                isAI ? "border-red-500/30 bg-red-950/20" : "border-green-500/30 bg-green-950/20"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2 h-2 rounded-full ${isAI ? "bg-red-400" : "bg-green-400"} animate-pulse`} />
                <span className={`font-mono text-xs tracking-wider ${isAI ? "text-red-400" : "text-green-400"}`}>
                  YOUR IDENTITY: {isAI ? "AI AGENT" : "HUMAN"}
                </span>
              </div>

              {isAI ? (
                <div className="space-y-2 font-mono text-sm">
                  <p className="text-red-300/90">
                    You are an <span className="text-red-400 font-bold">AI Agent</span>.
                  </p>
                  <p className="text-gray-400">Mimic human behavior. Avoid detection. Survive to the end.</p>
                  <p className="text-gray-500 text-xs mt-2">Eliminate all humans to win.</p>
                </div>
              ) : (
                <div className="space-y-2 font-mono text-sm">
                  <p className="text-green-300/90">
                    You are a <span className="text-green-400 font-bold">Human</span>.
                  </p>
                  <p className="text-gray-400">Find the AIs and vote to eliminate them. Stay alive.</p>
                  <p className="text-gray-500 text-xs mt-2">Eliminate all AIs to win.</p>
                </div>
              )}
            </div>

            {/* Enter button */}
            <button
              onClick={onDismiss}
              className={`px-8 py-2 border font-mono text-sm tracking-wider transition-colors ${
                isAI
                  ? "border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500"
                  : "border-green-500/50 text-green-400 hover:bg-green-500/10 hover:border-green-500"
              }`}
            >
              ENTER ARENA
            </button>

            {/* Auto-dismiss hint */}
            <div className="text-gray-600 font-mono text-xs">click anywhere or wait to auto-dismiss</div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
