"use client";

import { useRef, useState } from "react";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const TIERS = [
  {
    id: 0,
    name: "Quick",
    label: "Bronze",
    fee: "0.01",
    color: "#CD7F32",
    borderClass: "tier-quick-border",
    textClass: "tier-quick",
    description: "Fast rounds, smaller stakes",
    players: "4-6 players",
    duration: "~10 min",
  },
  {
    id: 1,
    name: "Standard",
    label: "Silver",
    fee: "0.05",
    color: "#C0C0C0",
    borderClass: "tier-standard-border",
    textClass: "tier-standard",
    description: "Balanced gameplay experience",
    players: "6-8 players",
    duration: "~20 min",
  },
  {
    id: 2,
    name: "Epic",
    label: "Gold",
    fee: "0.1",
    color: "#FFD700",
    borderClass: "tier-epic-border",
    textClass: "tier-epic",
    description: "High stakes, extended battle",
    players: "8-10 players",
    duration: "~30 min",
  },
] as const;

type CreateRoomModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const CreateRoomModal = ({ isOpen, onClose }: CreateRoomModalProps) => {
  const [selectedTier, setSelectedTier] = useState<number>(1);
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

  const handleCreate = async () => {
    try {
      await writeContractAsync({
        functionName: "createRoom",
        args: [selectedTier],
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
                onClick={() => setSelectedTier(tier.id)}
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

                {/* Fee */}
                <span className={`font-mono text-lg font-bold ${tier.textClass}`}>{tier.fee} ETH</span>

                {/* Details */}
                <div className="flex flex-col items-center gap-1 text-xs text-base-content/50">
                  <span>{tier.players}</span>
                  <span>{tier.duration}</span>
                </div>

                {/* Description */}
                <span className="text-center text-xs text-base-content/40">{tier.description}</span>
              </button>
            );
          })}
        </div>

        {/* Summary bar */}
        <div className="mt-6 flex items-center justify-between rounded border border-primary/20 bg-base-300/50 px-4 py-3">
          <div className="flex flex-col">
            <span className="text-xs text-base-content/40">SELECTED TIER</span>
            <span className={`text-sm font-bold tracking-wider ${TIERS[selectedTier].textClass}`}>
              {TIERS[selectedTier].name.toUpperCase()} ({TIERS[selectedTier].label})
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs text-base-content/40">ENTRY FEE</span>
            <span className={`font-mono text-sm font-bold ${TIERS[selectedTier].textClass}`}>
              {TIERS[selectedTier].fee} ETH
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
            disabled={isMining}
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
