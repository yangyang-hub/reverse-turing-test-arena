"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useReadContracts } from "wagmi";
import type { PlayerInfo } from "~~/app/arena/page";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { getAliasName, getPlayerAlias } from "~~/utils/playerAlias";

export function VotePanel({
  roomId,
  nameMap,
  playerInfoMap,
  allPlayers,
  roomInfo,
  roundNum,
  blockNumber,
  pendingReveal,
}: {
  roomId: bigint;
  nameMap?: Record<string, string>;
  playerInfoMap: Record<string, PlayerInfo>;
  allPlayers: string[];
  roomInfo: any;
  roundNum: bigint | undefined;
  blockNumber: bigint | undefined;
  pendingReveal: boolean;
}) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [localVotedRound, setLocalVotedRound] = useState<bigint | null>(null);
  const { address: connectedAddress } = useAccount();

  const zeroAddr = "0x0000000000000000000000000000000000000000" as const;
  const { data: hasVotedOnChain } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "hasVotedInRound",
    args: [roomId, roundNum ?? 0n, connectedAddress ?? zeroAddr],
    query: { enabled: !!roundNum && roundNum > 0n && !!connectedAddress },
  });

  // Optimistic lock: treat as voted if chain confirms OR local vote was cast this round
  const hasVotedThisRound = Boolean(hasVotedOnChain) || (localVotedRound !== null && localVotedRound === roundNum);

  // Reset local lock when round advances
  useEffect(() => {
    if (roundNum !== undefined && localVotedRound !== null && roundNum !== localVotedRound) {
      setLocalVotedRound(null);
    }
  }, [roundNum, localVotedRound]);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "TuringArena",
  });

  const phase = roomInfo && typeof roomInfo === "object" && "phase" in roomInfo ? Number((roomInfo as any).phase) : 0;
  const isGameActive = phase === 1;

  // Round countdown — using parent's blockNumber prop instead of independent useBlockNumber
  const lastSettleBlock =
    roomInfo && typeof roomInfo === "object" && "lastSettleBlock" in roomInfo
      ? Number((roomInfo as any).lastSettleBlock)
      : 0;
  const currentInterval =
    roomInfo && typeof roomInfo === "object" && "currentInterval" in roomInfo
      ? Number((roomInfo as any).currentInterval)
      : 0;
  const currentBlock = blockNumber ? Number(blockNumber) : 0;
  const settleTargetBlock = lastSettleBlock + currentInterval;
  const blocksRemaining =
    isGameActive && currentBlock > 0 && lastSettleBlock > 0 ? Math.max(0, settleTargetBlock - currentBlock) : 0;
  const progress =
    isGameActive && currentInterval > 0 ? Math.min(1, Math.max(0, 1 - blocksRemaining / currentInterval)) : 0;
  const isUrgent = isGameActive && blocksRemaining > 0 && blocksRemaining <= Math.ceil(currentInterval * 0.25);
  const isExpired = isGameActive && currentBlock > 0 && currentBlock >= settleTargetBlock && lastSettleBlock > 0;

  const myInfo = connectedAddress ? playerInfoMap[connectedAddress.toLowerCase()] : undefined;
  const isMyPlayerAlive = myInfo?.isAlive ?? false;
  const isPlayerInGame = connectedAddress
    ? allPlayers.some(p => p.toLowerCase() === connectedAddress.toLowerCase())
    : false;
  // Channel exclusivity is enforced server-side — no need to check isAI here
  const canVote = isGameActive && isMyPlayerAlive && isPlayerInGame && !hasVotedThisRound && !pendingReveal;

  // Previous round vote results — batch-read voteTarget for all players
  const { data: arenaInfo } = useDeployedContractInfo({ contractName: "TuringArena" });
  const prevRound = roundNum !== undefined && roundNum > 0n ? roundNum - 1n : undefined;
  const voteContracts = useMemo(() => {
    if (!arenaInfo || prevRound === undefined || allPlayers.length === 0) return [];
    return allPlayers.map(addr => ({
      address: arenaInfo.address,
      abi: arenaInfo.abi,
      functionName: "voteTarget" as const,
      args: [roomId, prevRound, addr] as const,
    }));
  }, [arenaInfo, roomId, prevRound, allPlayers]);

  const { data: prevVoteResults } = useReadContracts({
    contracts: voteContracts,
    query: { enabled: voteContracts.length > 0 },
  });

  // Build voter→target map for previous round
  const prevRoundVotes = useMemo(() => {
    if (!prevVoteResults || prevRound === undefined) return null;
    const zeroAddr = "0x0000000000000000000000000000000000000000";
    const map: Record<string, string> = {};
    for (let i = 0; i < allPlayers.length && i < prevVoteResults.length; i++) {
      const target = prevVoteResults[i]?.result as string | undefined;
      if (target && target !== zeroAddr) {
        map[allPlayers[i].toLowerCase()] = target;
      }
    }
    return Object.keys(map).length > 0 ? map : null;
  }, [prevVoteResults, allPlayers, prevRound]);

  const handleVote = async () => {
    if (!selectedTarget || !canVote) return;

    try {
      await writeContractAsync({
        functionName: "castVote",
        args: [roomId, selectedTarget],
      });
      setLocalVotedRound(roundNum ?? null);
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

      {/* Round Countdown */}
      {isGameActive && currentInterval > 0 && lastSettleBlock > 0 && !pendingReveal && (
        <RoundCountdown
          blocksRemaining={blocksRemaining}
          progress={progress}
          isUrgent={isUrgent}
          isExpired={isExpired}
          currentInterval={currentInterval}
        />
      )}

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

      {pendingReveal && (
        <div className="mx-4 mt-3 px-3 py-2 border border-orange-500/50 bg-orange-950/20 rounded">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-orange-400 font-mono text-xs">
              GAME ENDING - Awaiting operator identity reveal...
            </span>
          </div>
          {currentBlock > 0 &&
            lastSettleBlock > 0 &&
            (() => {
              const REVEAL_TIMEOUT = 3600;
              const emergencyBlocks = Math.max(0, lastSettleBlock + REVEAL_TIMEOUT - currentBlock);
              const canEmergency = currentBlock > lastSettleBlock + REVEAL_TIMEOUT;
              return canEmergency ? (
                <button
                  className="mt-2 w-full px-3 py-1.5 border border-red-500/50 text-red-400 font-mono text-xs hover:bg-red-900/20 hover:border-red-500 transition-colors rounded animate-pulse"
                  onClick={async () => {
                    try {
                      await writeContractAsync({ functionName: "emergencyEnd", args: [roomId] });
                    } catch (e) {
                      console.error("Emergency end failed:", e);
                    }
                  }}
                  disabled={isMining}
                >
                  {isMining ? <span className="loading loading-spinner loading-xs" /> : "EMERGENCY END GAME"}
                </button>
              ) : (
                <p className="text-gray-500 font-mono text-[10px] mt-1">
                  Emergency end available in {emergencyBlocks} blocks if operator fails.
                </p>
              );
            })()}
        </div>
      )}

      {/* Previous Round Votes */}
      {isGameActive && prevRoundVotes && prevRound !== undefined && (
        <div className="mx-4 mt-3 px-3 py-2 border border-purple-700/40 bg-purple-950/10 rounded">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-purple-400 font-mono text-xs font-bold">ROUND {Number(prevRound)} VOTES</span>
          </div>
          <div className="space-y-0.5">
            {Object.entries(prevRoundVotes).map(([voter, target]) => {
              const voterAlias = getAliasName(allPlayers, voter, nameMap);
              const targetAlias = getAliasName(allPlayers, target, nameMap);
              const isSelfVote = voter.toLowerCase() === target.toLowerCase();
              return (
                <div key={voter} className="flex items-center gap-1 font-mono text-[11px]">
                  <span className="text-gray-400">{voterAlias}</span>
                  <span className="text-gray-600">{"\u2192"}</span>
                  <span className={isSelfVote ? "text-red-500 italic" : "text-red-400"}>{targetAlias}</span>
                  {isSelfVote && <span className="text-gray-600 text-[10px]">(AFK)</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Player List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {allPlayers.length === 0 && (
          <div className="text-gray-600 font-mono text-xs text-center py-8">No players found</div>
        )}

        {allPlayers.map(playerAddr => {
          const isMe = connectedAddress && playerAddr.toLowerCase() === connectedAddress.toLowerCase();
          const isSelected = selectedTarget === playerAddr;
          const pInfo = playerInfoMap[playerAddr.toLowerCase()];

          return (
            <VotePlayerCard
              key={playerAddr}
              playerAddr={playerAddr}
              isMe={!!isMe}
              isSelected={isSelected}
              canVote={canVote}
              onSelect={() => {
                if (!canVote || isMe) return;
                setSelectedTarget(isSelected ? null : playerAddr);
              }}
              playerAddresses={allPlayers}
              nameMap={nameMap}
              playerInfo={pInfo}
              prevVoteTarget={prevRoundVotes?.[playerAddr.toLowerCase()]}
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
            <>VOTE TO ELIMINATE {getAliasName(allPlayers, selectedTarget, nameMap)}</>
          ) : (
            "SELECT A TARGET"
          )}
        </button>
      </div>
    </div>
  );
}

function VotePlayerCard({
  playerAddr,
  isMe,
  isSelected,
  canVote,
  onSelect,
  playerAddresses,
  nameMap,
  playerInfo,
  prevVoteTarget,
}: {
  playerAddr: string;
  isMe: boolean;
  isSelected: boolean;
  canVote: boolean;
  onSelect: () => void;
  playerAddresses: string[];
  nameMap?: Record<string, string>;
  playerInfo?: PlayerInfo;
  prevVoteTarget?: string;
}) {
  const isAlive = playerInfo?.isAlive ?? true;
  const humanityScore = playerInfo?.humanityScore ?? 100;

  const scoreColor = humanityScore > 60 ? "bg-green-500" : humanityScore > 30 ? "bg-yellow-500" : "bg-red-500";
  const scoreTrackColor = humanityScore > 60 ? "bg-green-950" : humanityScore > 30 ? "bg-yellow-950" : "bg-red-950";

  const isClickable = canVote && !isMe && isAlive;

  const alias = getPlayerAlias(playerAddresses, playerAddr, nameMap);

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
          <div
            className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center font-mono text-[10px] font-bold text-black"
            style={{ backgroundColor: alias.color }}
          >
            {alias.initial}
          </div>
          <span
            className={`font-mono text-xs ${
              isMe ? "text-cyan-400 font-bold" : isAlive ? "text-gray-300" : "text-gray-600 line-through"
            }`}
            style={!isMe && isAlive ? { color: alias.color } : undefined}
          >
            {alias.name}
            {isMe && " (YOU)"}
          </span>
        </div>
        {!isAlive && <span className="text-red-600 font-mono text-xs">DEAD</span>}
      </div>

      {/* Previous round vote indicator */}
      {prevVoteTarget && (
        <div className="flex items-center gap-1 mb-1.5 ml-4">
          <span className="text-gray-600 font-mono text-[10px]">{"\u2192"}</span>
          <span className="text-purple-400 font-mono text-[10px]">
            voted {getAliasName(playerAddresses, prevVoteTarget, nameMap)}
          </span>
        </div>
      )}

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

function RoundCountdown({
  blocksRemaining,
  progress,
  isUrgent,
  isExpired,
  currentInterval,
}: {
  blocksRemaining: number;
  progress: number;
  isUrgent: boolean;
  isExpired: boolean;
  currentInterval: number;
}) {
  const barColor = isExpired
    ? "bg-orange-500"
    : isUrgent
      ? "bg-red-500"
      : progress > 0.5
        ? "bg-yellow-500"
        : "bg-cyan-500";
  const textColor = isExpired
    ? "text-orange-400"
    : isUrgent
      ? "text-red-400"
      : progress > 0.5
        ? "text-yellow-400"
        : "text-cyan-400";
  const glowColor = isExpired
    ? "shadow-[0_0_8px_rgba(249,115,22,0.4)]"
    : isUrgent
      ? "shadow-[0_0_8px_rgba(239,68,68,0.4)]"
      : "";

  return (
    <div
      className={`mx-4 mt-3 px-3 py-2.5 border rounded ${
        isExpired
          ? "border-orange-500/50 bg-orange-950/20"
          : isUrgent
            ? "border-red-500/50 bg-red-950/20"
            : "border-gray-700/50 bg-gray-900/50"
      } ${glowColor}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-gray-500 font-mono text-xs tracking-wider">ROUND DEADLINE</span>
        {isExpired ? (
          <span className="text-orange-400 font-mono text-sm font-bold animate-pulse">SETTLING...</span>
        ) : (
          <span className={`font-mono text-lg font-bold tabular-nums ${textColor} ${isUrgent ? "animate-pulse" : ""}`}>
            {blocksRemaining} <span className="text-xs font-normal">blocks</span>
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${barColor}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-gray-600 font-mono text-[10px]">
          {blocksRemaining} / {currentInterval}
        </span>
        <span className="text-gray-600 font-mono text-[10px]">{Math.round(progress * 100)}%</span>
      </div>
    </div>
  );
}
