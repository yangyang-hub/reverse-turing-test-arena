"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { useAccount } from "wagmi";
import { useReadContracts } from "wagmi";
import { PixelAvatar } from "~~/app/arena/_components/PixelAvatar";
import type { PlayerInfo } from "~~/app/arena/page";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
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
  hasVotedOnChain,
  onEmergencyEnd,
  onSettle,
}: {
  roomId: bigint;
  nameMap?: Record<string, string>;
  playerInfoMap: Record<string, PlayerInfo>;
  allPlayers: string[];
  roomInfo: any;
  roundNum: bigint | undefined;
  blockNumber: bigint | undefined;
  pendingReveal: boolean;
  hasVotedOnChain?: boolean;
  onEmergencyEnd?: () => void;
  onSettle?: () => Promise<void>;
}) {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [localVotedRound, setLocalVotedRound] = useState<bigint | null>(null);
  const { address: connectedAddress } = useAccount();

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
  const currentRound = roundNum !== undefined ? Number(roundNum) : 0;

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
    <div className="flex flex-col h-full arena-panel-bg arena-scanline">
      {/* Header */}
      <div
        className="px-3 py-1.5 border-b border-green-900/40 shrink-0"
        style={{ background: "linear-gradient(90deg, #121a12, #1a2619, #121a12)" }}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          <h2 className="arena-text-amber font-mono text-xs font-bold tracking-wider">ELIMINATION VOTE</h2>
          <span className="text-gray-600 font-mono text-[10px] ml-1">Select target & vote</span>
        </div>
      </div>

      {/* Scrollable area: image + countdown + player list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Fight Image with Round Number Overlay */}
        <div className="relative w-full" style={{ background: "#0a0f0a" }}>
          <Image
            src="/icon-fight.png"
            alt="Fight Arena"
            width={800}
            height={200}
            className="arena-fight-img w-full object-cover"
            priority
          />
          {/* 当前轮次数字，放在图片绿色圈内 */}
          <div
            className="absolute inset-0 flex justify-center"
            style={{ alignItems: "flex-start", paddingTop: "16%", paddingRight: "2%" }}
          >
            <span className="text-3xl font-bold font-mono text-white">{currentRound}</span>
          </div>
        </div>

        {/* Round Countdown */}
        {isGameActive && currentInterval > 0 && lastSettleBlock > 0 && !pendingReveal && (
          <RoundCountdown
            blocksRemaining={blocksRemaining}
            progress={progress}
            isUrgent={isUrgent}
            isExpired={isExpired}
            currentInterval={currentInterval}
            onSettle={onSettle}
          />
        )}

        {/* Status Banner */}
        {!isGameActive && (
          <div
            className="mx-4 mt-3 px-3 py-2 border border-green-900/40 rounded"
            style={{ background: "rgba(26, 38, 25, 0.4)" }}
          >
            <span className="text-gray-500 font-mono text-xs">
              {phase === 0 ? "Voting opens when the game begins" : "Game has ended"}
            </span>
          </div>
        )}

        {isGameActive && !isPlayerInGame && (
          <div
            className="mx-4 mt-3 px-3 py-2 border border-yellow-800/40 rounded"
            style={{ background: "rgba(50, 40, 15, 0.3)" }}
          >
            <span className="text-yellow-500 font-mono text-xs">You are not a participant in this room</span>
          </div>
        )}

        {isGameActive && isPlayerInGame && !isMyPlayerAlive && (
          <div
            className="mx-4 mt-3 px-3 py-2 border border-red-800/40 rounded"
            style={{ background: "rgba(50, 15, 15, 0.3)" }}
          >
            <span className="text-red-400 font-mono text-xs">You have been eliminated. Observe mode active.</span>
          </div>
        )}

        {hasVotedThisRound && (
          <div
            className="mx-4 mt-3 px-3 py-2 border border-green-700/50 rounded"
            style={{ background: "rgba(15, 50, 15, 0.3)" }}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-green-400 font-mono text-xs">VOTE CAST - Awaiting round settlement</span>
            </div>
          </div>
        )}

        {pendingReveal && (
          <div
            className="mx-4 mt-3 px-3 py-2 border border-orange-600/50 rounded"
            style={{ background: "rgba(50, 30, 10, 0.3)" }}
          >
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
                    className="mt-2 w-full px-3 py-1.5 border border-red-600/50 text-red-400 font-mono text-xs hover:bg-red-900/20 transition-colors rounded animate-pulse"
                    onClick={async () => {
                      try {
                        await writeContractAsync({ functionName: "emergencyEnd", args: [roomId] });
                        onEmergencyEnd?.();
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
          <div
            className="mx-3 mt-2 px-2.5 py-2 border border-amber-800/30 rounded"
            style={{ background: "rgba(40, 35, 15, 0.3)" }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="arena-text-amber font-mono text-[10px] font-bold">ROUND {Number(prevRound)} VOTES</span>
            </div>
            <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: "72px" }}>
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
        <div className="px-3 py-2 space-y-1.5">
          {allPlayers.length === 0 && (
            <div className="text-gray-600 font-mono text-xs text-center py-4">No players found</div>
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
      </div>
      {/* end scrollable area */}

      {/* Vote Confirm Button */}
      <div
        className="px-3 py-2 border-t border-green-900/40 shrink-0"
        style={{ background: "linear-gradient(90deg, #0c1210, #101810, #0c1210)" }}
      >
        <button
          onClick={handleVote}
          disabled={!selectedTarget || !canVote || isMining}
          className={`w-full py-2.5 font-mono text-xs font-bold tracking-widest transition-all duration-200 rounded ${
            selectedTarget && canVote && !isMining
              ? "cursor-pointer"
              : "border border-green-900/40 text-gray-600 cursor-not-allowed"
          }`}
          style={
            selectedTarget && canVote && !isMining
              ? {
                  background: "linear-gradient(180deg, #4a3a10, #2a1e08)",
                  border: "2px solid #c9a84c",
                  color: "#ffd700",
                  textShadow: "0 0 8px rgba(255, 215, 0, 0.5)",
                  boxShadow: "0 0 16px rgba(201, 168, 76, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                }
              : {
                  background: "rgba(15, 20, 15, 0.6)",
                }
          }
        >
          {isMining ? (
            <span className="animate-pulse">BROADCASTING VOTE...</span>
          ) : hasVotedThisRound ? (
            "ALREADY VOTED"
          ) : selectedTarget ? (
            <>VOTE TO ELIMINATE {getAliasName(allPlayers, selectedTarget, nameMap)}</>
          ) : (
            "CONFIRMATION OR SELECT"
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

  const isClickable = canVote && !isMe && isAlive;

  const alias = getPlayerAlias(playerAddresses, playerAddr, nameMap);

  return (
    <motion.div
      onClick={isClickable ? onSelect : undefined}
      whileHover={isClickable ? { scale: 1.01 } : undefined}
      whileTap={isClickable ? { scale: 0.99 } : undefined}
      className={`relative p-2 rounded transition-all duration-150 ${
        isSelected
          ? "arena-card-selected"
          : isMe
            ? "arena-card-military border-cyan-800/30"
            : !isAlive
              ? "arena-card-military opacity-50"
              : isClickable
                ? "arena-card-military cursor-pointer"
                : "arena-card-military opacity-60"
      }`}
      style={isMe && !isSelected ? { borderColor: "#1a4a5a" } : undefined}
    >
      {isSelected && (
        <div className="absolute top-1 right-1">
          <div className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500/60 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${isAlive ? "bg-green-400" : "bg-red-600"}`} />
          <PixelAvatar seed={playerAddr} color={alias.color} size={16} />
          <span
            className={`font-mono text-[11px] ${
              isMe ? "text-cyan-400 font-bold" : isAlive ? "text-gray-300" : "text-gray-600 line-through"
            }`}
            style={!isMe && isAlive ? { color: alias.color } : undefined}
          >
            {alias.name}
            {isMe && " (YOU)"}
          </span>
        </div>
        {!isAlive && (
          <span className="text-red-500 font-mono text-[10px] font-bold px-1 py-0.5 rounded border border-red-800/40 bg-red-900/20">
            DEAD
          </span>
        )}
      </div>

      {/* Previous round vote indicator */}
      {prevVoteTarget && (
        <div className="flex items-center gap-1 mb-1.5 ml-4">
          <span className="text-gray-600 font-mono text-[10px]">{"\u2192"}</span>
          <span className="arena-text-amber font-mono text-[10px]">
            voted {getAliasName(playerAddresses, prevVoteTarget, nameMap)}
          </span>
        </div>
      )}

      {/* Humanity Score Bar */}
      <div className="flex items-center gap-1.5">
        <span className="text-gray-500 font-mono text-[10px] w-6 shrink-0">{humanityScore}</span>
        <div className="flex-1 h-1 rounded-full arena-hp-track">
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
  onSettle,
}: {
  blocksRemaining: number;
  progress: number;
  isUrgent: boolean;
  isExpired: boolean;
  currentInterval: number;
  onSettle?: () => Promise<void>;
}) {
  const [isSettling, setIsSettling] = useState(false);

  const handleSettle = async () => {
    if (!onSettle || isSettling) return;
    setIsSettling(true);
    try {
      await onSettle();
    } finally {
      setIsSettling(false);
    }
  };

  const barColor = isExpired
    ? "bg-orange-500"
    : isUrgent
      ? "bg-red-500"
      : progress > 0.5
        ? "bg-yellow-500"
        : "bg-green-500";
  const textColor = isExpired
    ? "text-orange-400"
    : isUrgent
      ? "text-red-400"
      : progress > 0.5
        ? "text-yellow-400"
        : "text-green-400";
  const glowColor = isExpired
    ? "shadow-[0_0_8px_rgba(249,115,22,0.4)]"
    : isUrgent
      ? "shadow-[0_0_8px_rgba(239,68,68,0.4)]"
      : "";

  return (
    <div
      className={`mx-3 mt-2 px-2.5 py-2 border rounded ${
        isExpired ? "border-orange-600/50" : isUrgent ? "border-red-600/50" : "border-green-900/40"
      } ${glowColor}`}
      style={{
        background: isExpired ? "rgba(50, 30, 10, 0.4)" : isUrgent ? "rgba(50, 15, 15, 0.4)" : "rgba(26, 38, 25, 0.4)",
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="arena-text-amber font-mono text-[10px] tracking-wider font-bold">ROUND DEADLINE</span>
        {isExpired ? (
          <span className="text-orange-400 font-mono text-xs font-bold animate-pulse">READY</span>
        ) : (
          <span className={`font-mono text-sm font-bold tabular-nums ${textColor} ${isUrgent ? "animate-pulse" : ""}`}>
            {blocksRemaining} <span className="text-[10px] font-normal">blocks</span>
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full rounded-full arena-hp-track overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-[400ms] ease-linear ${barColor}`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-1">
        <span className="text-gray-600 font-mono text-[10px]">
          {blocksRemaining} / {currentInterval}
        </span>
        <span className="text-gray-600 font-mono text-[10px]">{Math.round(progress * 100)}%</span>
      </div>

      {/* Settle button when round expired */}
      {isExpired && onSettle && (
        <button
          onClick={handleSettle}
          disabled={isSettling}
          className="w-full mt-2 py-2 font-mono text-sm font-bold tracking-widest rounded transition-all duration-200"
          style={{
            background: "linear-gradient(180deg, #4a3a10, #2a1e08)",
            border: "2px solid #c9a84c",
            color: "#ffd700",
            textShadow: "0 0 8px rgba(255, 215, 0, 0.5)",
            boxShadow: "0 0 16px rgba(201, 168, 76, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
          }}
        >
          {isSettling ? (
            <span className="flex items-center justify-center gap-2">
              <span className="loading loading-spinner loading-xs" />
              SETTLING...
            </span>
          ) : (
            "SETTLE ROUND"
          )}
        </button>
      )}
    </div>
  );
}
