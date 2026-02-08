import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";

// Initialize MCP Server
const server = new McpServer({
  name: "monad-arena",
  version: "1.0.0",
});

// Monad RPC connection
const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz");

// Session Key wallet (initialized via init_session tool)
let sessionWallet: ethers.Wallet | null = null;

// Contract addresses
const ARENA_CONTRACT = process.env.ARENA_CONTRACT_ADDRESS || "";
const SESSION_CONTRACT = process.env.SESSION_CONTRACT_ADDRESS || "";

// TuringArena ABI (subset for MCP tools)
const ARENA_ABI = [
  "function getRoomInfo(uint256 roomId) view returns (uint256 id, address creator, uint8 tier, uint8 phase, uint256 entryFee, uint256 prizePool, uint256 startBlock, uint256 halfwayBlock, uint256 baseInterval, uint256 currentInterval, uint256 maxPlayers, uint256 playerCount, uint256 aliveCount, uint256 eliminatedCount, int256 currentDecay, uint256 lastSettleBlock, bool isActive, bool isEnded)",
  "function getPlayerInfo(uint256 roomId, address player) view returns (address addr, int256 humanityScore, bool isAlive, bool isVerifiedHuman, uint256 joinBlock, uint256 eliminationBlock, uint256 eliminationRank, uint256 lastActionBlock, uint256 actionCount, uint256 successfulVotes)",
  "function getAllPlayers(uint256 roomId) view returns (address[])",
  "function sendMessage(uint256 roomId, string content)",
  "function castVote(uint256 roomId, address target)",
  "function joinRoom(uint256 roomId) payable",
  "event NewMessage(uint256 indexed roomId, address indexed sender, string content, uint256 timestamp)",
  "event VoteCast(uint256 indexed roomId, address indexed voter, address indexed suspect)",
];

// SessionKeyValidator ABI
const SESSION_ABI = [
  "function isSessionValid(address sessionKey) view returns (bool)",
  "function getSessionRemainingTime(address sessionKey) view returns (uint256)",
  "function sessions(address) view returns (address owner, uint256 expiresAt, uint256 maxUsage, uint256 usageCount, bool isRevoked)",
];

// ============ Tool 1: Get Arena Status ============
server.tool(
  "get_arena_status",
  "Get real-time context for a battle royale room (chat history, player suspicion, time remaining)",
  {
    roomId: z.string().describe("Room ID"),
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
      const filter = contract.filters.NewMessage(roomId);
      const events = await contract.queryFilter(filter, Math.max(0, currentBlock - 5000), currentBlock);
      const chatHistory = events.map((e: ethers.EventLog) => ({
        sender: e.args[1],
        content: e.args[2],
        timestamp: Number(e.args[3]),
      }));

      // Get detailed player info
      const playerInfos = await Promise.all(
        (playerAddresses as string[]).map((addr: string) => contract.getPlayerInfo(roomId, addr)),
      );

      const formattedPlayers = playerInfos.map((p: ethers.Result) => ({
        address: p[0],
        humanityScore: Number(p[1]),
        isAlive: p[2],
        isVerifiedHuman: p[3],
        actionCount: Number(p[8]),
        successfulVotes: Number(p[9]),
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                room: {
                  id: roomInfo[0].toString(),
                  phase: Number(roomInfo[3]),
                  prizePool: ethers.formatEther(roomInfo[5]),
                  maxPlayers: Number(roomInfo[10]),
                  playerCount: Number(roomInfo[11]),
                  aliveCount: Number(roomInfo[12]),
                  isActive: roomInfo[16],
                  isEnded: roomInfo[17],
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
  "Execute an on-chain action: chat, vote, or join a room",
  {
    type: z.enum(["CHAT", "VOTE", "JOIN"]).describe("Action type"),
    roomId: z.string().describe("Room ID"),
    content: z.string().optional().describe("Chat message content (required for CHAT, max 280 chars)"),
    target: z.string().optional().describe("Vote target address (required for VOTE)"),
    entryFee: z.string().optional().describe("Entry fee in ETH (required for JOIN)"),
  },
  async ({ type, roomId, content, target, entryFee }) => {
    if (!sessionWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session Key not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, sessionWallet);

      let tx: ethers.TransactionResponse;

      switch (type) {
        case "CHAT":
          if (!content) throw new Error("Content required for CHAT");
          if (content.length > 280) throw new Error("Message too long (max 280 chars)");
          tx = await contract.sendMessage(roomId, content);
          break;

        case "VOTE":
          if (!target) throw new Error("Target address required for VOTE");
          tx = await contract.castVote(roomId, target);
          break;

        case "JOIN":
          if (!entryFee) throw new Error("Entry fee required for JOIN");
          tx = await contract.joinRoom(roomId, {
            value: ethers.parseEther(entryFee),
          });
          break;
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

// ============ Tool 3: Check Session Key Status ============
server.tool("check_session_status", "Check current Session Key remaining time and usage count", {}, async () => {
  if (!sessionWallet) {
    return {
      content: [{ type: "text" as const, text: "Session Key not initialized" }],
      isError: true,
    };
  }

  try {
    const contract = new ethers.Contract(SESSION_CONTRACT, SESSION_ABI, provider);

    const [remaining, session] = await Promise.all([
      contract.getSessionRemainingTime(sessionWallet.address),
      contract.sessions(sessionWallet.address),
    ]);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              sessionKey: sessionWallet.address,
              remainingSeconds: Number(remaining),
              remainingMinutes: Math.floor(Number(remaining) / 60),
              usageCount: Number(session.usageCount),
              maxUsage: Number(session.maxUsage),
              isValid: Number(remaining) > 0 && !session.isRevoked,
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
});

// ============ Tool 4: Initialize Session Key ============
server.tool(
  "init_session",
  "Initialize or update the Session Key wallet for automated gameplay",
  {
    privateKey: z.string().describe("Session Key private key (temporary key)"),
  },
  async ({ privateKey }) => {
    try {
      sessionWallet = new ethers.Wallet(privateKey, provider);
      return {
        content: [
          {
            type: "text" as const,
            text: `Session initialized!\nAddress: ${sessionWallet.address}`,
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Monad Arena MCP Server running...");
}

main().catch(console.error);
