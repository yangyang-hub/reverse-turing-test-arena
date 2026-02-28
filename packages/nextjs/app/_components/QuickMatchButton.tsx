"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { AnimatePresence, motion } from "framer-motion";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useChatAuth } from "~~/hooks/scaffold-eth/useChatAuth";
import { notification } from "~~/utils/scaffold-eth";

/* ─── Types ─── */

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
  onRoomJoined?: () => void;
};

/* ─── Cyber-green input styles ─── */
const fieldInputStyle: React.CSSProperties = {
  border: "1px solid rgba(57,211,83,0.3)",
  borderLeft: "2px solid rgba(57,211,83,0.5)",
  borderRadius: 2,
  padding: "10px 14px",
  color: "#39d353",
  fontSize: 14,
  background: "rgba(0,10,5,0.7)",
  boxShadow: "inset 0 0 12px rgba(57,211,83,0.05)",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s, border-left-width 0.15s",
};

const fieldInputFocusStyle: React.CSSProperties = {
  borderColor: "rgba(0,229,255,0.7)",
  borderLeft: "3px solid rgba(0,229,255,0.9)",
  boxShadow: "inset 0 0 14px rgba(0,229,255,0.1), 0 0 8px rgba(0,229,255,0.15)",
};

const QuickMatchButton = ({ roomIds, onNoMatch, autoMatch, onRoomJoined }: QuickMatchButtonProps) => {
  const { address: connectedAddress } = useAccount();
  const config = useConfig();
  const [isSearching, setIsSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<MatchFilters>(DEFAULT_FILTERS);
  const [playerName, setPlayerName] = useState<string>("");
  const [validationError, setValidationError] = useState<string>("");
  const autoMatchTriggered = useRef(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const { data: paymentTokenAddr } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "paymentToken",
    watch: false,
  });

  const { data: arenaContractInfo } = useDeployedContractInfo({ contractName: "TuringArena" });

  const { writeContractAsync: writeArena } = useScaffoldWriteContract({
    contractName: "TuringArena",
    disableSimulate: true,
  });

  const { writeContractAsync: writeErc20 } = useWriteContract();

  const { getJoinAuth } = useChatAuth();
  const panelRef = useRef<HTMLDivElement>(null);

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
      const msg = "Please connect your wallet first.";
      setValidationError(msg);
      notification.error(msg);
      setShowFilters(true);
      return;
    }
    if (!arenaContractInfo?.address || !arenaContractInfo.abi) {
      const msg = "Contract data not loaded yet. Please wait.";
      setValidationError(msg);
      notification.error(msg);
      setShowFilters(true);
      return;
    }
    if (!paymentTokenAddr) {
      notification.error("Payment token not loaded yet. Please wait and try again.");
      return;
    }

    const trimmedName = (name ?? playerName).trim();
    if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 20) {
      const msg = "Enter a name (1-20 characters) before matching.";
      setValidationError(msg);
      notification.error(msg);
      setShowFilters(true);
      return;
    }

    setValidationError("");
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

        // Slot enforcement is handled by chat-server operator (commit-reveal hides identity)
        // Frontend just checks if room has space
        if (playerCount >= maxPlayers) continue;

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
          onRoomJoined?.();
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
      onNoMatch();
    } catch (e: any) {
      notification.remove(notifId);
      const msg = e?.shortMessage || e?.message || "Unknown error";
      notification.error(`Quick match failed: ${msg}`);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (autoMatch && !autoMatchTriggered.current && connectedAddress && roomIds.length > 0 && arenaContractInfo) {
      autoMatchTriggered.current = true;
      setShowFilters(true);
    }
  }, [autoMatch, connectedAddress, roomIds, arenaContractInfo]);

  const openModal = () => {
    if (!connectedAddress) {
      const msg = "Please connect your wallet first.";
      setValidationError(msg);
      notification.error(msg);
    }
    setValidationError("");
    setShowFilters(true);
  };

  /* ─── Chamfered clip-path for panels ─── */
  const panelClip = "polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px))";
  const btnClip = "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))";

  return (
    <>
      {/* ── Trigger button ── */}
      <button
        style={{
          clipPath: btnClip,
          background: "rgba(57,211,83,0.08)",
          border: "1px solid rgba(57,211,83,0.4)",
          boxShadow: "0 0 12px rgba(57,211,83,0.15)",
          color: "#39d353",
          padding: "6px 14px",
          fontSize: 14,
          fontFamily: "monospace",
          fontWeight: 700,
          letterSpacing: "0.1em",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        onClick={openModal}
        disabled={isSearching}
        title={!connectedAddress ? "Connect wallet to quick match" : "Find and join a waiting room"}
        onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(57,211,83,0.15)";
          e.currentTarget.style.borderColor = "rgba(57,211,83,0.7)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "rgba(57,211,83,0.08)";
          e.currentTarget.style.borderColor = "rgba(57,211,83,0.4)";
        }}
      >
        {isSearching ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="loading loading-spinner loading-xs" />
            MATCHING...
          </span>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Image src="/icon-bolt.png" alt="bolt" width={18} height={18} className="inline-block" />
            QUICK MATCH
          </span>
        )}
      </button>

      {/* ── Modal ── */}
      <AnimatePresence>
        {showFilters && (
          <>
            {/* Keyframe animations */}
            <style>{`
              @keyframes cyber-match-glow {
                0%, 100% { box-shadow: 0 0 8px rgba(57,211,83,0.3), inset 0 0 8px rgba(57,211,83,0.05); }
                50% { box-shadow: 0 0 20px rgba(57,211,83,0.5), inset 0 0 12px rgba(57,211,83,0.1); }
              }
              @keyframes cyber-scan-sweep {
                0% { transform: skew(-20deg) translateX(-200%); }
                100% { transform: skew(-20deg) translateX(200%); }
              }
            `}</style>

            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-[100]"
              style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFilters(false)}
            />

            {/* Dialog */}
            <motion.div
              className="fixed inset-0 z-[101] flex items-center justify-center p-4"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
            >
              {/* Outer wrapper — gradient "border" via 1px padding + clip-path */}
              <div
                ref={panelRef}
                className="relative w-full max-w-lg"
                style={{
                  clipPath: panelClip,
                  background: "linear-gradient(135deg, rgba(57,211,83,0.6), rgba(0,229,255,0.4))",
                  padding: 1,
                  filter: "drop-shadow(0 0 20px rgba(57,211,83,0.2)) drop-shadow(0 0 40px rgba(0,0,0,0.6))",
                }}
                onClick={e => e.stopPropagation()}
              >
                {/* Inner panel — dark bg + scanline + grid */}
                <div
                  style={{
                    clipPath: panelClip,
                    background: "rgba(4,6,14,0.98)",
                    backgroundImage: [
                      "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(57,211,83,0.015) 2px, rgba(57,211,83,0.015) 4px)",
                      "linear-gradient(0deg, transparent 39px, rgba(57,211,83,0.04) 39px, rgba(57,211,83,0.04) 40px, transparent 40px)",
                      "linear-gradient(90deg, transparent 39px, rgba(57,211,83,0.04) 39px, rgba(57,211,83,0.04) 40px, transparent 40px)",
                    ].join(", "),
                    backgroundSize: "100% 4px, 100% 40px, 40px 100%",
                  }}
                >
                  {/* ── Title bar ── */}
                  <div
                    className="relative flex items-center gap-3 px-6 py-4"
                    style={{
                      borderBottom: "1px solid rgba(57,211,83,0.2)",
                      background: "linear-gradient(180deg, rgba(57,211,83,0.06) 0%, transparent 100%)",
                    }}
                  >
                    <Image
                      src="/icon-radar.png"
                      alt="radar"
                      width={52}
                      height={52}
                      style={{ filter: "drop-shadow(0 0 6px rgba(57,211,83,0.6))" }}
                    />
                    <h2
                      className="neon-text font-mono text-base font-black tracking-[0.2em] uppercase"
                      style={{ color: "#39d353", textShadow: "0 0 10px rgba(57,211,83,0.4)" }}
                    >
                      MATCH FILTERS
                    </h2>

                    {/* Right side — cyan scan decoration */}
                    <div className="ml-auto flex items-center gap-1.5">
                      <div
                        style={{
                          width: 40,
                          height: 2,
                          background: "linear-gradient(90deg, transparent, rgba(0,229,255,0.7))",
                        }}
                      />
                      <div style={{ width: 12, height: 2, background: "rgba(0,229,255,0.5)" }} />
                      <div
                        style={{
                          width: 5,
                          height: 5,
                          transform: "rotate(45deg)",
                          background: "#00e5ff",
                          boxShadow: "0 0 6px #00e5ff",
                        }}
                      />
                    </div>

                    {/* Close button — chamfered micro-button */}
                    <button
                      className="ml-4 flex h-9 w-9 items-center justify-center font-mono text-lg transition-colors"
                      style={{
                        clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))",
                        background: "rgba(57,211,83,0.08)",
                        border: "1px solid rgba(57,211,83,0.2)",
                        color: "rgba(57,211,83,0.5)",
                        cursor: "pointer",
                      }}
                      onClick={() => setShowFilters(false)}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "rgba(255,60,60,0.15)";
                        e.currentTarget.style.borderColor = "rgba(255,60,60,0.5)";
                        e.currentTarget.style.color = "rgba(255,100,100,0.9)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "rgba(57,211,83,0.08)";
                        e.currentTarget.style.borderColor = "rgba(57,211,83,0.2)";
                        e.currentTarget.style.color = "rgba(57,211,83,0.5)";
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* ── Fields ── */}
                  <div className="relative space-y-6 px-8 py-7">
                    {/* YOUR NAME */}
                    <div>
                      <label className="mb-2.5 flex items-center gap-3">
                        <div style={{ width: 2, height: 16, background: "#39d353", borderRadius: 1 }} />
                        <Image src="/icon-agent.png" alt="agent" width={36} height={36} />
                        <span
                          className="font-mono text-sm font-bold tracking-[0.15em] uppercase"
                          style={{ color: "rgba(0,229,255,0.8)" }}
                        >
                          YOUR NAME
                        </span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          maxLength={20}
                          value={playerName}
                          onChange={e => setPlayerName(e.target.value)}
                          onFocus={() => setFocusedField("name")}
                          onBlur={() => setFocusedField(null)}
                          placeholder="Enter arena name"
                          className="w-full font-mono placeholder:opacity-30"
                          style={{
                            ...fieldInputStyle,
                            ...(focusedField === "name" ? fieldInputFocusStyle : {}),
                            fontSize: 15,
                            padding: "12px 50px 12px 16px",
                            letterSpacing: "0.05em",
                          }}
                        />
                        {/* Character counter inside input */}
                        <span
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold"
                          style={{
                            color:
                              playerName.trim().length > 20
                                ? "rgba(255,80,80,0.8)"
                                : playerName.trim().length > 0
                                  ? "rgba(57,211,83,0.6)"
                                  : "rgba(57,211,83,0.25)",
                          }}
                        >
                          {playerName.trim().length}/20
                        </span>
                      </div>
                    </div>

                    {/* Divider */}
                    <div
                      style={{
                        height: 1,
                        background: "linear-gradient(90deg, transparent, rgba(57,211,83,0.15), transparent)",
                      }}
                    />

                    {/* PLAYERS */}
                    <div>
                      <label className="mb-2.5 flex items-center gap-3">
                        <div style={{ width: 2, height: 16, background: "#39d353", borderRadius: 1 }} />
                        <Image
                          src="/icon-group.png"
                          alt="group"
                          width={36}
                          height={36}
                          style={{ filter: "drop-shadow(0 0 4px rgba(57,211,83,0.5))" }}
                        />
                        <span
                          className="font-mono text-sm font-bold tracking-[0.15em] uppercase"
                          style={{ color: "rgba(0,229,255,0.8)" }}
                        >
                          PLAYERS
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: "rgba(57,211,83,0.4)" }}>
                          (room size)
                        </span>
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min={3}
                          max={50}
                          value={filters.minPlayers}
                          onChange={e =>
                            setFilters(f => ({ ...f, minPlayers: Math.max(3, Number(e.target.value) || 3) }))
                          }
                          onFocus={() => setFocusedField("minP")}
                          onBlur={() => setFocusedField(null)}
                          className="w-full text-center font-mono"
                          style={{
                            ...fieldInputStyle,
                            ...(focusedField === "minP" ? fieldInputFocusStyle : {}),
                          }}
                        />
                        {/* TO separator */}
                        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                          <div style={{ width: 16, height: 1, background: "rgba(57,211,83,0.3)" }} />
                          <span className="font-mono text-[10px] font-bold" style={{ color: "rgba(57,211,83,0.5)" }}>
                            TO
                          </span>
                          <div style={{ width: 16, height: 1, background: "rgba(57,211,83,0.3)" }} />
                        </div>
                        <input
                          type="number"
                          min={3}
                          max={50}
                          value={filters.maxPlayers}
                          onChange={e =>
                            setFilters(f => ({ ...f, maxPlayers: Math.min(50, Number(e.target.value) || 50) }))
                          }
                          onFocus={() => setFocusedField("maxP")}
                          onBlur={() => setFocusedField(null)}
                          className="w-full text-center font-mono"
                          style={{
                            ...fieldInputStyle,
                            ...(focusedField === "maxP" ? fieldInputFocusStyle : {}),
                          }}
                        />
                      </div>
                    </div>

                    {/* Divider */}
                    <div
                      style={{
                        height: 1,
                        background: "linear-gradient(90deg, transparent, rgba(57,211,83,0.15), transparent)",
                      }}
                    />

                    {/* ENTRY FEE */}
                    <div>
                      <label className="mb-2.5 flex items-center gap-3">
                        <div style={{ width: 2, height: 16, background: "#39d353", borderRadius: 1 }} />
                        <Image
                          src="/icon-coin.png"
                          alt="coin"
                          width={36}
                          height={36}
                          style={{ filter: "drop-shadow(0 0 4px rgba(57,211,83,0.5))" }}
                        />
                        <span
                          className="font-mono text-sm font-bold tracking-[0.15em] uppercase"
                          style={{ color: "rgba(0,229,255,0.8)" }}
                        >
                          ENTRY FEE
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: "rgba(57,211,83,0.4)" }}>
                          (USDC)
                        </span>
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={filters.minFee}
                          onChange={e => setFilters(f => ({ ...f, minFee: Math.max(1, Number(e.target.value) || 1) }))}
                          onFocus={() => setFocusedField("minF")}
                          onBlur={() => setFocusedField(null)}
                          className="w-full text-center font-mono"
                          style={{
                            ...fieldInputStyle,
                            ...(focusedField === "minF" ? fieldInputFocusStyle : {}),
                          }}
                        />
                        {/* TO separator */}
                        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                          <div style={{ width: 16, height: 1, background: "rgba(57,211,83,0.3)" }} />
                          <span className="font-mono text-[10px] font-bold" style={{ color: "rgba(57,211,83,0.5)" }}>
                            TO
                          </span>
                          <div style={{ width: 16, height: 1, background: "rgba(57,211,83,0.3)" }} />
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={filters.maxFee}
                          onChange={e =>
                            setFilters(f => ({ ...f, maxFee: Math.min(100, Number(e.target.value) || 100) }))
                          }
                          onFocus={() => setFocusedField("maxF")}
                          onBlur={() => setFocusedField(null)}
                          className="w-full text-center font-mono"
                          style={{
                            ...fieldInputStyle,
                            ...(focusedField === "maxF" ? fieldInputFocusStyle : {}),
                          }}
                        />
                      </div>
                    </div>

                    {/* Validation error */}
                    {validationError && (
                      <div
                        style={{
                          borderLeft: "3px solid rgba(255,60,60,0.8)",
                          background: "rgba(255,0,64,0.08)",
                          padding: "10px 14px",
                          borderRadius: 2,
                        }}
                      >
                        <p className="font-mono text-xs tracking-wider" style={{ color: "rgba(255,120,120,0.9)" }}>
                          ▲ {validationError}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-6 flex gap-4 pt-2">
                      {/* RESET — ghost chamfered */}
                      <button
                        className="flex-1 font-mono text-xs font-bold tracking-[0.15em] uppercase transition-all duration-200"
                        style={{
                          clipPath: btnClip,
                          border: "1px solid rgba(57,211,83,0.25)",
                          padding: "14px 0",
                          color: "rgba(57,211,83,0.45)",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                        onClick={() => setFilters(DEFAULT_FILTERS)}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = "rgba(57,211,83,0.06)";
                          e.currentTarget.style.borderColor = "rgba(57,211,83,0.5)";
                          e.currentTarget.style.color = "rgba(57,211,83,0.8)";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderColor = "rgba(57,211,83,0.25)";
                          e.currentTarget.style.color = "rgba(57,211,83,0.45)";
                        }}
                      >
                        RESET
                      </button>

                      {/* MATCH — pulsing green with sweep */}
                      <button
                        className="relative flex-[2] overflow-hidden px-7 py-3 transition-all duration-300 active:scale-95"
                        style={{
                          clipPath: btnClip,
                          background: "linear-gradient(135deg, rgba(57,211,83,0.15) 0%, rgba(57,211,83,0.08) 100%)",
                          color: "#39d353",
                          border: "1px solid rgba(57,211,83,0.5)",
                          animation: "cyber-match-glow 1.8s ease-in-out infinite",
                          cursor: "pointer",
                        }}
                        onClick={() => runMatch(filters)}
                        disabled={isSearching}
                      >
                        {/* Shimmer sweep */}
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "linear-gradient(90deg, transparent, rgba(57,211,83,0.12), transparent)",
                            animation: "cyber-scan-sweep 2.5s ease-in-out infinite",
                          }}
                        />
                        <span className="relative z-10 flex items-center justify-center gap-3 font-mono text-sm font-black tracking-[0.15em] uppercase">
                          {isSearching ? (
                            <>
                              <span className="loading loading-spinner loading-xs" />
                              MATCHING...
                            </>
                          ) : (
                            <>
                              <Image
                                src="/icon-bolt.png"
                                alt="bolt"
                                width={25}
                                height={25}
                                style={{ filter: "drop-shadow(0 0 4px rgba(57,211,83,0.6))" }}
                              />
                              MATCH
                            </>
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default QuickMatchButton;
