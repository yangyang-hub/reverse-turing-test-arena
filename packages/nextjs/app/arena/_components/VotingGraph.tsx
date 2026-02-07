"use client";

import { useCallback, useEffect, useRef } from "react";
import { useGameStore } from "~~/services/store/gameStore";

type NodeStatus = "alive" | "eliminated" | "suspected";

const STATUS_COLORS: Record<NodeStatus, string> = {
  alive: "#22c55e",
  eliminated: "#ef4444",
  suspected: "#eab308",
};

export const VotingGraph = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const players = useGameStore(s => s.players);
  const eliminations = useGameStore(s => s.eliminations);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const radius = Math.min(W, H) * 0.35;

    ctx.clearRect(0, 0, W, H);

    if (players.length === 0) {
      ctx.fillStyle = "#4b5563";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No players yet", cx, cy);
      return;
    }

    // Calculate node positions (ring layout)
    const nodes = players.map((p, i) => {
      const angle = (2 * Math.PI * i) / players.length - Math.PI / 2;
      const status: NodeStatus = !p.isAlive ? "eliminated" : p.humanityScore < 40 ? "suspected" : "alive";
      return {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        address: p.addr,
        status,
        label: `${p.addr.slice(0, 4)}..${p.addr.slice(-2)}`,
      };
    });

    // Draw elimination connections
    eliminations.forEach(elim => {
      const fromNode = nodes.find(n => n.address.toLowerCase() === elim.eliminatedBy.toLowerCase());
      const toNode = nodes.find(n => n.address.toLowerCase() === elim.player.toLowerCase());
      if (!fromNode || !toNode) return;

      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrow
      const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
      const arrowLen = 8;
      const ax = toNode.x - 12 * Math.cos(angle);
      const ay = toNode.y - 12 * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - arrowLen * Math.cos(angle - Math.PI / 6), ay - arrowLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(ax - arrowLen * Math.cos(angle + Math.PI / 6), ay - arrowLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = "rgba(239, 68, 68, 0.7)";
      ctx.fill();
    });

    // Draw nodes
    const pulse = (Math.sin(Date.now() / 500) + 1) / 2;

    nodes.forEach(node => {
      const color = STATUS_COLORS[node.status];

      // Pulse glow (alive nodes only)
      if (node.status === "alive") {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 10 + pulse * 4, 0, Math.PI * 2);
        ctx.fillStyle = color + "20";
        ctx.fill();
      }

      // Solid circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = node.status === "eliminated" ? color + "60" : color;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      ctx.fillStyle = "#9ca3af";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(node.label, node.x, node.y + 20);
    });
  }, [players, eliminations]);

  useEffect(() => {
    let animationId: number;
    const loop = () => {
      draw();
      animationId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animationId);
  }, [draw]);

  return (
    <div className="w-full aspect-square max-w-md mx-auto">
      <div className="text-center mb-2">
        <span className="text-gray-500 font-mono text-[10px] tracking-wider">VOTING NETWORK</span>
      </div>
      <canvas ref={canvasRef} width={400} height={400} className="w-full h-full" />
    </div>
  );
};
