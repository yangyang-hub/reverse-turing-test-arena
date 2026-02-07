"use client";

import { Address } from "@scaffold-ui/components";
import { motion } from "framer-motion";
import { useGameStore } from "~~/services/store/gameStore";

export const PlayerIdentityCard = ({
  playerAddress,
  onClose,
  onVote,
}: {
  playerAddress: string;
  onClose: () => void;
  onVote: (addr: string) => void;
}) => {
  const players = useGameStore(s => s.players);
  const chatMessages = useGameStore(s => s.chatMessages);

  const player = players.find(p => p.addr.toLowerCase() === playerAddress.toLowerCase());

  if (!player) return null;

  const playerMessages = chatMessages.filter(
    m => m.sender.toLowerCase() === playerAddress.toLowerCase() && m.type === "chat",
  );

  // Humanity score gauge
  const scorePercent = Math.max(0, Math.min(100, player.humanityScore));
  const scoreColor = scorePercent > 60 ? "#22c55e" : scorePercent > 30 ? "#eab308" : "#ef4444";

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-80 bg-black/95 border border-cyan-500/30 rounded-lg p-5 cyber-border"
        initial={{ scale: 0.8, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.8, y: 20 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-cyan-400 font-mono text-xs tracking-wider mb-1">IDENTITY SCAN</div>
            <Address address={playerAddress as `0x${string}`} />
          </div>
          <span
            className={`px-2 py-0.5 text-xs font-mono rounded ${
              player.isAlive ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
            }`}
          >
            {player.isAlive ? "ALIVE" : "ELIMINATED"}
          </span>
        </div>

        {/* Humanity score gauge (SVG arc) */}
        <div className="flex items-center justify-center my-4">
          <svg width="120" height="70" viewBox="0 0 120 70">
            {/* Background arc */}
            <path d="M 10 65 A 50 50 0 0 1 110 65" fill="none" stroke="#333" strokeWidth="6" strokeLinecap="round" />
            {/* Foreground arc */}
            <path
              d="M 10 65 A 50 50 0 0 1 110 65"
              fill="none"
              stroke={scoreColor}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${scorePercent * 1.57} 157`}
            />
            <text
              x="60"
              y="55"
              textAnchor="middle"
              fill={scoreColor}
              fontFamily="monospace"
              fontSize="20"
              fontWeight="bold"
            >
              {player.humanityScore}
            </text>
            <text x="60" y="68" textAnchor="middle" fill="#666" fontFamily="monospace" fontSize="8">
              HUMANITY SCORE
            </text>
          </svg>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4 text-center font-mono text-xs">
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-500">MSGS</div>
            <div className="text-white">{playerMessages.length}</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-500">VOTES</div>
            <div className="text-white">{player.successfulVotes}</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-500">RANK</div>
            <div className="text-white">{player.eliminationRank || "--"}</div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {player.isAlive && (
            <button
              onClick={() => onVote(playerAddress)}
              className="flex-1 btn btn-sm btn-error btn-outline font-mono text-xs"
            >
              VOTE TO ELIMINATE
            </button>
          )}
          <button onClick={onClose} className="flex-1 btn btn-sm btn-ghost font-mono text-xs text-gray-500">
            CLOSE
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
