"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useChatAuth } from "~~/hooks/scaffold-eth/useChatAuth";
import { notification } from "~~/utils/scaffold-eth";

const TIER_CONFIG = [
  {
    name: "QUICK",
    label: "Bronze",
    color: "#CD7F32",
    borderClass: "tier-quick-border",
    textClass: "tier-quick",
    fee: 10_000_000n, // 10 USDC
  },
  {
    name: "STANDARD",
    label: "Silver",
    color: "#C0C0C0",
    borderClass: "tier-standard-border",
    textClass: "tier-standard",
    fee: 50_000_000n, // 50 USDC
  },
  {
    name: "EPIC",
    label: "Gold",
    color: "#FFD700",
    borderClass: "tier-epic-border",
    textClass: "tier-epic",
    fee: 100_000_000n, // 100 USDC
  },
] as const;

const PHASE_LABELS = ["Waiting", "Active", "Ended"] as const;
const PHASE_CLASSES = ["text-secondary", "phase-active", "phase-ended"] as const;

type RoomCardProps = {
  roomId: bigint;
  roomInfo?: any; // Optional: from parent batch fetch
  activeRoomId?: number; // From playerActiveRoom — overrides getAllPlayers for hasJoined check
  onRoomChange?: () => void;
};

const RoomCard = ({ roomId, roomInfo: propRoomInfo, activeRoomId, onRoomChange }: RoomCardProps) => {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const [isLeaving, setIsLeaving] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const { deleteIdentity } = useChatAuth();

  // Only fetch if not provided via prop (fallback for standalone usage)
  const { data: fetchedRoomInfo, isLoading } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
    query: { enabled: !propRoomInfo },
    watch: false,
  });
  const roomInfo = propRoomInfo || fetchedRoomInfo;

  const { data: players } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId],
    watch: false, // Player list rarely changes; refreshed on page visit
  });

  const { writeContractAsync: writeArena, isMining } = useScaffoldWriteContract({
    contractName: "TuringArena",
    disableSimulate: true,
  });

  // Reward info for ended games
  const { data: rewardInfo } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRewardInfo",
    args: [roomId, connectedAddress ?? "0x0000000000000000000000000000000000000000"] as const,
    watch: false, // Only relevant for ended games; doesn't change frequently
  });

  if (isLoading || !roomInfo) {
    return (
      <div className="glass-panel cyber-border flex h-52 animate-pulse items-center justify-center rounded-lg p-4">
        <span className="terminal-text text-sm">LOADING ROOM #{roomId.toString()}...</span>
      </div>
    );
  }

  // roomInfo is a struct returned as an array/object depending on ABI
  // Destructure the room data - adapt to actual struct shape
  const room = roomInfo as unknown as {
    tier: number;
    phase: number;
    entryFee: bigint;
    prizePool: bigint;
    maxPlayers: number;
    playerCount: number;
    creator: string;
  };

  const tierIndex = Number(room.tier);
  const phaseIndex = Number(room.phase);
  const tier = TIER_CONFIG[tierIndex] ?? TIER_CONFIG[0];
  const phaseLabel = PHASE_LABELS[phaseIndex] ?? "Unknown";
  const phaseClass = PHASE_CLASSES[phaseIndex] ?? "text-base-content";
  const playerCount = Number(room.playerCount ?? (players ? players.length : 0));
  const maxPlayers = Number(room.maxPlayers ?? 8);
  const entryFee = room.entryFee ?? tier.fee;
  const prizePool = room.prizePool ?? 0n;
  const isWaiting = phaseIndex === 0;
  const isActive = phaseIndex === 1;
  const isEnded = phaseIndex === 2;
  const hasJoined =
    (activeRoomId !== undefined && activeRoomId === Number(roomId)) ||
    (connectedAddress && players
      ? (players as string[]).some(p => p.toLowerCase() === connectedAddress.toLowerCase())
      : false);

  const handleEnter = () => {
    router.push(`/arena?roomId=${roomId.toString()}`);
  };

  const handleLeave = async () => {
    setIsLeaving(true);
    try {
      await writeArena({ functionName: "leaveRoom", args: [roomId] });
      deleteIdentity(Number(roomId)).catch(() => {});
      onRoomChange?.();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown error";
      if (!msg.includes("User rejected")) {
        notification.error(`Failed to leave: ${msg}`);
      }
      console.error("Failed to leave room:", e);
    } finally {
      setIsLeaving(false);
    }
  };

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      await writeArena({ functionName: "claimReward", args: [roomId] });
      notification.success("Reward claimed!");
      onRoomChange?.();
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown error";
      if (!msg.includes("User rejected")) {
        notification.error(`Claim failed: ${msg}`);
      }
      console.error("Failed to claim reward:", e);
    } finally {
      setIsClaiming(false);
    }
  };

  const myRewardAmount = rewardInfo ? BigInt((rewardInfo as any)[0] ?? 0) : 0n;
  const myRewardClaimed = rewardInfo ? Boolean((rewardInfo as any)[1]) : false;
  const hasClaimableReward = myRewardAmount > 0n && !myRewardClaimed;

  const isBusy = isMining || isLeaving || isClaiming;

  return (
    <div
      className={`glass-panel relative flex flex-col gap-3 rounded-lg border p-5 transition-all duration-300 hover:scale-[1.02] ${tier.borderClass}`}
      style={{ animation: isWaiting ? "room-glow 3s ease-in-out infinite" : undefined }}
    >
      {/* Header row: Room ID + Tier Badge */}
      <div className="flex items-center justify-between">
        <span className="text-xs tracking-widest text-base-content/50">ROOM #{roomId.toString()}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold tracking-wider ${tier.textClass}`}
          style={{
            border: `1px solid ${tier.color}`,
            backgroundColor: `${tier.color}15`,
          }}
        >
          {tier.name}
        </span>
      </div>

      {/* Phase status */}
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${isEnded ? "bg-gray-500" : "animate-pulse"}`}
          style={{ backgroundColor: isEnded ? undefined : tier.color }}
        />
        <span className={`text-sm font-semibold tracking-wider ${phaseClass}`}>{phaseLabel}</span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <span className="text-xs text-base-content/40">PLAYERS</span>
          <span className="font-mono text-sm text-base-content">
            {playerCount}/{maxPlayers}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-base-content/40">ENTRY FEE</span>
          <span className="font-mono text-sm text-secondary">{formatUnits(entryFee, 6)} USDC</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-base-content/40">PRIZE POOL</span>
          <span className={`font-mono text-sm font-bold ${tier.textClass}`}>{formatUnits(prizePool, 6)} USDC</span>
        </div>
      </div>

      {/* Player bar visualization */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${maxPlayers > 0 ? (playerCount / maxPlayers) * 100 : 0}%`,
            backgroundColor: tier.color,
            boxShadow: `0 0 8px ${tier.color}`,
          }}
        />
      </div>

      {/* Action button */}
      <div className="mt-1">
        {isWaiting && hasJoined && (
          <div className="flex gap-2">
            <span
              className="btn btn-sm btn-disabled flex-1 font-mono text-xs tracking-widest animate-pulse"
              style={{ color: tier.color }}
            >
              WAITING {playerCount}/{maxPlayers}
            </span>
            <button
              className="btn btn-sm btn-outline border-red-500/50 text-red-400 hover:bg-red-900/20 hover:border-red-500 font-bold tracking-widest"
              onClick={handleLeave}
              disabled={isBusy}
            >
              {isBusy ? <span className="loading loading-spinner loading-xs" /> : "LEAVE"}
            </button>
          </div>
        )}
        {isWaiting && !hasJoined && (
          <div
            className="flex items-center justify-center gap-2 rounded border border-dashed px-3 py-2"
            style={{ borderColor: `${tier.color}40`, backgroundColor: `${tier.color}05` }}
          >
            <span className="text-[10px] font-mono tracking-widest text-base-content/40">USE QUICK MATCH TO JOIN</span>
          </div>
        )}
        {isActive && (
          <button
            className="btn btn-sm btn-outline btn-secondary w-full font-bold tracking-widest"
            onClick={handleEnter}
          >
            {hasJoined ? "ENTER ARENA" : "SPECTATE"}
          </button>
        )}
        {isEnded && (
          <div className="flex gap-2">
            {hasClaimableReward && (
              <button
                className="btn btn-sm flex-1 border border-yellow-500/50 bg-yellow-900/20 font-bold tracking-widest text-yellow-400 hover:bg-yellow-900/40 hover:border-yellow-500"
                onClick={handleClaim}
                disabled={isBusy}
              >
                {isClaiming ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  `CLAIM ${formatUnits(myRewardAmount, 6)}`
                )}
              </button>
            )}
            {myRewardClaimed && myRewardAmount > 0n && (
              <span className="btn btn-sm btn-disabled flex-1 font-bold tracking-widest text-green-400/60">
                CLAIMED
              </span>
            )}
            <button className="btn btn-sm btn-outline btn-secondary font-bold tracking-widest" onClick={handleEnter}>
              VIEW
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoomCard;
