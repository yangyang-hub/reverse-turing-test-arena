"use client";

import { useGameStore } from "~~/services/store/gameStore";

const PHASE_COLORS: Record<string, string> = {
  Waiting: "text-gray-400 bg-gray-400/10",
  Phase1: "text-green-400 bg-green-400/10",
  Phase2: "text-yellow-400 bg-yellow-400/10",
  Phase3: "text-red-400 bg-red-400/10",
  Ended: "text-gray-500 bg-gray-500/10",
};

const PHASE_LABELS: Record<string, string> = {
  Waiting: "WAITING",
  Phase1: "PHASE 1",
  Phase2: "PHASE 2",
  Phase3: "PHASE 3",
  Ended: "ENDED",
};

export const GameHUD = ({ roomId }: { roomId: bigint }) => {
  const gamePhase = useGameStore(s => s.gamePhase);
  const players = useGameStore(s => s.players);
  const myPlayer = useGameStore(s => s.myPlayer);
  const currentRound = useGameStore(s => s.currentRound);

  const phaseStyle = PHASE_COLORS[gamePhase] || PHASE_COLORS.Waiting;
  const phaseLabel = PHASE_LABELS[gamePhase] || "UNKNOWN";
  const aliveCount = players.filter(p => p.isAlive).length;
  const totalPlayers = players.length;

  return (
    <div className="sticky top-0 z-50 bg-black/90 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between font-mono text-xs">
        {/* Left: Room + Phase */}
        <div className="flex items-center gap-3">
          <span className="text-gray-500">ROOM #{roomId.toString()}</span>
          <span className={`px-2 py-0.5 rounded ${phaseStyle}`}>{phaseLabel}</span>
        </div>

        {/* Center: Alive count */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-green-400">{aliveCount}</span>
            <span className="text-gray-600">/ {totalPlayers} ALIVE</span>
          </div>

          {/* Humanity score (if current user in game) */}
          {myPlayer && (
            <div className="flex items-center gap-1.5">
              <span className={myPlayer.humanityScore < 30 ? "text-red-400 animate-pulse" : "text-cyan-400"}>
                &#x2665; {myPlayer.humanityScore}
              </span>
              <span className="text-gray-600">HP</span>
            </div>
          )}
        </div>

        {/* Right: Round */}
        <div className="text-gray-500">
          RND <span className="text-white">{currentRound}</span>
        </div>
      </div>
    </div>
  );
};
