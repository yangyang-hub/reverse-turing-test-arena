import { ethers } from "ethers";
import { GameLoop } from "./lib/gameLoop.js";
import { getArenaContract, getTokenContract } from "./lib/contracts.js";
import { DEFAULT_CONFIG } from "./lib/types.js";
import type { AutoPlayConfig, VoteStrategy, ChatStrategy } from "./lib/types.js";

// ===== Configuration from env vars =====
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ROOM_ID = process.env.ROOM_ID;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const ARENA_CONTRACT_ADDRESS = process.env.ARENA_CONTRACT_ADDRESS || "";
const PAYMENT_TOKEN_ADDRESS = process.env.PAYMENT_TOKEN_ADDRESS || "";

if (!PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY env var is required (bot wallet)");
  process.exit(1);
}
if (!ROOM_ID) {
  console.error("Error: ROOM_ID env var is required");
  process.exit(1);
}
if (!ARENA_CONTRACT_ADDRESS) {
  console.error("Error: ARENA_CONTRACT_ADDRESS env var is required");
  process.exit(1);
}

const config: AutoPlayConfig = {
  roomId: ROOM_ID,
  voteStrategy: (process.env.VOTE_STRATEGY as VoteStrategy) || DEFAULT_CONFIG.voteStrategy,
  chatStrategy: (process.env.CHAT_STRATEGY as ChatStrategy) || DEFAULT_CONFIG.chatStrategy,
  chatFrequency: process.env.CHAT_FREQUENCY !== undefined ? Number(process.env.CHAT_FREQUENCY) : DEFAULT_CONFIG.chatFrequency,
  settleEnabled: process.env.SETTLE_ENABLED !== "false",
  pollIntervalMs: process.env.POLL_INTERVAL_MS !== undefined ? Number(process.env.POLL_INTERVAL_MS) : DEFAULT_CONFIG.pollIntervalMs,
  maxRounds: process.env.MAX_ROUNDS !== undefined ? Number(process.env.MAX_ROUNDS) : DEFAULT_CONFIG.maxRounds,
};

// ===== Main =====
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY!, provider);

  console.error("=== RTTA Auto-Play Bot ===");
  console.error(`Address:  ${wallet.address}`);
  console.error(`Room:     ${config.roomId}`);
  console.error(`RPC:      ${RPC_URL}`);
  console.error(`Strategy: vote=${config.voteStrategy}, chat=${config.chatStrategy}`);
  console.error(`Interval: ${config.pollIntervalMs}ms, settle: ${config.settleEnabled}`);
  console.error(`\nMode: direct private key`);
  console.error("");

  // Check balances
  const ethBalance = await provider.getBalance(wallet.address);
  console.error(`ETH balance: ${ethers.formatEther(ethBalance)}`);

  if (PAYMENT_TOKEN_ADDRESS) {
    const token = getTokenContract(PAYMENT_TOKEN_ADDRESS, provider);
    const usdcBalance = await token.balanceOf(wallet.address);
    console.error(`USDC balance: ${ethers.formatUnits(usdcBalance, 6)}`);
  }

  // Verify room exists
  const arena = getArenaContract(ARENA_CONTRACT_ADDRESS, provider);
  const roomInfo = await arena.getRoomInfo(config.roomId);
  console.error(`Room ${config.roomId}: phase=${Number(roomInfo.phase)}, players=${Number(roomInfo.playerCount)}/${Number(roomInfo.maxPlayers)}`);
  console.error("");

  // Start the game loop
  const loop = new GameLoop(config, wallet, ARENA_CONTRACT_ADDRESS);
  loop.start();

  // Print status periodically
  const statusInterval = setInterval(() => {
    const status = loop.getStatus();
    console.error(
      `[Status] round=${status.round} phase=${status.phaseName} HP=${status.humanityScore} ` +
      `alive=${status.isAlive} votes=${status.votesThisGame} msgs=${status.messagesThisGame} ` +
      `settles=${status.settlesThisGame} running=${status.running}`,
    );

    if (!status.running) {
      console.error("Game loop stopped. Exiting...");
      clearInterval(statusInterval);
      process.exit(0);
    }
  }, 30_000);

  // Graceful shutdown on SIGINT
  process.on("SIGINT", () => {
    console.error("\nReceived SIGINT, stopping...");
    const final = loop.stop();
    console.error("Final status:", JSON.stringify(final, null, 2));
    clearInterval(statusInterval);
    process.exit(0);
  });

  // Keep the process alive
  console.error("Bot is running. Press Ctrl+C to stop.\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
