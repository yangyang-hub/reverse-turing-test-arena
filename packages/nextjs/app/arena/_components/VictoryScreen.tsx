"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address } from "@scaffold-ui/components";
import { motion } from "framer-motion";
import { formatUnits } from "viem";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { getPlayerAlias } from "~~/utils/playerAlias";

export const VictoryScreen = ({
  roomId,
  humansWon,
  mvp,
  mvpVotes,
  myRewardAmount,
  myRewardClaimed,
  onDismiss,
}: {
  roomId: bigint;
  humansWon: boolean;
  mvp: string;
  mvpVotes: number;
  myRewardAmount: bigint;
  myRewardClaimed: boolean;
  onDismiss: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [justClaimed, setJustClaimed] = useState(false);
  const hasReward = myRewardAmount > 0n && !myRewardClaimed && !justClaimed;

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "TuringArena",
  });

  const { data: allPlayers } = useScaffoldReadContract({
    contractName: "TuringArena",
    functionName: "getAllPlayers",
    args: [roomId],
  });

  const playerAddresses = (allPlayers as string[]) || [];
  const mvpAlias = getPlayerAlias(playerAddresses, mvp);

  // Particle celebration
  const initParticles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const COLORS = humansWon
      ? ["#00FF41", "#39FF14", "#00E676", "#76FF03", "#B2FF59"] // Green for humans
      : ["#FF0040", "#FF1744", "#FF5252", "#FF8A80", "#E040FB"]; // Red/pink for AIs

    const particles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; color: string }[] =
      [];

    for (let i = 0; i < 150; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 2 + 1,
        size: Math.random() * 4 + 1,
        alpha: Math.random() * 0.8 + 0.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    }

    let animationId: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.02;
        if (p.y > canvas.height) {
          p.y = -10;
          p.vy = Math.random() * 2 + 1;
        }
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      });
      ctx.globalAlpha = 1;
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => cancelAnimationFrame(animationId);
  }, [humansWon]);

  useEffect(() => {
    const cleanup = initParticles();
    return cleanup;
  }, [initParticles]);

  const handleClaim = async () => {
    try {
      await writeContractAsync({
        functionName: "claimReward",
        args: [roomId],
      });
      setJustClaimed(true);
    } catch (err) {
      console.error("Claim failed:", err);
    }
  };

  const teamIcon = humansWon ? "\u{1F9D1}" : "\u{1F916}";
  const teamLabel = humansWon ? "HUMANS WIN" : "AIs WIN";
  const teamColor = humansWon ? "text-green-400" : "text-red-400";
  const teamGlow = humansWon ? "neon-text" : "";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      <motion.div
        className="relative z-10 text-center max-w-lg mx-auto px-4"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.5 }}
      >
        {/* Team icon */}
        <motion.div
          className="text-7xl md:text-9xl mb-4"
          animate={{ y: [0, -15, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        >
          <span role="img" aria-label={humansWon ? "human" : "robot"}>
            {teamIcon}
          </span>
        </motion.div>

        {/* Team result */}
        <div className={`font-mono text-4xl md:text-6xl font-black mb-4 ${teamColor} ${teamGlow}`}>{teamLabel}</div>

        <div className="text-gray-400 font-mono text-sm mb-6">
          {humansWon ? "The humans identified all AI agents!" : "The AI agents outsmarted the humans!"}
        </div>

        {/* MVP */}
        {mvp && mvp !== "0x0000000000000000000000000000000000000000" && (
          <div className="mb-6 flex flex-col items-center gap-2">
            <div className="text-yellow-400 font-mono text-xs tracking-[0.3em]">MOST VALUABLE PLAYER</div>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-mono text-lg font-bold text-black"
                style={{ backgroundColor: mvpAlias.color }}
              >
                {mvpAlias.initial}
              </div>
              <div className="flex flex-col items-start">
                <span className="font-mono text-xl font-bold" style={{ color: mvpAlias.color }}>
                  {mvpAlias.name}
                </span>
                <span className="text-yellow-500 font-mono text-xs">{mvpVotes} successful votes</span>
              </div>
            </div>
            <Address address={mvp as `0x${string}`} />
          </div>
        )}

        {/* My reward info */}
        {myRewardAmount > 0n && (
          <div className="mb-8 max-w-sm mx-auto">
            <div className="bg-gray-900/50 border border-gray-800 rounded p-3 text-center">
              <div className="text-gray-500 font-mono text-xs">YOUR REWARD</div>
              <div className="text-green-400 font-mono text-lg">{formatUnits(myRewardAmount, 6)} USDC</div>
            </div>
          </div>
        )}

        {/* Claim button */}
        {hasReward && (
          <motion.button
            onClick={handleClaim}
            disabled={isMining}
            className={`btn btn-lg font-mono tracking-widest border-none ${
              humansWon ? "bg-green-500 text-black hover:bg-green-400" : "bg-red-500 text-white hover:bg-red-400"
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isMining ? "CLAIMING..." : "CLAIM REWARD"}
          </motion.button>
        )}
        {(myRewardClaimed || justClaimed) && myRewardAmount > 0n && (
          <div className="text-green-400 font-mono text-sm">REWARD CLAIMED</div>
        )}

        {/* Dismiss */}
        <button onClick={onDismiss} className="mt-4 block mx-auto text-gray-500 hover:text-gray-300 font-mono text-xs">
          [ BACK TO LOBBY ]
        </button>
      </motion.div>
    </div>
  );
};
