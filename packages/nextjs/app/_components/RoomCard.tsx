"use client";

import { useRouter } from "next/navigation";
import { waitForTransactionReceipt } from "@wagmi/core";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

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

const PHASE_LABELS = ["Waiting", "Phase 1", "Phase 2", "Phase 3", "Ended"] as const;
const PHASE_CLASSES = ["text-secondary", "phase-1", "phase-2", "phase-3", "phase-ended"] as const;

type RoomCardProps = {
  roomId: bigint;
};

const RoomCard = ({ roomId }: RoomCardProps) => {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();

  const { data: roomInfo, isLoading } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getRoomInfo",
    args: [roomId],
  });

  const { data: players } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId],
  });

  // Read paymentToken address from TuringArena
  const { data: paymentTokenAddr } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "paymentToken",
  });

  // Get arena contract address for approve target
  const { data: arenaContractInfo } = useDeployedContractInfo({ contractName: "TuringArena" });

  const { writeContractAsync: writeArena, isMining } = useScaffoldWriteContract({
    contractName: "TuringArena",
  });

  const config = useConfig();

  // For ERC20 approve call
  const { writeContractAsync: writeErc20, isPending: isApproving } = useWriteContract();

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
  const playerCount = players ? players.length : Number(room.playerCount ?? 0);
  const maxPlayers = Number(room.maxPlayers ?? 8);
  const entryFee = room.entryFee ?? tier.fee;
  const prizePool = room.prizePool ?? 0n;
  const isWaiting = phaseIndex === 0;
  const isActive = phaseIndex >= 1 && phaseIndex <= 3;
  const isEnded = phaseIndex === 4;
  const hasJoined =
    connectedAddress && players
      ? (players as string[]).some(p => p.toLowerCase() === connectedAddress.toLowerCase())
      : false;

  const handleJoin = async () => {
    if (!paymentTokenAddr || !arenaContractInfo?.address) return;
    try {
      // Step 1: Approve USDC spend
      const approveHash = await writeErc20({
        address: paymentTokenAddr as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [arenaContractInfo.address, entryFee],
      });
      // Wait for approve tx to be mined before joining
      await waitForTransactionReceipt(config, { hash: approveHash });
      // Step 2: Join room (no value needed for ERC20)
      await writeArena({
        functionName: "joinRoom",
        args: [roomId],
      });
      router.push(`/arena?roomId=${roomId.toString()}`);
    } catch (e) {
      console.error("Failed to join room:", e);
    }
  };

  const handleEnter = () => {
    router.push(`/arena?roomId=${roomId.toString()}`);
  };

  const isBusy = isMining || isApproving;

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
        <div className="col-span-2 flex flex-col">
          <span className="text-xs text-base-content/40">PRIZE POOL</span>
          <span className={`font-mono text-lg font-bold ${tier.textClass}`}>{formatUnits(prizePool, 6)} USDC</span>
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
          <button className="btn btn-sm btn-secondary w-full font-bold tracking-widest" onClick={handleEnter}>
            ENTER ARENA
          </button>
        )}
        {isWaiting && !hasJoined && (
          <button
            className={`btn btn-sm w-full border font-bold tracking-widest ${tier.textClass}`}
            style={{
              borderColor: tier.color,
              backgroundColor: `${tier.color}10`,
            }}
            onClick={handleJoin}
            disabled={isBusy}
          >
            {isBusy ? <span className="loading loading-spinner loading-xs" /> : "JOIN"}
          </button>
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
          <button className="btn btn-sm btn-disabled w-full font-bold tracking-widest text-base-content/30" disabled>
            ENDED
          </button>
        )}
      </div>
    </div>
  );
};

export default RoomCard;
