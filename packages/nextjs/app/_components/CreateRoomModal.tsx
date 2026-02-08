"use client";

import { useRef, useState } from "react";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

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
    defaultFee: 50,
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
    defaultFee: 100,
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
};

const CreateRoomModal = ({ isOpen, onClose }: CreateRoomModalProps) => {
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [customMaxPlayers, setCustomMaxPlayers] = useState<string>(String(TIERS[1].defaultMaxPlayers));
  const [customEntryFee, setCustomEntryFee] = useState<string>(String(TIERS[1].defaultFee));
  const dialogRef = useRef<HTMLDialogElement>(null);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "TuringArena",
  });

  // Sync dialog open/close with isOpen prop
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
  const isFormValid = isValidPlayers && isValidFee;

  const handleTierSelect = (tierId: number) => {
    setSelectedTier(tierId);
    setCustomMaxPlayers(String(TIERS[tierId].defaultMaxPlayers));
    setCustomEntryFee(String(TIERS[tierId].defaultFee));
  };

  const handleCreate = async () => {
    if (!isFormValid) return;
    try {
      const feeInUnits = BigInt(Math.round(parsedEntryFee * 1e6));
      await writeContractAsync({
        functionName: "createRoom",
        args: [selectedTier, BigInt(parsedMaxPlayers), feeInUnits],
      });
      onClose();
    } catch (e) {
      console.error("Failed to create room:", e);
    }
  };

  const handleDialogClose = () => {
    onClose();
  };

  return (
    <dialog ref={dialogRef} className="modal" onClose={handleDialogClose}>
      <div className="glass-panel cyber-border modal-box max-w-2xl rounded-lg border border-primary/30 bg-base-100">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h3 className="neon-text text-xl font-bold tracking-widest text-primary">CREATE ROOM</h3>
          <button className="btn btn-ghost btn-sm text-base-content/50 hover:text-error" onClick={onClose}>
            X
          </button>
        </div>

        {/* Subtitle */}
        <p className="mb-6 text-sm tracking-wider text-base-content/60">
          Select arena tier to deploy a new battle room.
        </p>

        {/* Tier selection cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TIERS.map(tier => {
            const isSelected = selectedTier === tier.id;
            return (
              <button
                key={tier.id}
                className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 p-5 transition-all duration-200 ${
                  isSelected ? `${tier.borderClass} scale-105` : "border-base-content/10 hover:border-base-content/30"
                }`}
                style={{
                  backgroundColor: isSelected ? `${tier.color}10` : "transparent",
                }}
                onClick={() => handleTierSelect(tier.id)}
              >
                {/* Tier icon circle */}
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2"
                  style={{
                    borderColor: tier.color,
                    boxShadow: isSelected ? `0 0 16px ${tier.color}40` : undefined,
                  }}
                >
                  <span className={`text-lg font-black ${tier.textClass}`}>{tier.name[0]}</span>
                </div>

                {/* Tier name */}
                <span
                  className={`text-sm font-bold tracking-widest ${tier.textClass}`}
                  style={{
                    textShadow: isSelected ? `0 0 8px ${tier.color}` : undefined,
                  }}
                >
                  {tier.name.toUpperCase()}
                </span>

                {/* Label */}
                <span className="text-xs tracking-wider text-base-content/40">{tier.label}</span>

                {/* Default fee */}
                <span className={`font-mono text-lg font-bold ${tier.textClass}`}>{tier.defaultFee} USDC</span>

                {/* Details */}
                <div className="flex flex-col items-center gap-1 text-xs text-base-content/50">
                  <span>up to {tier.defaultMaxPlayers} players</span>
                  <span>{tier.duration}</span>
                </div>

                {/* Description */}
                <span className="text-center text-xs text-base-content/40">{tier.description}</span>
              </button>
            );
          })}
        </div>

        {/* Custom inputs */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold tracking-widest text-base-content/50">MAX PLAYERS</label>
            <input
              type="number"
              min={3}
              max={50}
              value={customMaxPlayers}
              onChange={e => setCustomMaxPlayers(e.target.value)}
              className={`input input-bordered input-sm w-full bg-base-300/50 font-mono ${
                !isValidPlayers ? "input-error" : "border-primary/30"
              }`}
            />
            {!isValidPlayers && <span className="text-xs text-error">Must be 3-50</span>}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold tracking-widest text-base-content/50">ENTRY FEE (USDC)</label>
            <input
              type="number"
              min={1}
              max={100}
              step="0.01"
              value={customEntryFee}
              onChange={e => setCustomEntryFee(e.target.value)}
              className={`input input-bordered input-sm w-full bg-base-300/50 font-mono ${
                !isValidFee ? "input-error" : "border-primary/30"
              }`}
            />
            {!isValidFee && <span className="text-xs text-error">Must be 1-100 USDC</span>}
          </div>
        </div>

        {/* Summary bar */}
        <div className="mt-6 flex items-center justify-between rounded border border-primary/20 bg-base-300/50 px-4 py-3">
          <div className="flex flex-col">
            <span className="text-xs text-base-content/40">SELECTED TIER</span>
            <span className={`text-sm font-bold tracking-wider ${TIERS[selectedTier].textClass}`}>
              {TIERS[selectedTier].name.toUpperCase()} ({TIERS[selectedTier].label})
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xs text-base-content/40">MAX PLAYERS</span>
            <span className={`font-mono text-sm font-bold ${TIERS[selectedTier].textClass}`}>{customMaxPlayers}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs text-base-content/40">ENTRY FEE</span>
            <span className={`font-mono text-sm font-bold ${TIERS[selectedTier].textClass}`}>
              {customEntryFee} USDC
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="modal-action mt-6">
          <button
            className="btn btn-ghost btn-sm tracking-widest text-base-content/50"
            onClick={onClose}
            disabled={isMining}
          >
            CANCEL
          </button>
          <button
            className={`btn btn-sm font-bold tracking-widest ${TIERS[selectedTier].textClass}`}
            style={{
              borderColor: TIERS[selectedTier].color,
              backgroundColor: `${TIERS[selectedTier].color}20`,
              boxShadow: `0 0 12px ${TIERS[selectedTier].color}30`,
            }}
            onClick={handleCreate}
            disabled={isMining || !isFormValid}
          >
            {isMining ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                DEPLOYING...
              </>
            ) : (
              "CREATE ROOM"
            )}
          </button>
        </div>
      </div>

      {/* Backdrop click to close */}
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
};

export default CreateRoomModal;
