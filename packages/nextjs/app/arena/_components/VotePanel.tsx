"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function VotePanel({ roomId }: { roomId: bigint }) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [hasVotedThisRound, setHasVotedThisRound] = useState(false);
  const { address: connectedAddress } = useAccount();

  const { data: allPlayers } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId],
  });

  const { data: roomInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
  });

  const { data: myPlayerInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getPlayerInfo",
    args: [roomId, connectedAddress] as const,
  });

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "TuringArena",
  });

  const phase = roomInfo && typeof roomInfo === "object" && "phase" in roomInfo ? Number((roomInfo as any).phase) : 0;
  const isGameActive = phase >= 1 && phase <= 3;
  const isMyPlayerAlive =
    myPlayerInfo && typeof myPlayerInfo === "object" && "isAlive" in myPlayerInfo
      ? Boolean((myPlayerInfo as any).isAlive)
      : false;
  const isPlayerInGame =
    connectedAddress && allPlayers
      ? (allPlayers as string[]).some(p => p.toLowerCase() === connectedAddress.toLowerCase())
      : false;
  const canVote = isGameActive && isMyPlayerAlive && isPlayerInGame && !hasVotedThisRound;

  const playerAddresses = (allPlayers as string[]) || [];

  const handleVote = async () => {
    if (!selectedTarget || !canVote) return;

    try {
      await writeContractAsync({
        functionName: "castVote",
        args: [roomId, selectedTarget],
      });
      setHasVotedThisRound(true);
      setSelectedTarget(null);
    } catch (err) {
      console.error("Vote failed:", err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-red-900/40 bg-black/60">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <h2 className="text-red-400 font-mono text-sm font-bold tracking-wider">ELIMINATION VOTE</h2>
        </div>
        <p className="text-gray-600 font-mono text-xs mt-1">Select a target and confirm your vote</p>
      </div>

      {/* Status Banner */}
      {!isGameActive && (
        <div className="mx-4 mt-3 px-3 py-2 border border-gray-700/50 bg-gray-900/50 rounded">
          <span className="text-gray-500 font-mono text-xs">
            {phase === 0 ? "Voting opens when the game begins" : "Game has ended"}
          </span>
        </div>
      )}

      {isGameActive && !isPlayerInGame && (
        <div className="mx-4 mt-3 px-3 py-2 border border-yellow-700/50 bg-yellow-950/20 rounded">
          <span className="text-yellow-500 font-mono text-xs">You are not a participant in this room</span>
        </div>
      )}

      {isGameActive && isPlayerInGame && !isMyPlayerAlive && (
        <div className="mx-4 mt-3 px-3 py-2 border border-red-700/50 bg-red-950/20 rounded">
          <span className="text-red-400 font-mono text-xs">You have been eliminated. Observe mode active.</span>
        </div>
      )}

      {hasVotedThisRound && (
        <div className="mx-4 mt-3 px-3 py-2 border border-green-700/50 bg-green-950/20 rounded">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-green-400 font-mono text-xs">VOTE CAST - Awaiting round settlement</span>
          </div>
        </div>
      )}

      {/* Player List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {playerAddresses.length === 0 && (
          <div className="text-gray-600 font-mono text-xs text-center py-8">No players found</div>
        )}

        {playerAddresses.map(playerAddr => {
          const isMe = connectedAddress && playerAddr.toLowerCase() === connectedAddress.toLowerCase();
          const isSelected = selectedTarget === playerAddr;

          return (
            <VotePlayerCard
              key={playerAddr}
              roomId={roomId}
              playerAddr={playerAddr}
              isMe={!!isMe}
              isSelected={isSelected}
              canVote={canVote}
              onSelect={() => {
                if (!canVote || isMe) return;
                setSelectedTarget(isSelected ? null : playerAddr);
              }}
            />
          );
        })}
      </div>

      {/* Vote Confirm Button */}
      <div className="px-4 py-3 border-t border-red-900/40 bg-black/60">
        <button
          onClick={handleVote}
          disabled={!selectedTarget || !canVote || isMining}
          className={`w-full py-3 font-mono text-sm font-bold tracking-widest transition-all duration-200 ${
            selectedTarget && canVote && !isMining
              ? "bg-red-900/40 border border-red-500/60 text-red-400 hover:bg-red-800/50 hover:border-red-400 cursor-pointer"
              : "bg-gray-900/40 border border-gray-700/30 text-gray-600 cursor-not-allowed"
          }`}
        >
          {isMining ? (
            <span className="animate-pulse">BROADCASTING VOTE...</span>
          ) : hasVotedThisRound ? (
            "ALREADY VOTED"
          ) : selectedTarget ? (
            <>VOTE TO ELIMINATE {truncateAddress(selectedTarget)}</>
          ) : (
            "SELECT A TARGET"
          )}
        </button>
      </div>
    </div>
  );
}

function VotePlayerCard({
  roomId,
  playerAddr,
  isMe,
  isSelected,
  canVote,
  onSelect,
}: {
  roomId: bigint;
  playerAddr: string;
  isMe: boolean;
  isSelected: boolean;
  canVote: boolean;
  onSelect: () => void;
}) {
  const { data: playerInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getPlayerInfo",
    args: [roomId, playerAddr],
  });

  const isAlive =
    playerInfo && typeof playerInfo === "object" && "isAlive" in playerInfo
      ? Boolean((playerInfo as any).isAlive)
      : true;
  const humanityScore =
    playerInfo && typeof playerInfo === "object" && "humanityScore" in playerInfo
      ? Number((playerInfo as any).humanityScore)
      : 100;

  const scoreColor = humanityScore > 60 ? "bg-green-500" : humanityScore > 30 ? "bg-yellow-500" : "bg-red-500";
  const scoreTrackColor = humanityScore > 60 ? "bg-green-950" : humanityScore > 30 ? "bg-yellow-950" : "bg-red-950";

  const isClickable = canVote && !isMe && isAlive;

  return (
    <motion.div
      onClick={isClickable ? onSelect : undefined}
      whileHover={isClickable ? { scale: 1.01 } : undefined}
      whileTap={isClickable ? { scale: 0.99 } : undefined}
      className={`relative p-3 rounded border transition-all duration-150 ${
        isSelected
          ? "border-red-500/80 bg-red-950/30 shadow-[0_0_12px_rgba(239,68,68,0.15)]"
          : isMe
            ? "border-cyan-800/40 bg-cyan-950/10"
            : !isAlive
              ? "border-gray-800/30 bg-gray-900/20 opacity-50"
              : isClickable
                ? "border-gray-700/30 bg-gray-900/30 hover:border-red-700/40 hover:bg-red-950/10 cursor-pointer"
                : "border-gray-800/30 bg-gray-900/20"
      }`}
    >
      {isSelected && (
        <div className="absolute top-1 right-1">
          <div className="w-4 h-4 rounded-full bg-red-500/20 border border-red-500/60 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isAlive ? "bg-green-400" : "bg-red-600"}`} />
          <span
            className={`font-mono text-xs ${
              isMe ? "text-cyan-400 font-bold" : isAlive ? "text-gray-300" : "text-gray-600 line-through"
            }`}
          >
            {truncateAddress(playerAddr)}
            {isMe && " (YOU)"}
          </span>
        </div>
        {!isAlive && <span className="text-red-600 font-mono text-xs">DEAD</span>}
      </div>

      {/* Humanity Score Bar */}
      <div className="flex items-center gap-2">
        <span className="text-gray-600 font-mono text-xs w-8 shrink-0">{humanityScore}</span>
        <div className={`flex-1 h-1.5 rounded-full ${scoreTrackColor}`}>
          <div
            className={`h-full rounded-full ${scoreColor} transition-all duration-500`}
            style={{ width: `${Math.max(0, Math.min(100, humanityScore))}%` }}
          />
        </div>
      </div>
    </motion.div>
  );
}
