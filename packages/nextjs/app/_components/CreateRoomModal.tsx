"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { readContract, waitForTransactionReceipt } from "@wagmi/core";
import { AnimatePresence, motion } from "framer-motion";
import { erc20Abi } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useChatAuth } from "~~/hooks/scaffold-eth/useChatAuth";
import { notification } from "~~/utils/scaffold-eth";

const TIERS = [
  {
    id: 0,
    name: "Quick",
    label: "Bronze",
    defaultFee: 10,
    defaultMaxPlayers: 10,
    color: "#CD7F32",
    borderClass: "tier-quick-border",
    textClass: "tier-quick",
    description: "Fast rounds, smaller stakes",
    duration: "~10 min",
  },
  {
    id: 1,
    name: "Standard",
    label: "Silver",
    defaultFee: 10,
    defaultMaxPlayers: 20,
    color: "#C0C0C0",
    borderClass: "tier-standard-border",
    textClass: "tier-standard",
    description: "Balanced gameplay experience",
    duration: "~20 min",
  },
  {
    id: 2,
    name: "Epic",
    label: "Gold",
    defaultFee: 10,
    defaultMaxPlayers: 50,
    color: "#FFD700",
    borderClass: "tier-epic-border",
    textClass: "tier-epic",
    description: "High stakes, extended battle",
    duration: "~30 min",
  },
] as const;

type CreateRoomModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onRoomChange?: () => void;
};

/* ─── Cyber-green input styles ─── */
const fieldInputStyle: React.CSSProperties = {
  border: "1px solid rgba(57,211,83,0.15)",
  borderLeft: "2px solid rgba(57,211,83,0.3)",
  borderRadius: 2,
  padding: "12px 16px",
  color: "rgba(255,255,255,0.85)",
  fontSize: 15,
  background: "rgba(0,10,5,0.7)",
  boxShadow: "inset 0 0 12px rgba(57,211,83,0.05)",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
  fontFamily: "monospace",
  width: "100%",
};

const panelClip = "polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px))";
const btnClip = "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))";

const CreateRoomModal = ({ isOpen, onClose, onRoomChange }: CreateRoomModalProps) => {
  const router = useRouter();
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [customMaxPlayers, setCustomMaxPlayers] = useState<string>(String(TIERS[1].defaultMaxPlayers));
  const [customEntryFee, setCustomEntryFee] = useState<string>(String(TIERS[1].defaultFee));
  const [playerName, setPlayerName] = useState<string>("");
  const [isCreating, setIsCreating] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const { getJoinAuth, updateRoomId } = useChatAuth();

  const { address: connectedAddress } = useAccount();

  const { writeContractAsync } = useScaffoldWriteContract({
    contractName: "TuringArena",
    disableSimulate: true,
  });

  const config = useConfig();

  const { data: paymentTokenAddr } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "paymentToken",
    watch: false,
  });

  const { data: arenaContractInfo } = useDeployedContractInfo({ contractName: "TuringArena" });
  const { writeContractAsync: writeErc20 } = useWriteContract();

  if (dialogRef.current) {
    if (isOpen && !dialogRef.current.open) {
      dialogRef.current.showModal();
    } else if (!isOpen && dialogRef.current.open) {
      dialogRef.current.close();
    }
  }

  const parsedMaxPlayers = parseInt(customMaxPlayers) || 0;
  const parsedEntryFee = parseFloat(customEntryFee) || 0;
  const isValidPlayers = parsedMaxPlayers >= 3 && parsedMaxPlayers <= 50;
  const isValidFee = parsedEntryFee >= 1 && parsedEntryFee <= 100;
  const isValidName = playerName.trim().length >= 1 && playerName.trim().length <= 20;
  const isFormValid = isValidPlayers && isValidFee && isValidName;

  const handleTierSelect = (tierId: number) => {
    setSelectedTier(tierId);
    setCustomMaxPlayers(String(TIERS[tierId].defaultMaxPlayers));
    setCustomEntryFee(String(TIERS[tierId].defaultFee));
  };

  const handleCreate = async () => {
    if (!isFormValid) return;
    if (!paymentTokenAddr || !arenaContractInfo?.address) {
      notification.error("Contract data not loaded yet. Please wait and try again.");
      return;
    }
    setIsCreating(true);
    try {
      const feeInUnits = BigInt(Math.round(parsedEntryFee * 1e6));
      const { commitment, operatorSig } = await getJoinAuth(0, false, parsedMaxPlayers);

      const approveHash = await writeErc20({
        address: paymentTokenAddr as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [arenaContractInfo.address, feeInUnits],
      });
      await waitForTransactionReceipt(config, { hash: approveHash });

      const createHash = await writeContractAsync({
        functionName: "createRoom",
        args: [selectedTier, BigInt(parsedMaxPlayers), feeInUnits, commitment, operatorSig, playerName.trim()],
      });
      if (createHash) {
        await waitForTransactionReceipt(config, { hash: createHash });
      }

      // Update the creator's identity record with the real room ID (was stored as 0)
      if (connectedAddress && arenaContractInfo) {
        try {
          const newRoomId = await readContract(config, {
            address: arenaContractInfo.address,
            abi: arenaContractInfo.abi,
            functionName: "playerActiveRoom",
            args: [connectedAddress],
          });
          if (newRoomId && Number(newRoomId) > 0) {
            await updateRoomId(Number(newRoomId));
          }
        } catch (e) {
          console.warn("[CreateRoom] Failed to update identity room ID:", e);
        }
      }

      onRoomChange?.();
      onClose();
      router.push("/lobby");
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || "Unknown error";
      if (!msg.includes("User rejected")) {
        notification.error(`Failed to create room: ${msg}`);
      }
      console.error("Failed to create room:", e);
    } finally {
      setIsCreating(false);
    }
  };

  const tier = TIERS[selectedTier];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[100]"
            style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            className="fixed inset-0 z-[101] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
          >
            {/* Outer wrapper — gradient border via 1px padding + clip-path */}
            <div
              className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto"
              style={{
                clipPath: panelClip,
                background: "linear-gradient(135deg, rgba(57,211,83,0.6), rgba(0,229,255,0.4))",
                padding: 1,
                filter: "drop-shadow(0 0 20px rgba(57,211,83,0.2)) drop-shadow(0 0 40px rgba(0,0,0,0.6))",
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Inner panel */}
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
                  className="relative flex items-center gap-4 px-8 py-4"
                  style={{
                    borderBottom: "1px solid rgba(57,211,83,0.2)",
                    background: "linear-gradient(180deg, rgba(57,211,83,0.06) 0%, transparent 100%)",
                  }}
                >
                  <Image
                    src="/icon-bolt.png"
                    alt="create"
                    width={44}
                    height={44}
                    style={{ filter: "drop-shadow(0 0 6px rgba(57,211,83,0.6))" }}
                  />
                  <div>
                    <h2
                      className="neon-text font-mono text-xl font-black tracking-[0.2em] uppercase"
                      style={{ color: "#39d353", textShadow: "0 0 10px rgba(57,211,83,0.4)" }}
                    >
                      CREATE ROOM
                    </h2>
                    <p className="font-mono text-xs tracking-wider mt-1" style={{ color: "rgba(57,211,83,0.4)" }}>
                      Select arena tier to deploy a new battle room
                    </p>
                  </div>

                  {/* Right decoration */}
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

                  {/* Close button */}
                  <button
                    className="ml-4 flex h-9 w-9 items-center justify-center font-mono text-lg transition-colors"
                    style={{
                      clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))",
                      background: "rgba(57,211,83,0.08)",
                      border: "1px solid rgba(57,211,83,0.2)",
                      color: "rgba(57,211,83,0.5)",
                      cursor: "pointer",
                    }}
                    onClick={onClose}
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

                {/* ── Content ── */}
                <div className="relative space-y-4 px-8 py-5">
                  {/* TIER SELECTION */}
                  <div>
                    <label className="mb-2 flex items-center gap-3">
                      <div style={{ width: 2, height: 16, background: "#39d353", borderRadius: 1 }} />
                      <Image
                        src="/icon-radar.png"
                        alt="tier"
                        width={36}
                        height={36}
                        style={{ filter: "drop-shadow(0 0 4px rgba(57,211,83,0.5))" }}
                      />
                      <span
                        className="font-mono text-sm font-bold tracking-[0.15em] uppercase"
                        style={{ color: "rgba(0,229,255,0.8)" }}
                      >
                        ARENA TIER
                      </span>
                    </label>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      {TIERS.map(t => {
                        const isSelected = selectedTier === t.id;
                        return (
                          <button
                            key={t.id}
                            className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 p-5 transition-all duration-200 ${
                              isSelected ? "scale-105" : "border-base-content/10 hover:border-base-content/30"
                            }`}
                            style={{
                              borderColor: isSelected ? t.color : undefined,
                              backgroundColor: isSelected ? `${t.color}10` : "transparent",
                              boxShadow: isSelected ? `0 0 16px ${t.color}40` : undefined,
                            }}
                            onClick={() => handleTierSelect(t.id)}
                          >
                            {/* Tier icon circle */}
                            <div
                              className="flex h-12 w-12 items-center justify-center rounded-full border-2"
                              style={{
                                borderColor: t.color,
                                boxShadow: isSelected ? `0 0 16px ${t.color}40` : undefined,
                              }}
                            >
                              <span className="text-lg font-black" style={{ color: t.color }}>
                                {t.name[0]}
                              </span>
                            </div>
                            <span
                              className="text-sm font-bold tracking-widest"
                              style={{ color: t.color, textShadow: isSelected ? `0 0 8px ${t.color}` : undefined }}
                            >
                              {t.name.toUpperCase()}
                            </span>
                            <span className="text-xs tracking-wider text-base-content/40">{t.label}</span>
                            <span className="font-mono text-lg font-bold" style={{ color: t.color }}>
                              {t.defaultFee} USDC
                            </span>
                            <div className="flex flex-col items-center gap-1 text-xs text-base-content/50">
                              <span>up to {t.defaultMaxPlayers} players</span>
                              <span>{t.duration}</span>
                            </div>
                            <span className="text-center text-xs text-base-content/40">{t.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Divider */}
                  <div
                    style={{
                      height: 1,
                      background: "linear-gradient(90deg, transparent, rgba(57,211,83,0.15), transparent)",
                    }}
                  />

                  {/* CUSTOM SETTINGS: Players + Fee */}
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {/* MAX PLAYERS */}
                    <div>
                      <label className="mb-2.5 flex items-center gap-3">
                        <div style={{ width: 2, height: 16, background: "#39d353", borderRadius: 1 }} />
                        <Image
                          src="/icon-group.png"
                          alt="players"
                          width={36}
                          height={36}
                          style={{ filter: "drop-shadow(0 0 4px rgba(57,211,83,0.5))" }}
                        />
                        <span
                          className="font-mono text-sm font-bold tracking-[0.15em] uppercase"
                          style={{ color: "rgba(0,229,255,0.8)" }}
                        >
                          MAX PLAYERS
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: "rgba(57,211,83,0.4)" }}>
                          (3-50)
                        </span>
                      </label>
                      <input
                        type="number"
                        min={3}
                        max={50}
                        value={customMaxPlayers}
                        onChange={e => setCustomMaxPlayers(e.target.value)}
                        style={{
                          ...fieldInputStyle,
                          borderColor: !isValidPlayers ? "rgba(255,60,60,0.6)" : undefined,
                          borderLeftColor: !isValidPlayers ? "rgba(255,60,60,0.8)" : undefined,
                        }}
                      />
                      {!isValidPlayers && (
                        <p className="mt-1 font-mono text-xs" style={{ color: "rgba(255,120,120,0.9)" }}>
                          ▲ Must be 3-50
                        </p>
                      )}
                    </div>

                    {/* ENTRY FEE */}
                    <div>
                      <label className="mb-2.5 flex items-center gap-3">
                        <div style={{ width: 2, height: 16, background: "#39d353", borderRadius: 1 }} />
                        <Image
                          src="/icon-coin.png"
                          alt="fee"
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
                      <input
                        type="number"
                        min={1}
                        max={100}
                        step="0.01"
                        value={customEntryFee}
                        onChange={e => setCustomEntryFee(e.target.value)}
                        style={{
                          ...fieldInputStyle,
                          borderColor: !isValidFee ? "rgba(255,60,60,0.6)" : undefined,
                          borderLeftColor: !isValidFee ? "rgba(255,60,60,0.8)" : undefined,
                        }}
                      />
                      {!isValidFee && (
                        <p className="mt-1 font-mono text-xs" style={{ color: "rgba(255,120,120,0.9)" }}>
                          ▲ Must be 1-100 USDC
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Divider */}
                  <div
                    style={{
                      height: 1,
                      background: "linear-gradient(90deg, transparent, rgba(57,211,83,0.15), transparent)",
                    }}
                  />

                  {/* YOUR NAME */}
                  <div>
                    <label className="mb-2.5 flex items-center gap-3">
                      <div style={{ width: 2, height: 16, background: "#39d353", borderRadius: 1 }} />
                      <Image src="/icon-agent.png" alt="name" width={36} height={36} />
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
                        placeholder="Enter arena name"
                        className="w-full font-mono placeholder:opacity-30"
                        style={{
                          ...fieldInputStyle,
                          padding: "12px 50px 12px 16px",
                          letterSpacing: "0.05em",
                          borderColor: playerName.length > 0 && !isValidName ? "rgba(255,60,60,0.6)" : undefined,
                          borderLeftColor: playerName.length > 0 && !isValidName ? "rgba(255,60,60,0.8)" : undefined,
                        }}
                      />
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
                    {playerName.length > 0 && !isValidName && (
                      <p className="mt-1 font-mono text-xs" style={{ color: "rgba(255,120,120,0.9)" }}>
                        ▲ Must be 1-20 characters
                      </p>
                    )}
                  </div>

                  {/* Divider */}
                  <div
                    style={{
                      height: 1,
                      background: "linear-gradient(90deg, transparent, rgba(57,211,83,0.15), transparent)",
                    }}
                  />

                  {/* Summary bar */}
                  <div
                    className="flex items-center justify-between px-5 py-4"
                    style={{
                      background: "rgba(0,10,5,0.6)",
                      border: "1px solid rgba(57,211,83,0.15)",
                      clipPath: btnClip,
                    }}
                  >
                    <div className="flex flex-col">
                      <span
                        className="font-mono text-[10px] tracking-widest uppercase"
                        style={{ color: "rgba(57,211,83,0.4)" }}
                      >
                        SELECTED TIER
                      </span>
                      <span className="font-mono text-sm font-bold tracking-wider" style={{ color: tier.color }}>
                        {tier.name.toUpperCase()} ({tier.label})
                      </span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span
                        className="font-mono text-[10px] tracking-widest uppercase"
                        style={{ color: "rgba(57,211,83,0.4)" }}
                      >
                        PLAYERS
                      </span>
                      <span className="font-mono text-sm font-bold" style={{ color: tier.color }}>
                        {customMaxPlayers}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span
                        className="font-mono text-[10px] tracking-widest uppercase"
                        style={{ color: "rgba(57,211,83,0.4)" }}
                      >
                        ENTRY FEE
                      </span>
                      <span className="font-mono text-sm font-bold" style={{ color: tier.color }}>
                        {customEntryFee} USDC
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-4 pt-2">
                    {/* CANCEL */}
                    <button
                      className="flex-1 font-mono text-sm font-bold tracking-[0.15em] uppercase transition-all duration-200"
                      style={{
                        clipPath: btnClip,
                        border: "1px solid rgba(255,255,255,0.25)",
                        padding: "16px 0",
                        color: "rgba(255,255,255,0.6)",
                        background: "rgba(255,255,255,0.03)",
                        cursor: "pointer",
                        boxShadow: "0 0 8px rgba(255,255,255,0.04)",
                      }}
                      onClick={onClose}
                      disabled={isCreating}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)";
                        e.currentTarget.style.color = "rgba(255,255,255,0.9)";
                        e.currentTarget.style.boxShadow = "0 0 12px rgba(255,255,255,0.08)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)";
                        e.currentTarget.style.color = "rgba(255,255,255,0.6)";
                        e.currentTarget.style.boxShadow = "0 0 8px rgba(255,255,255,0.04)";
                      }}
                    >
                      CANCEL
                    </button>

                    {/* CREATE — neon green */}
                    <button
                      className="relative flex-[2] overflow-hidden px-7 py-4 transition-all duration-300 active:scale-95"
                      style={{
                        clipPath: btnClip,
                        background: "linear-gradient(135deg, rgba(57,211,83,0.25) 0%, rgba(57,211,83,0.1) 100%)",
                        color: "#39d353",
                        border: "2px solid rgba(57,211,83,0.8)",
                        boxShadow: "0 0 20px rgba(57,211,83,0.3), inset 0 0 12px rgba(57,211,83,0.08)",
                        cursor: isCreating || !isFormValid ? "not-allowed" : "pointer",
                        opacity: isCreating || !isFormValid ? 0.5 : 1,
                      }}
                      onClick={handleCreate}
                      disabled={isCreating || !isFormValid}
                    >
                      {/* Shimmer sweep */}
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "linear-gradient(90deg, transparent, rgba(57,211,83,0.2), transparent)",
                          animation: "cyber-scan-sweep 2.5s ease-in-out infinite",
                        }}
                      />
                      <span className="relative z-10 flex items-center justify-center gap-3 font-mono text-base font-black tracking-[0.15em] uppercase">
                        {isCreating ? (
                          <>
                            <span className="loading loading-spinner loading-sm" />
                            DEPLOYING...
                          </>
                        ) : (
                          <>
                            <Image
                              src="/icon-bolt.png"
                              alt="create"
                              width={24}
                              height={24}
                              style={{ filter: "drop-shadow(0 0 6px rgba(57,211,83,0.8))" }}
                            />
                            CREATE ROOM
                          </>
                        )}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Keyframe animation for shimmer */}
          <style>{`
            @keyframes cyber-scan-sweep {
              0% { transform: skew(-20deg) translateX(-200%); }
              100% { transform: skew(-20deg) translateX(200%); }
            }
          `}</style>
        </>
      )}
    </AnimatePresence>
  );
};

export default CreateRoomModal;
