"use client";

import { useEffect, useRef, useState } from "react";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useChatAuth } from "~~/hooks/scaffold-eth/useChatAuth";
import { notification } from "~~/utils/scaffold-eth";

type MatchFilters = {
  minPlayers: number;
  maxPlayers: number;
  minFee: number;
  maxFee: number;
};

const DEFAULT_FILTERS: MatchFilters = {
  minPlayers: 3,
  maxPlayers: 50,
  minFee: 1,
  maxFee: 100,
};

type QuickMatchButtonProps = {
  roomIds: bigint[];
  onNoMatch: () => void;
  autoMatch?: boolean;
};

const QuickMatchButton = ({ roomIds, onNoMatch, autoMatch }: QuickMatchButtonProps) => {
  const { address: connectedAddress } = useAccount();
  const config = useConfig();
  const [isSearching, setIsSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<MatchFilters>(DEFAULT_FILTERS);
  const [playerName, setPlayerName] = useState<string>("");
  const panelRef = useRef<HTMLDivElement>(null);
  const autoMatchTriggered = useRef(false);

  const { data: paymentTokenAddr } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "paymentToken",
  });

  const { data: arenaContractInfo } = useDeployedContractInfo({ contractName: "TuringArena" });

  const { writeContractAsync: writeArena } = useScaffoldWriteContract({
    contractName: "TuringArena",
    disableSimulate: true,
  });

  const { writeContractAsync: writeErc20 } = useWriteContract();

  const { getJoinAuth } = useChatAuth();

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    if (showFilters) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFilters]);

  const runMatch = async (matchFilters: MatchFilters, name?: string) => {
    if (!connectedAddress) {
      notification.error("Please connect your wallet first.");
      return;
    }
    if (!arenaContractInfo?.address || !arenaContractInfo.abi) {
      notification.error("Contract data not loaded yet. Please wait and try again.");
      return;
    }
    if (!paymentTokenAddr) {
      notification.error("Payment token not loaded yet. Please wait and try again.");
      return;
    }

    const trimmedName = (name ?? playerName).trim();
    if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 20) {
      notification.error("Enter a name (1-20 characters) before matching.");
      setShowFilters(true);
      return;
    }

    setIsSearching(true);
    setShowFilters(false);
    const notifId = notification.loading("Scanning rooms...");

    const feeMinWei = BigInt(Math.round(matchFilters.minFee * 1e6));
    const feeMaxWei = BigInt(Math.round(matchFilters.maxFee * 1e6));

    try {
      for (let i = roomIds.length - 1; i >= 0; i--) {
        const roomId = roomIds[i];

        const roomInfo = (await readContract(config, {
          address: arenaContractInfo.address,
          abi: arenaContractInfo.abi,
          functionName: "getRoomInfo",
          args: [roomId],
        })) as unknown as {
          phase: bigint;
          maxPlayers: bigint;
          playerCount: bigint;
          entryFee: bigint;
        };

        const phase = Number(roomInfo.phase);
        const playerCount = Number(roomInfo.playerCount);
        const maxPlayers = Number(roomInfo.maxPlayers);
        const entryFee = roomInfo.entryFee;

        if (phase !== 0 || playerCount >= maxPlayers) continue;
        if (maxPlayers < matchFilters.minPlayers || maxPlayers > matchFilters.maxPlayers) continue;
        if (entryFee < feeMinWei || entryFee > feeMaxWei) continue;

        // Found a joinable room — contract enforces single-room limit via playerActiveRoom
        notification.remove(notifId);
        const joinNotifId = notification.loading(
          `Joining Room #${roomId.toString()} (${maxPlayers}p / ${formatUnits(entryFee, 6)} USDC)...`,
        );

        try {
          // Get commitment + operator signature from chat-server
          const { commitment, operatorSig } = await getJoinAuth(Number(roomId), false, maxPlayers);

          const approveHash = await writeErc20({
            address: paymentTokenAddr as `0x${string}`,
            abi: erc20Abi,
            functionName: "approve",
            args: [arenaContractInfo.address, entryFee],
          });
          await waitForTransactionReceipt(config, { hash: approveHash });

          await writeArena({
            functionName: "joinRoom",
            args: [roomId, commitment, operatorSig, trimmedName],
          });

          notification.remove(joinNotifId);
          notification.success(
            `Joined Room #${roomId.toString()}! Waiting for players (${playerCount + 1}/${maxPlayers})...`,
          );
        } catch (e: any) {
          notification.remove(joinNotifId);
          const msg = e?.shortMessage || e?.message || "Unknown error";
          if (!msg.includes("User rejected")) {
            notification.error(`Failed to join: ${msg}`);
          }
        }
        return;
      }

      notification.remove(notifId);
      notification.info("No rooms match your filters. Create one!");
      onNoMatch();
    } catch (e: any) {
      notification.remove(notifId);
      const msg = e?.shortMessage || e?.message || "Unknown error";
      notification.error(`Quick match failed: ${msg}`);
    } finally {
      setIsSearching(false);
    }
  };

  // Auto-match on mount (from landing page ?quickMatch=true)
  // If no name set, just open the filter panel so user can enter name
  useEffect(() => {
    if (autoMatch && !autoMatchTriggered.current && connectedAddress && roomIds.length > 0 && arenaContractInfo) {
      autoMatchTriggered.current = true;
      setShowFilters(true);
    }
  }, [autoMatch, connectedAddress, roomIds, arenaContractInfo]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        className="btn btn-sm border-primary/60 bg-primary/10 font-mono text-xs font-bold tracking-widest text-primary hover:bg-primary/20 hover:border-primary"
        style={{ boxShadow: "0 0 12px rgba(0, 255, 65, 0.15)" }}
        onClick={() => {
          if (!connectedAddress) {
            notification.error("Please connect your wallet first.");
            return;
          }
          setShowFilters(prev => !prev);
        }}
        disabled={isSearching}
        title={!connectedAddress ? "Connect wallet to quick match" : "Find and join a waiting room"}
      >
        {isSearching ? (
          <>
            <span className="loading loading-spinner loading-xs" />
            MATCHING...
          </>
        ) : (
          <>
            <span className="text-sm">&#x26A1;</span>
            QUICK MATCH
          </>
        )}
      </button>

      {/* Filter dropdown */}
      {showFilters && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-primary/30 bg-base-100 p-4 shadow-xl"
          style={{ boxShadow: "0 4px 24px rgba(0, 255, 65, 0.1)" }}
        >
          <p className="mb-3 font-mono text-xs font-bold tracking-widest text-primary">MATCH FILTERS</p>

          {/* Player name */}
          <div className="mb-3">
            <label className="mb-1 block font-mono text-[10px] tracking-widest text-base-content/50">YOUR NAME</label>
            <input
              type="text"
              maxLength={20}
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Enter arena name (1-20)"
              className={`input input-bordered input-xs w-full bg-base-300/50 font-mono text-xs ${
                playerName.length > 0 && (playerName.trim().length < 1 || playerName.trim().length > 20)
                  ? "input-error"
                  : ""
              }`}
            />
            <span className="text-[10px] text-base-content/30">{playerName.trim().length}/20</span>
          </div>

          {/* Player range */}
          <div className="mb-3">
            <label className="mb-1 block font-mono text-[10px] tracking-widest text-base-content/50">
              PLAYERS (room size)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={3}
                max={50}
                value={filters.minPlayers}
                onChange={e => setFilters(f => ({ ...f, minPlayers: Math.max(3, Number(e.target.value) || 3) }))}
                className="input input-bordered input-xs w-full bg-base-300/50 font-mono text-xs"
              />
              <span className="text-base-content/30">-</span>
              <input
                type="number"
                min={3}
                max={50}
                value={filters.maxPlayers}
                onChange={e => setFilters(f => ({ ...f, maxPlayers: Math.min(50, Number(e.target.value) || 50) }))}
                className="input input-bordered input-xs w-full bg-base-300/50 font-mono text-xs"
              />
            </div>
          </div>

          {/* Fee range */}
          <div className="mb-4">
            <label className="mb-1 block font-mono text-[10px] tracking-widest text-base-content/50">
              ENTRY FEE (USDC)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100}
                value={filters.minFee}
                onChange={e => setFilters(f => ({ ...f, minFee: Math.max(1, Number(e.target.value) || 1) }))}
                className="input input-bordered input-xs w-full bg-base-300/50 font-mono text-xs"
              />
              <span className="text-base-content/30">-</span>
              <input
                type="number"
                min={1}
                max={100}
                value={filters.maxFee}
                onChange={e => setFilters(f => ({ ...f, maxFee: Math.min(100, Number(e.target.value) || 100) }))}
                className="input input-bordered input-xs w-full bg-base-300/50 font-mono text-xs"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              className="btn btn-ghost btn-xs flex-1 font-mono text-[10px] tracking-widest text-base-content/40"
              onClick={() => setFilters(DEFAULT_FILTERS)}
            >
              RESET
            </button>
            <button
              className="btn btn-xs flex-1 border-primary/60 bg-primary/20 font-mono text-[10px] font-bold tracking-widest text-primary hover:bg-primary/30"
              onClick={() => runMatch(filters)}
              disabled={isSearching}
            >
              <span>&#x26A1;</span> MATCH
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickMatchButton;
