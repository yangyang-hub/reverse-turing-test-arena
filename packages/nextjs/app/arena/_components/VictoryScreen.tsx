"use client";

import { useCallback, useEffect, useRef } from "react";
import { Address } from "@scaffold-ui/components";
import { motion } from "framer-motion";
import { formatUnits } from "viem";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useGameStore } from "~~/services/store/gameStore";

export const VictoryScreen = ({
  roomId,
  champion,
  rewardAmount,
  onDismiss,
}: {
  roomId: bigint;
  champion: string;
  rewardAmount: bigint;
  onDismiss: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const myPlayer = useGameStore(s => s.myPlayer);
  const isChampion = myPlayer?.addr.toLowerCase() === champion.toLowerCase();

  const { writeContractAsync, isPending } = useScaffoldWriteContract("TuringArena");

  // Gold particle celebration
  const initParticles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const COLORS = ["#FFD700", "#FFA500", "#FFEC8B", "#DAA520", "#F0E68C"];
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
  }, []);

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
    } catch (err) {
      console.error("Claim failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95">
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

      <motion.div
        className="relative z-10 text-center max-w-lg mx-auto px-4"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.5 }}
      >
        {/* Crown */}
        <motion.div
          className="text-7xl md:text-9xl mb-4"
          animate={{ y: [0, -15, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        >
          <span role="img" aria-label="crown">
            {"\u{1F451}"}
          </span>
        </motion.div>

        <div className="text-yellow-400 font-mono text-lg tracking-[0.3em] mb-2">
          {isChampion ? "YOU ARE THE" : "THE CHAMPION IS"}
        </div>

        <div className="text-4xl md:text-6xl font-mono font-black text-white mb-4 neon-text-gold">CHAMPION</div>

        {/* Champion address */}
        <div className="mb-6">
          <Address address={champion as `0x${string}`} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8 max-w-sm mx-auto">
          <div className="bg-gray-900/50 border border-gray-800 rounded p-3">
            <div className="text-gray-500 font-mono text-xs">REWARD</div>
            <div className="text-green-400 font-mono text-lg">{formatUnits(rewardAmount, 6)} USDC</div>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded p-3">
            <div className="text-gray-500 font-mono text-xs">HUMANITY</div>
            <div className="text-cyan-400 font-mono text-lg">{myPlayer?.humanityScore ?? "--"}</div>
          </div>
        </div>

        {/* Claim button (champion only) */}
        {isChampion && (
          <motion.button
            onClick={handleClaim}
            disabled={isPending}
            className="btn btn-lg font-mono tracking-widest bg-yellow-500 text-black hover:bg-yellow-400 border-none"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isPending ? "CLAIMING..." : "CLAIM REWARD"}
          </motion.button>
        )}

        {/* Dismiss */}
        <button onClick={onDismiss} className="mt-4 block mx-auto text-gray-500 hover:text-gray-300 font-mono text-xs">
          [ BACK TO LOBBY ]
        </button>
      </motion.div>
    </div>
  );
};
