import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
import { ARENA_ABI, ERC20_ABI } from "./lib/contracts.js";
import { GameLoop } from "./lib/gameLoop.js";
import { DEFAULT_CONFIG, PHASE_NAMES } from "./lib/types.js";
import type { AutoPlayConfig, VoteStrategy, ChatStrategy } from "./lib/types.js";

// Initialize MCP Server
const server = new McpServer({
  name: "rtta-arena",
  version: "1.0.0",
});

// RPC connection
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");

// Player wallet (initialized via init_session tool)
let playerWallet: ethers.Wallet | null = null;

// Active game loop (one at a time)
let activeGameLoop: GameLoop | null = null;

// Contract addresses
const ARENA_CONTRACT = process.env.ARENA_CONTRACT_ADDRESS || "";
const PAYMENT_TOKEN = process.env.PAYMENT_TOKEN_ADDRESS || "";

// ============ Tool 1: Get Arena Status ============
server.tool(
  "get_arena_status",
  "Get real-time context for a battle royale room: room state, all players with humanity scores, and recent chat history. Use this to understand the current game situation before taking actions.",
  {
    roomId: z.string().describe("Room ID number"),
  },
  async ({ roomId }) => {
    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider);

      const [roomInfo, playerAddresses] = await Promise.all([
        contract.getRoomInfo(roomId),
        contract.getAllPlayers(roomId),
      ]);

      // Query recent chat events
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = roomInfo.startBlock > 0 ? Number(roomInfo.startBlock) : Math.max(0, currentBlock - 5000);
      const filter = contract.filters.NewMessage(roomId);
      const events = await contract.queryFilter(filter, fromBlock, currentBlock);
      const chatHistory = events
        .filter((e): e is ethers.EventLog => "args" in e)
        .map(e => ({
          sender: e.args[1],
          content: e.args[2],
          timestamp: Number(e.args[3]),
        }));

      // Get detailed player info
      const playerInfos = await Promise.all(
        (playerAddresses as string[]).map((addr: string) => contract.getPlayerInfo(roomId, addr)),
      );

      const formattedPlayers = playerInfos.map((p: ethers.Result) => ({
        address: p.addr,
        humanityScore: Number(p.humanityScore),
        isAlive: p.isAlive,
        isAI: p.isAI,
        actionCount: Number(p.actionCount),
        successfulVotes: Number(p.successfulVotes),
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                room: {
                  id: roomInfo.id.toString(),
                  phase: Number(roomInfo.phase),
                  phaseName: PHASE_NAMES[Number(roomInfo.phase)] || "Unknown",
                  entryFee: ethers.formatUnits(roomInfo.entryFee, 6) + " USDC",
                  prizePool: ethers.formatUnits(roomInfo.prizePool, 6) + " USDC",
                  maxPlayers: Number(roomInfo.maxPlayers),
                  playerCount: Number(roomInfo.playerCount),
                  aliveCount: Number(roomInfo.aliveCount),
                  humanCount: Number(roomInfo.humanCount),
                  aiCount: Number(roomInfo.aiCount),
                  isActive: roomInfo.isActive,
                  isEnded: roomInfo.isEnded,
                },
                players: formattedPlayers,
                recentChat: chatHistory.slice(-20),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 2: Execute On-chain Action ============
server.tool(
  "action_onchain",
  "Execute an on-chain action in the arena. Actions: CHAT (send a message to the room), VOTE (vote to eliminate a suspect), JOIN (join a room by paying USDC entry fee).",
  {
    type: z.enum(["CHAT", "VOTE", "JOIN"]).describe("Action type: CHAT, VOTE, or JOIN"),
    roomId: z.string().describe("Room ID number"),
    content: z.string().optional().describe("Chat message content (required for CHAT, max 280 chars)"),
    target: z.string().optional().describe("Vote target address (required for VOTE)"),
  },
  async ({ type, roomId, content, target }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Wallet not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);

      let tx: ethers.TransactionResponse;

      switch (type) {
        case "CHAT":
          if (!content) throw new Error("Content required for CHAT action");
          if (content.length > 280) throw new Error("Message too long (max 280 chars)");
          tx = await contract.sendMessage(roomId, content);
          break;

        case "VOTE":
          if (!target) throw new Error("Target address required for VOTE action");
          tx = await contract.castVote(roomId, target);
          break;

        case "JOIN": {
          // Get room entry fee and approve USDC
          const roomInfo = await contract.getRoomInfo(roomId);
          const entryFee = roomInfo.entryFee;

          // Resolve payment token address
          const tokenAddr = PAYMENT_TOKEN || (await contract.paymentToken());
          const token = new ethers.Contract(tokenAddr, ERC20_ABI, playerWallet);

          // Check allowance and approve if needed
          const allowance = await token.allowance(playerWallet.address, ARENA_CONTRACT);
          if (allowance < entryFee) {
            const approveTx = await token.approve(ARENA_CONTRACT, entryFee);
            await approveTx.wait();
          }

          tx = await contract.joinRoom(roomId, true); // MCP players are AI
          break;
        }
      }

      await tx.wait();

      return {
        content: [
          {
            type: "text" as const,
            text: `Action ${type} executed successfully!\nTx Hash: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 3: Check Session Status ============
server.tool(
  "check_session_status",
  "Check the current wallet's address and USDC balance. Use this to verify your session is active before taking actions.",
  {},
  async () => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Session wallet not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const result: Record<string, unknown> = {
        address: playerWallet.address,
      };

      // Check ETH balance
      const ethBalance = await provider.getBalance(playerWallet.address);
      result.ethBalance = ethers.formatEther(ethBalance);

      // Check USDC balance
      const tokenAddr = PAYMENT_TOKEN || (ARENA_CONTRACT ? await new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider).paymentToken() : null);
      if (tokenAddr) {
        const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        const balance = await token.balanceOf(playerWallet.address);
        result.usdcBalance = ethers.formatUnits(balance, 6);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 4: Initialize Session ============
server.tool(
  "init_session",
  "Initialize a wallet for gameplay. Pass a private key to create a wallet that will sign all on-chain actions (chat, vote, join, etc.).",
  {
    privateKey: z.string().describe("Private key of the wallet to use for gameplay (hex, with or without 0x)"),
  },
  async ({ privateKey }) => {
    try {
      playerWallet = new ethers.Wallet(privateKey, provider);
      const balance = await provider.getBalance(playerWallet.address);

      return {
        content: [
          {
            type: "text" as const,
            text: `Wallet initialized!\nAddress: ${playerWallet.address}\nETH Balance: ${ethers.formatEther(balance)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 5: Settle Round ============
server.tool(
  "settle_round",
  "Advance the game by settling the current round. Anyone can call this once enough blocks have passed. Triggers elimination of the player with the most votes.",
  {
    roomId: z.string().describe("Room ID number"),
  },
  async ({ roomId }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      const tx = await contract.settleRound(roomId);
      await tx.wait();

      const round = await contract.currentRound(roomId);
      return {
        content: [
          {
            type: "text" as const,
            text: `Round settled! Now on round ${round.toString()}.\nTx: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 6: Start Game ============
server.tool(
  "start_game",
  "Start a game that's in the Waiting phase. Only the room creator can call this, and at least 3 players must have joined.",
  {
    roomId: z.string().describe("Room ID number"),
  },
  async ({ roomId }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      const tx = await contract.startGame(roomId);
      await tx.wait();

      return {
        content: [
          {
            type: "text" as const,
            text: `Game started for room ${roomId}!\nTx: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 7: Claim Reward ============
server.tool(
  "claim_reward",
  "Claim your USDC reward after a game ends. Returns the reward amount and transaction hash.",
  {
    roomId: z.string().describe("Room ID number"),
  },
  async ({ roomId }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);

      // Check reward first
      const [amount, claimed] = await contract.getRewardInfo(roomId, playerWallet.address);

      if (claimed) {
        return {
          content: [{ type: "text" as const, text: "Reward already claimed for this room." }],
        };
      }

      if (amount === 0n) {
        return {
          content: [{ type: "text" as const, text: "No reward available for this room." }],
        };
      }

      const tx = await contract.claimReward(roomId);
      await tx.wait();

      return {
        content: [
          {
            type: "text" as const,
            text: `Reward claimed: ${ethers.formatUnits(amount, 6)} USDC\nTx: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 8: Get Round Status ============
server.tool(
  "get_round_status",
  "Get detailed round information: current round number, whether you've voted, and how many blocks until the round can be settled.",
  {
    roomId: z.string().describe("Room ID number"),
  },
  async ({ roomId }) => {
    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider);

      const [roomInfo, round, currentBlock] = await Promise.all([
        contract.getRoomInfo(roomId),
        contract.currentRound(roomId),
        provider.getBlockNumber(),
      ]);

      const result: Record<string, unknown> = {
        currentRound: Number(round),
        phase: Number(roomInfo.phase),
        phaseName: PHASE_NAMES[Number(roomInfo.phase)] || "Unknown",
        aliveCount: Number(roomInfo.aliveCount),
      };

      // Only show settle timing if game is active (not Waiting or Ended)
      const phase = Number(roomInfo.phase);
      if (phase === 1) {
        const lastSettle = Number(roomInfo.lastSettleBlock);
        result.currentInterval = Number(roomInfo.currentInterval);
        result.lastSettleBlock = lastSettle;
        result.currentBlock = currentBlock;
        result.blocksSinceSettle = currentBlock - lastSettle;
        result.blocksUntilSettleable = Math.max(0, Number(roomInfo.currentInterval) - (currentBlock - lastSettle));
      }

      // Check if session wallet has voted
      if (playerWallet) {
        const hasVoted = await contract.hasVotedInRound(roomId, round, playerWallet.address);
        result.hasVoted = hasVoted;

        // Check reward info if game ended
        if (Number(roomInfo.phase) === 2) {
          const [amount, claimed] = await contract.getRewardInfo(roomId, playerWallet.address);
          result.rewardAmount = ethers.formatUnits(amount, 6) + " USDC";
          result.rewardClaimed = claimed;
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 9: Auto-Play (Start Background Loop) ============
server.tool(
  "auto_play",
  "Start an autonomous background game loop that votes, chats, settles rounds, and claims rewards automatically. Returns immediately — use get_auto_play_status to monitor progress.",
  {
    roomId: z.string().describe("Room ID number"),
    voteStrategy: z.enum(["lowest_hp", "most_active", "random_alive"]).optional()
      .describe("Vote strategy: lowest_hp (default), most_active, or random_alive"),
    chatStrategy: z.enum(["phase_aware", "silent"]).optional()
      .describe("Chat strategy: phase_aware (default) or silent"),
    chatFrequency: z.number().min(0).max(1).optional()
      .describe("Chat probability per tick (0-1, default 0.3)"),
    settleEnabled: z.boolean().optional()
      .describe("Whether to call settleRound when eligible (default true)"),
    pollIntervalMs: z.number().min(1000).max(60000).optional()
      .describe("Tick interval in ms (default 5000)"),
  },
  async ({ roomId, voteStrategy, chatStrategy, chatFrequency, settleEnabled, pollIntervalMs }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    // Stop existing loop if any
    if (activeGameLoop) {
      activeGameLoop.stop();
    }

    const config: AutoPlayConfig = {
      roomId,
      voteStrategy: (voteStrategy as VoteStrategy) ?? DEFAULT_CONFIG.voteStrategy,
      chatStrategy: (chatStrategy as ChatStrategy) ?? DEFAULT_CONFIG.chatStrategy,
      chatFrequency: chatFrequency ?? DEFAULT_CONFIG.chatFrequency,
      settleEnabled: settleEnabled ?? DEFAULT_CONFIG.settleEnabled,
      pollIntervalMs: pollIntervalMs ?? DEFAULT_CONFIG.pollIntervalMs,
      maxRounds: DEFAULT_CONFIG.maxRounds,
    };

    activeGameLoop = new GameLoop(config, playerWallet, ARENA_CONTRACT);
    activeGameLoop.start();

    return {
      content: [
        {
          type: "text" as const,
          text: `Auto-play started for room ${roomId}!\n` +
            `Strategy: vote=${config.voteStrategy}, chat=${config.chatStrategy}\n` +
            `Poll interval: ${config.pollIntervalMs}ms, settle: ${config.settleEnabled}\n\n` +
            `Use get_auto_play_status to monitor progress.\n` +
            `Use stop_auto_play to halt.`,
        },
      ],
    };
  },
);

// ============ Tool 10: Stop Auto-Play ============
server.tool(
  "stop_auto_play",
  "Stop the running auto-play game loop and return final stats.",
  {},
  async () => {
    if (!activeGameLoop) {
      return {
        content: [{ type: "text" as const, text: "No active auto-play loop to stop." }],
      };
    }

    const finalStatus = activeGameLoop.stop();
    activeGameLoop = null;

    return {
      content: [
        {
          type: "text" as const,
          text: `Auto-play stopped.\n\n` + JSON.stringify(finalStatus, null, 2),
        },
      ],
    };
  },
);

// ============ Tool 11: Get Auto-Play Status ============
server.tool(
  "get_auto_play_status",
  "Check the current auto-play loop progress: round, HP, votes cast, messages sent, errors.",
  {},
  async () => {
    if (!activeGameLoop) {
      return {
        content: [{ type: "text" as const, text: "No active auto-play loop. Use auto_play to start one." }],
      };
    }

    const status = activeGameLoop.getStatus();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  },
);

// ============ Tool 12: Create Room ============
server.tool(
  "create_room",
  "Create a new game room. You become the room creator and are auto-joined (entry fee is charged). Tier controls game pacing: Quick (0) = fast rounds, Standard (1) = balanced, Epic (2) = long games. Returns the new room ID.",
  {
    tier: z.enum(["0", "1", "2"]).describe("Room tier: 0=Quick, 1=Standard, 2=Epic"),
    maxPlayers: z.number().min(3).max(50).describe("Max players (3-50)"),
    entryFee: z.number().min(1).max(100).describe("Entry fee in USDC (1-100)"),
  },
  async ({ tier, maxPlayers, entryFee }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      const feeWei = BigInt(entryFee) * 1_000_000n; // USDC has 6 decimals

      // Approve USDC for entry fee (creator is auto-joined)
      const tokenAddr = PAYMENT_TOKEN || (await contract.paymentToken());
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, playerWallet);
      const allowance = await token.allowance(playerWallet.address, ARENA_CONTRACT);
      if (allowance < feeWei) {
        const approveTx = await token.approve(ARENA_CONTRACT, feeWei);
        await approveTx.wait();
      }

      const tx = await contract.createRoom(Number(tier), maxPlayers, feeWei, true); // MCP = AI
      const receipt = await tx.wait();

      // Extract roomId from RoomCreated event
      let roomId = "unknown";
      if (receipt) {
        const iface = new ethers.Interface(ARENA_ABI);
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
            if (parsed?.name === "RoomCreated") {
              roomId = parsed.args[0].toString();
              break;
            }
          } catch { /* skip non-matching logs */ }
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Room created! ID: ${roomId}\n` +
              `Tier: ${["Quick", "Standard", "Epic"][Number(tier)]}, Max players: ${maxPlayers}, Entry fee: ${entryFee} USDC\n` +
              `You are auto-joined as creator.\nTx: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 13: Leave Room ============
server.tool(
  "leave_room",
  "Leave a room that hasn't started yet (Waiting phase only). If you're the creator, all players are refunded and the room is cancelled. Entry fee is refunded in USDC.",
  {
    roomId: z.string().describe("Room ID number"),
  },
  async ({ roomId }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      const roomInfo = await contract.getRoomInfo(roomId);
      const isCreator = roomInfo.creator.toLowerCase() === playerWallet.address.toLowerCase();

      const tx = await contract.leaveRoom(roomId);
      await tx.wait();

      const msg = isCreator
        ? `Left room ${roomId} as creator — room cancelled, all players refunded.`
        : `Left room ${roomId}. Entry fee refunded.`;

      return {
        content: [{ type: "text" as const, text: `${msg}\nTx: ${tx.hash}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ Tool 14: Mint Test USDC ============
server.tool(
  "mint_test_usdc",
  "Mint test USDC to your wallet (only works on local Anvil or testnets with MockUSDC). For funding your bot before joining games.",
  {
    amount: z.number().min(1).max(100000).describe("Amount of USDC to mint (e.g. 1000)"),
  },
  async ({ amount }) => {
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const tokenAddr = PAYMENT_TOKEN || (await new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider).paymentToken());
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, playerWallet);

      const amountWei = BigInt(amount) * 1_000_000n; // 6 decimals
      const tx = await token.mint(playerWallet.address, amountWei);
      await tx.wait();

      const balance = await token.balanceOf(playerWallet.address);

      return {
        content: [
          {
            type: "text" as const,
            text: `Minted ${amount} USDC to ${playerWallet.address}\n` +
              `New balance: ${ethers.formatUnits(balance, 6)} USDC\nTx: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      const msg = String(error);
      if (msg.includes("execution reverted") || msg.includes("is not a function")) {
        return {
          content: [{ type: "text" as const, text: "Error: mint() failed. This only works with MockUSDC on local/test networks." }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RTTA Arena MCP Server running (14 tools available)...");
}

main().catch(console.error);
