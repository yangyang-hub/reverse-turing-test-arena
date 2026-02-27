// 从 Model Context Protocol SDK 导入 MCP 服务器类
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// 导入标准输入输出传输层，用于进程间通信
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// 导入 Zod 库，用于参数验证和类型定义
import { z } from "zod";
// 导入 ethers.js 库，用于与以太坊区块链交互
import { ethers } from "ethers";
// 导入 ABI（应用二进制接口）定义文件，用于合约调用
import { ARENA_ABI, ERC20_ABI } from "./lib/contracts.js";
// 导入游戏循环类，用于自动玩游戏
import { GameLoop } from "./lib/gameLoop.js";
// 导入默认配置和阶段名称常量
import { DEFAULT_CONFIG, PHASE_NAMES } from "./lib/types.js";
// 导入自动玩配置的类型定义
import type { AutoPlayConfig, VoteStrategy, ChatStrategy } from "./lib/types.js";
// 导入链下聊天客户端
import { ChatClient } from "./lib/chatClient.js";

// ============ 全局变量初始化 ============

// 创建 MCP 服务器实例，用于提供 AI Agent 可调用的工具
const server = new McpServer({
  name: "rtta-arena", // 服务器名称
  version: "1.0.0", // 版本号
});

// 创建 RPC 提供者，用于连接区块链节点
// 默认连接 Monad Testnet，可通过 RPC_URL 环境变量覆盖
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://testnet-rpc.monad.xyz");

// ============ 日志工具 ============
// 格式化时间戳
const getTimestamp = () => new Date().toISOString();
// 日志前缀
const logPrefix = (toolName: string, action: string) => `[${getTimestamp()}] [MCP] [${toolName}] ${action}`;
// 成功日志
const logSuccess = (toolName: string, action: string, data?: any) => {
  console.error(`${logPrefix(toolName, action)} ✅ SUCCESS${data ? `: ${JSON.stringify(data)}` : ''}`);
};
// 错误日志
const logError = (toolName: string, action: string, error: any) => {
  console.error(`${logPrefix(toolName, action)} ❌ ERROR: ${error}`);
};
// 调用开始日志
const logCallStart = (toolName: string, action: string, params?: any) => {
  console.error(`${logPrefix(toolName, action)} 🚀 START${params ? `: ${JSON.stringify(params)}` : ''}`);
};
// RPC调用日志
const logRpcCall = (toolName: string, method: string, params?: any) => {
  console.error(`${logPrefix(toolName, 'RPC')} 📡 ${method}${params ? `(${JSON.stringify(params)})` : ''}`);
};
// RPC响应日志
const logRpcResponse = (toolName: string, method: string, success: boolean, data?: any) => {
  const status = success ? '✅' : '❌';
  console.error(`${logPrefix(toolName, 'RPC')} ${status} ${method}${data ? `: ${JSON.stringify(data).slice(0, 100)}...` : ''}`);
};

// ============ 速率限制工具 ============
// 简单的延迟函数
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 速率限制器类
class RateLimiter {
  private lastCall = 0;
  private minInterval: number;

  constructor(reqsPerSecond: number) {
    this.minInterval = 1000 / reqsPerSecond;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    if (timeSinceLastCall < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastCall;
      // Update lastCall BEFORE sleeping to prevent concurrent callers
      // from computing the same short wait time
      this.lastCall = now + waitTime;
      await sleep(waitTime);
    } else {
      this.lastCall = now;
    }
  }
}

// 为测试网RPC创建速率限制器（20 req/s，给其他客户端留配额）
const rpcRateLimiter = new RateLimiter(20);

// 玩家钱包变量（通过 init_session 工具初始化）
// 使用 null 表示钱包尚未初始化
let playerWallet: ethers.Wallet | null = null;

// 当前活跃的游戏循环（同一时间只能有一个自动玩游戏循环）
let activeGameLoop: GameLoop | null = null;

// 合约地址和服务 URL（Monad Testnet 默认值，可通过环境变量覆盖）
const ARENA_CONTRACT = process.env.ARENA_CONTRACT_ADDRESS || "0x7f2c68257d19e79c940f81bf5ceed91f2cac8dda";
const PAYMENT_TOKEN = process.env.PAYMENT_TOKEN_ADDRESS || "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const CHAT_SERVER_URL = process.env.CHAT_SERVER_URL || "http://100.87.45.72:43001";

// 链下聊天客户端（在 init_session 后初始化）
let chatClient: ChatClient | null = null;

// ============ 工具 1: 获取竞技场状态 ============
server.tool(
  "get_arena_status", // 工具名称
  "获取大逃杀房间的实时上下文：房间状态、所有玩家及其人性分、最近聊天记录、当前轮次投票和淘汰历史。在采取行动前使用此工具了解完整的游戏情况。",
  {
    // 参数定义：房间 ID
    roomId: z.string().describe("房间 ID 号"),
  },
  async ({ roomId }) => {
    const toolName = "get_arena_status";
    logCallStart(toolName, `Querying room ${roomId}`);
    try {
      // 创建合约实例，使用只读提供者（不需要签名）
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider);

      // 并行查询房间基本信息、玩家地址列表、当前轮次
      logRpcCall(toolName, "getRoomInfo/getAllPlayers/currentRound", { roomId });
      const [roomInfo, playerAddresses, round] = await Promise.all([
        contract.getRoomInfo(roomId), // 获取房间信息
        contract.getAllPlayers(roomId), // 获取所有玩家地址
        contract.currentRound(roomId), // 获取当前轮次
      ]);
      logRpcResponse(toolName, "getRoomInfo/getAllPlayers/currentRound", true, { round: round.toString() });

      // 从房间起始区块开始查询事件日志
      logRpcCall(toolName, "getBlockNumber");
      const currentBlock = await provider.getBlockNumber();
      logRpcResponse(toolName, "getBlockNumber", true, { currentBlock }); // 获取当前区块号

      // Monad 测试网 RPC 限制：只能查询最近 100 个区块
      // 确定查询范围：最多查询最近 100 个区块
      const fromBlock = Math.max(
        roomInfo.startBlock > 0 ? Number(roomInfo.startBlock) : 0,
        currentBlock - 100
      );

      // 分页查询事件（每次最多 100 个区块）
      const queryEventsInBatches = async <T>(
        filter: any,
        start: number,
        end: number,
        filterName: string
      ): Promise<ethers.EventLog[]> => {
        const allEvents: ethers.EventLog[] = [];
        let currentFrom = start;
        let batchCount = 0;

        logRpcCall(toolName, `queryEventsInBatches(${filterName})`, { start, end, batchSize: 100 });

        while (currentFrom <= end) {
          const currentTo = Math.min(currentFrom + 99, end); // 每次最多 100 个区块
          batchCount++;

          // 速率限制：每次批量查询前等待
          await rpcRateLimiter.wait();

          try {
            const batch = await contract.queryFilter(filter, currentFrom, currentTo);
            allEvents.push(...batch.filter((e): e is ethers.EventLog => "args" in e));
            if (batchCount % 10 === 0) {
              console.error(`${logPrefix(toolName, 'queryEventsInBatches')} 📊 Batch ${batchCount}: found ${allEvents.length} events so far`);
            }
          } catch (err) {
            // 单批次失败不影响其他批次
            logError(toolName, `queryEventsInBatches batch ${currentFrom}-${currentTo}`, err);
          }
          currentFrom = currentTo + 1;
        }

        logRpcResponse(toolName, `queryEventsInBatches(${filterName})`, true, { totalBatches: batchCount, totalEvents: allEvents.length });
        return allEvents;
      };

      // 并行查询事件（两组事件同时查询，总时间减半）
      // 只查询投票和淘汰事件（聊天已移至链下）
      const [voteEvents, elimEvents] = await Promise.all([
        queryEventsInBatches(contract.filters.VoteCast(roomId), fromBlock, currentBlock, "VoteCast"),
        queryEventsInBatches(contract.filters.PlayerEliminated(roomId), fromBlock, currentBlock, "PlayerEliminated"),
      ]);

      // 获取聊天记录（从链下 REST API）
      let chatHistory: { sender: string; content: string; timestamp: number }[] = [];
      if (chatClient) {
        try {
          const chatMessages = await chatClient.getMessages(Number(roomId));
          chatHistory = chatMessages.map((m: any) => ({
            sender: m.sender,
            content: m.content,
            timestamp: Math.floor(new Date(m.createdAt).getTime() / 1000),
          }));
        } catch (chatErr) {
          logError(toolName, "chatClient.getMessages", chatErr);
          // Fallback: return empty chat if chat server unavailable
        }
      }

      // 从事件中提取当前轮次的投票记录
      const currentRound = Number(round); // 当前轮次号
      const currentRoundVotes = voteEvents
        .filter((e): e is ethers.EventLog => "args" in e)
        .filter(e => Number(e.args[3]) === currentRound) // 只保留当前轮次的投票
        .map(e => ({
          voter: e.args[1], // 投票者地址
          target: e.args[2], // 被投票目标地址
        }));

      // 提取完整的淘汰历史记录
      const eliminations = elimEvents
        .filter((e): e is ethers.EventLog => "args" in e)
        .map(e => ({
          player: e.args[1], // 被淘汰玩家地址
          eliminatedBy: e.args[2], // 淘汰该玩家的地址
          reason: e.args[3], // 淘汰原因
          finalScore: Number(e.args[4]), // 最终人性分
        }));

      // 并行获取每个玩家的详细信息 + 名称（替代顺序循环）
      logRpcCall(toolName, "getPlayerInfo (parallel) + getRoomPlayerNames", { playerCount: playerAddresses.length });
      const [playerInfos, playerNames] = await Promise.all([
        Promise.all(
          (playerAddresses as string[]).map(async (addr: string) => {
            await rpcRateLimiter.wait();
            return contract.getPlayerInfo(roomId, addr);
          })
        ),
        (async () => {
          await rpcRateLimiter.wait();
          return contract.getRoomPlayerNames(roomId);
        })(),
      ]);
      const names = playerNames as string[];
      logRpcResponse(toolName, "getPlayerInfo (parallel) + names", true, { playerCount: playerInfos.length });

      // 格式化玩家信息，提取关键字段
      const formattedPlayers = playerInfos.map((p: ethers.Result, idx: number) => ({
        address: p.addr, // 玩家地址
        name: names[idx] || "", // 玩家名称
        humanityScore: Number(p.humanityScore), // 人性分
        isAlive: p.isAlive, // 是否存活
        // NOTE: isAI 在游戏中始终为 false（commit-reveal 隐藏身份），仅 reveal 后有真实值
        isAI: p.isAI, // 是否为 AI
        actionCount: Number(p.actionCount), // 行动次数
        successfulVotes: Number(p.successfulVotes), // 成功投票次数（投中淘汰目标的次数）
      }));

      // 检查是否所有存活玩家都已投票（仅在游戏进行阶段）
      let allVoted = false;
      if (Number(roomInfo.phase) === 1) { // 阶段 1 表示游戏进行中
        allVoted = await contract.allAliveVoted(roomId); // 查询合约状态
      }

      // 返回结构化的房间状态数据
      logSuccess(toolName, `Retrieved room ${roomId}`, {
        phase: PHASE_NAMES[Number(roomInfo.phase)],
        playerCount: formattedPlayers.length,
        chatMessages: chatHistory.length,
        votes: currentRoundVotes.length
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                // 房间基本信息
                room: {
                  id: roomInfo.id.toString(), // 房间 ID
                  phase: Number(roomInfo.phase), // 阶段编号（0=等待, 1=进行中, 2=已结束）
                  phaseName: PHASE_NAMES[Number(roomInfo.phase)] || "Unknown", // 阶段名称
                  entryFee: ethers.formatUnits(roomInfo.entryFee, 6) + " USDC", // 入场费
                  prizePool: ethers.formatUnits(roomInfo.prizePool, 6) + " USDC", // 奖池
                  maxPlayers: Number(roomInfo.maxPlayers), // 最大玩家数
                  playerCount: Number(roomInfo.playerCount), // 当前玩家数
                  aliveCount: Number(roomInfo.aliveCount), // 存活玩家数
                  // NOTE: humanCount/aiCount removed — commit-reveal hides identity
                  currentRound: currentRound, // 当前轮次
                  isActive: roomInfo.isActive, // 是否活跃
                  isEnded: roomInfo.isEnded, // 是否已结束
                },
                players: formattedPlayers, // 玩家列表
                recentChat: chatHistory.slice(-20), // 最近 20 条聊天记录
                currentRoundVotes, // 当前轮次的投票记录
                eliminations, // 淘汰历史
                allAliveVoted: allVoted, // 是否所有存活玩家都已投票
              },
              null,
              2, // JSON 格式化缩进
            ),
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      logError(toolName, "Failed to retrieve arena status", error);
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 2: 执行链上操作 ============
server.tool(
  "action_onchain", // 工具名称
  "执行链上操作：CHAT（发送消息）或 VOTE（投票淘汰）。",
  {
    // 参数定义
    type: z.enum(["CHAT", "VOTE"]).describe("操作类型：CHAT 或 VOTE"),
    roomId: z.string().describe("房间 ID 号"),
    content: z.string().optional().describe("聊天消息内容（CHAT 操作必需，最多 280 字符）"),
    target: z.string().optional().describe("投票目标地址（VOTE 操作必需）"),
  },
  async ({ type, roomId, content, target }) => {
    const toolName = "action_onchain";
    logCallStart(toolName, `${type} in room ${roomId}`, { content, target });

    // 检查钱包是否已初始化
    if (!playerWallet) {
      logError(toolName, "Wallet not initialized", null);
      return {
        content: [{ type: "text" as const, text: "Error: Wallet not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 创建合约实例，使用玩家钱包作为签名者（可以发送交易）
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);

      // 强制执行渠道独占：MCP 只能为 AI 玩家执行操作
      // NOTE: 合约中 isAI 在游戏中始终为 false（commit-reveal），
      // 所以通过 chat-server identity API 验证身份
      if (chatClient) {
        try {
          const identityRes = await fetch(`${CHAT_SERVER_URL}/api/rooms/${roomId}/identity/${playerWallet.address}`, {
            headers: { Authorization: `Bearer ${await chatClient["ensureAuth"]()}` },
          });
          if (identityRes.ok) {
            const identity = await identityRes.json();
            if (!identity.isAI) {
              logError(toolName, "Channel exclusivity failed - player is Human (from chat-server)", null);
              return {
                content: [{ type: "text" as const, text: "Error: You joined this room as a Human (via browser). MCP actions are disabled — use the web UI to play." }],
                isError: true,
              };
            }
          }
          // If identity check fails, fall through — allow action (operator might not have identity record yet)
        } catch (identityErr) {
          logError(toolName, "Identity check failed (continuing)", identityErr);
          // Non-fatal: if chat-server is down, allow the action
        }
      }

      let tx: ethers.TransactionResponse; // 交易响应对象

      // 根据操作类型执行相应的合约函数
      switch (type) {
        case "CHAT": // 聊天操作 — 走链下 REST API
          if (!content) throw new Error("Content required for CHAT action");
          if (content.length > 280) throw new Error("Message too long (max 280 chars)");
          if (!chatClient) throw new Error("Chat client not initialized. Use init_session first.");
          logRpcCall(toolName, "chatClient.sendMessage", { roomId, content: content.slice(0, 50) + "..." });
          await chatClient.sendMessage(Number(roomId), content);
          logSuccess(toolName, `CHAT sent via REST`);
          return {
            content: [
              {
                type: "text" as const,
                text: `Message sent successfully (off-chain)!`,
              },
            ],
          };

        case "VOTE": // 投票操作
          if (!target) throw new Error("Target address required for VOTE action");
          logRpcCall(toolName, "castVote", { roomId, target });
          tx = await contract.castVote(roomId, target); // 调用合约投票
          break;

        default:
          throw new Error(`Unknown action type: ${type}. Use CHAT or VOTE.`);
      }

      logRpcCall(toolName, "tx.wait", { hash: tx.hash });
      console.error(`${logPrefix(toolName, 'tx.wait')} ⏳ Waiting for transaction confirmation...`);
      await tx.wait(); // 等待交易被打包到区块
      logSuccess(toolName, `Action ${type} executed`, { hash: tx.hash });

      // 返回成功信息
      return {
        content: [
          {
            type: "text" as const,
            text: `Action ${type} executed successfully!\nTx Hash: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      logError(toolName, `Action ${type} failed`, error);
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 3: 检查会话状态 ============
server.tool(
  "check_session_status", // 工具名称
  "检查当前钱包的地址和 USDC 余额。在采取行动前使用此工具验证会话是否处于活跃状态。",
  {}, // 无需参数
  async () => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Session wallet not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 构建结果对象，存储钱包信息
      const result: Record<string, unknown> = {
        address: playerWallet.address, // 钱包地址
      };

      // 检查 ETH 余额（用于支付 gas 费）
      const ethBalance = await provider.getBalance(playerWallet.address);
      result.ethBalance = ethers.formatEther(ethBalance); // 转换为 ETH 单位

      // 检查 USDC 余额（用于支付入场费）
      // 优先使用环境变量中的代币地址，否则从合约查询
      const tokenAddr = PAYMENT_TOKEN || (ARENA_CONTRACT ? await new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider).paymentToken() : null);
      if (tokenAddr) {
        const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider); // 创建 ERC20 代币合约实例
        const balance = await token.balanceOf(playerWallet.address); // 查询余额
        result.usdcBalance = ethers.formatUnits(balance, 6); // USDC 使用 6 位小数
      }

      // 返回格式化的钱包状态信息
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 4: 初始化会话 ============
server.tool(
  "init_session", // 工具名称
  "初始化一个用于游戏的钱包。传入私钥以创建一个钱包，该钱包将签名所有链上操作（聊天、投票、加入等）。",
  {
    privateKey: z.string().describe("用于游戏的钱包私钥（十六进制格式，带或不带 0x 前缀）"),
  },
  async ({ privateKey }) => {
    try {
      // 使用私钥创建钱包实例，并连接到 RPC 提供者
      playerWallet = new ethers.Wallet(privateKey, provider);
      // 初始化链下聊天客户端
      chatClient = new ChatClient(CHAT_SERVER_URL, playerWallet);
      // 查询钱包的 ETH 余额
      const balance = await provider.getBalance(playerWallet.address);

      // 返回钱包初始化成功的信息
      return {
        content: [
          {
            type: "text" as const,
            text: `Wallet initialized!\nAddress: ${playerWallet.address}\nETH Balance: ${ethers.formatEther(balance)}`,
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 5: 结算轮次 ============
server.tool(
  "settle_round", // 工具名称
  "通过结算当前轮次推进游戏。任何人都可以在经过足够的区块后调用此函数。触发淘汰得票最多的玩家。",
  {
    roomId: z.string().describe("房间 ID 号"),
  },
  async ({ roomId }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 创建合约实例
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      // 调用合约的 settleRound 函数结算当前轮次
      const tx = await contract.settleRound(roomId);
      await tx.wait(); // 等待交易被打包

      // 查询结算后的当前轮次
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
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 6: 开始游戏 ============
server.tool(
  "start_game", // 工具名称
  "开始一个处于等待阶段的游戏。只有房间创建者可以调用此函数，且至少需要有 3 名玩家加入。",
  {
    roomId: z.string().describe("房间 ID 号"),
  },
  async ({ roomId }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 创建合约实例
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      // 调用合约的 startGame 函数开始游戏
      const tx = await contract.startGame(roomId);
      await tx.wait(); // 等待交易被打包

      return {
        content: [
          {
            type: "text" as const,
            text: `Game started for room ${roomId}!\nTx: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 7: 领取奖励 ============
server.tool(
  "claim_reward", // 工具名称
  "游戏结束后领取你的 USDC 奖励。返回奖励金额和交易哈希。",
  {
    roomId: z.string().describe("房间 ID 号"),
  },
  async ({ roomId }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 创建合约实例
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);

      // 先查询奖励信息
      const [amount, claimed] = await contract.getRewardInfo(roomId, playerWallet.address);

      // 检查是否已领取
      if (claimed) {
        return {
          content: [{ type: "text" as const, text: "Reward already claimed for this room." }],
        };
      }

      // 检查奖励金额是否为零
      if (amount === 0n) {
        return {
          content: [{ type: "text" as const, text: "No reward available for this room." }],
        };
      }

      // 调用合约的 claimReward 函数领取奖励
      const tx = await contract.claimReward(roomId);
      await tx.wait(); // 等待交易被打包

      return {
        content: [
          {
            type: "text" as const,
            text: `Reward claimed: ${ethers.formatUnits(amount, 6)} USDC\nTx: ${tx.hash}`,
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 8: 获取轮次状态 ============
server.tool(
  "get_round_status", // 工具名称
  "获取详细的轮次信息：当前轮次号、你是否已投票、距离轮次可结算还有多少区块。",
  {
    roomId: z.string().describe("房间 ID 号"),
  },
  async ({ roomId }) => {
    try {
      // 创建合约实例（只读）
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider);

      // 并行查询房间信息、当前轮次、当前区块号
      const [roomInfo, round, currentBlock] = await Promise.all([
        contract.getRoomInfo(roomId),
        contract.currentRound(roomId),
        provider.getBlockNumber(),
      ]);

      // 构建结果对象，存储轮次信息
      const result: Record<string, unknown> = {
        currentRound: Number(round), // 当前轮次
        phase: Number(roomInfo.phase), // 游戏阶段
        phaseName: PHASE_NAMES[Number(roomInfo.phase)] || "Unknown", // 阶段名称
        aliveCount: Number(roomInfo.aliveCount), // 存活玩家数
      };

      // 仅在游戏进行中时显示结算时间信息（不在等待或结束阶段）
      const phase = Number(roomInfo.phase);
      if (phase === 1) { // 阶段 1 表示游戏进行中
        const lastSettle = Number(roomInfo.lastSettleBlock); // 上次结算区块号
        result.currentInterval = Number(roomInfo.currentInterval); // 当前结算间隔（区块数）
        result.lastSettleBlock = lastSettle; // 上次结算区块
        result.currentBlock = currentBlock; // 当前区块
        result.blocksSinceSettle = currentBlock - lastSettle; // 距上次结算已过区块数
        result.blocksUntilSettleable = Math.max(0, Number(roomInfo.currentInterval) - (currentBlock - lastSettle)); // 距可结算还需区块数
      }

      // 检查会话钱包是否已投票
      if (playerWallet) {
        const hasVoted = await contract.hasVotedInRound(roomId, round, playerWallet.address);
        result.hasVoted = hasVoted; // 是否已投票

        // 如果游戏已结束，查询奖励信息
        if (Number(roomInfo.phase) === 2) { // 阶段 2 表示游戏已结束
          const [amount, claimed] = await contract.getRewardInfo(roomId, playerWallet.address);
          result.rewardAmount = ethers.formatUnits(amount, 6) + " USDC"; // 奖励金额
          result.rewardClaimed = claimed; // 是否已领取
        }
      }

      // 返回格式化的轮次状态信息
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 9: 自动玩游戏（启动后台循环） ============
server.tool(
  "auto_play", // 工具名称
  "启动一个自主的后台游戏循环，自动投票、聊天、结算轮次和领取奖励。立即返回 — 使用 get_auto_play_status 监控进度。",
  {
    roomId: z.string().describe("房间 ID 号"),
    voteStrategy: z.enum(["lowest_hp", "most_active", "random_alive"]).optional()
      .describe("投票策略：lowest_hp（最低人性分，默认）、most_active（最活跃）或 random_alive（随机存活者）"),
    chatStrategy: z.enum(["phase_aware", "silent"]).optional()
      .describe("聊天策略：phase_aware（阶段感知，默认）或 silent（静默）"),
    chatFrequency: z.number().min(0).max(1).optional()
      .describe("每次 tick 的聊天概率（0-1，默认 0.3）"),
    settleEnabled: z.boolean().optional()
      .describe("是否在满足条件时调用 settleRound（默认 true）"),
    pollIntervalMs: z.number().min(1000).max(60000).optional()
      .describe("轮询间隔，单位毫秒（默认 10000）"),
  },
  async ({ roomId, voteStrategy, chatStrategy, chatFrequency, settleEnabled, pollIntervalMs }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    // 如果已有活跃的游戏循环，先停止它
    if (activeGameLoop) {
      activeGameLoop.stop();
    }

    // 构建自动玩配置对象，使用提供的参数或默认值
    const config: AutoPlayConfig = {
      roomId,
      voteStrategy: (voteStrategy as VoteStrategy) ?? DEFAULT_CONFIG.voteStrategy, // 投票策略
      chatStrategy: (chatStrategy as ChatStrategy) ?? DEFAULT_CONFIG.chatStrategy, // 聊天策略
      chatFrequency: chatFrequency ?? DEFAULT_CONFIG.chatFrequency, // 聊天频率
      settleEnabled: settleEnabled ?? DEFAULT_CONFIG.settleEnabled, // 是否启用结算
      pollIntervalMs: pollIntervalMs ?? DEFAULT_CONFIG.pollIntervalMs, // 轮询间隔
      maxRounds: DEFAULT_CONFIG.maxRounds, // 最大轮次数
    };

    // 创建新的游戏循环实例并启动
    activeGameLoop = new GameLoop(config, playerWallet, ARENA_CONTRACT, undefined, chatClient);
    activeGameLoop.start(); // 启动后台循环

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

// ============ 工具 10: 停止自动玩 ============
server.tool(
  "stop_auto_play", // 工具名称
  "停止正在运行的自动玩游戏循环并返回最终统计信息。",
  {}, // 无需参数
  async () => {
    // 检查是否有活跃的游戏循环
    if (!activeGameLoop) {
      return {
        content: [{ type: "text" as const, text: "No active auto-play loop to stop." }],
      };
    }

    // 停止游戏循环并获取最终状态
    const finalStatus = activeGameLoop.stop();
    activeGameLoop = null; // 清空活跃循环引用

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

// ============ 工具 11: 获取自动玩状态 ============
server.tool(
  "get_auto_play_status", // 工具名称
  "检查当前自动玩游戏循环的进度：轮次、人性分、已投票数、已发送消息数、错误数。",
  {}, // 无需参数
  async () => {
    // 检查是否有活跃的游戏循环
    if (!activeGameLoop) {
      return {
        content: [{ type: "text" as const, text: "No active auto-play loop. Use auto_play to start one." }],
      };
    }

    // 获取游戏循环的当前状态
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

// ============ 工具 12: 创建房间 ============
server.tool(
  "create_room", // 工具名称
  "创建一个新的游戏房间。你成为房间创建者并自动加入（收取入场费）。Tier 控制游戏节奏：Quick (0) = 快速轮次，Standard (1) = 平衡，Epic (2) = 长游戏。返回新房间 ID。",
  {
    tier: z.enum(["0", "1", "2"]).describe("房间等级：0=快速，1=标准，2=史诗"),
    maxPlayers: z.number().min(3).max(50).describe("最大玩家数（3-50）"),
    entryFee: z.number().min(1).max(100).describe("入场费，单位 USDC（1-100）"),
    name: z.string().min(1).max(20).optional().describe("玩家名称（1-20 字符，默认：AI-XXXX）"),
  },
  async ({ tier, maxPlayers, entryFee, name }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 创建合约实例
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      // 检查是否已在房间中
      const activeRoom = await contract.playerActiveRoom(playerWallet.address);
      if (activeRoom > 0n) {
        return {
          content: [{ type: "text" as const, text: `已在房间 #${activeRoom} 中。请先离开或完成游戏再创建新房间。` }],
          isError: true,
        };
      }

      // 将 USDC 金额转换为 Wei（USDC 有 6 位小数）
      const feeWei = BigInt(entryFee) * 1_000_000n;

      // 为入场费批准 USDC（创建者会被自动加入房间）
      const tokenAddr = PAYMENT_TOKEN || (await contract.paymentToken()); // 获取支付代币地址
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, playerWallet); // 创建代币合约实例
      const allowance = await token.allowance(playerWallet.address, ARENA_CONTRACT); // 查询当前授权额度
      if (allowance < feeWei) { // 如果授权额度不足，则进行授权
        const approveTx = await token.approve(ARENA_CONTRACT, feeWei);
        await approveTx.wait();
      }

      // 生成玩家名称（使用提供的名称或默认 AI-XXXX）
      const playerName = name || `AI-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // 通过 chat-server 获取 commitment + operator 签名（commit-reveal 身份隐藏）
      if (!chatClient) {
        return {
          content: [{ type: "text" as const, text: "Error: Chat client not initialized. Use init_session first." }],
          isError: true,
        };
      }
      const joinAuth = await chatClient.getJoinAuth(0, true, maxPlayers); // roomId=0 for create

      // 调用合约的 createRoom 函数创建房间（使用 commitment 隐藏身份）
      const tx = await contract.createRoom(Number(tier), maxPlayers, feeWei, joinAuth.commitment, joinAuth.operatorSig, playerName);
      const receipt = await tx.wait(); // 等待交易被打包并获取收据

      // 从 RoomCreated 事件中提取房间 ID
      let roomId = "unknown";
      if (receipt) {
        const iface = new ethers.Interface(ARENA_ABI); // 创建合约接口实例
        // 遍历交易收据中的所有日志
        for (const log of receipt.logs) {
          try {
            // 尝试解析日志
            const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
            if (parsed?.name === "RoomCreated") { // 找到 RoomCreated 事件
              roomId = parsed.args[0].toString(); // 提取房间 ID（事件第一个参数）
              break;
            }
          } catch { /* 跳过不匹配的日志 */ }
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
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 13: 离开房间 ============
server.tool(
  "leave_room", // 工具名称
  "离开一个尚未开始的房间（仅等待阶段）。如果你是创建者，所有玩家将获得退款并取消房间。入场费以 USDC 退还。",
  {
    roomId: z.string().describe("房间 ID 号"),
  },
  async ({ roomId }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 创建合约实例
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      // 查询房间信息
      const roomInfo = await contract.getRoomInfo(roomId);
      // 检查当前钱包是否为房间创建者（地址比较忽略大小写）
      const isCreator = roomInfo.creator.toLowerCase() === playerWallet.address.toLowerCase();

      // 调用合约的 leaveRoom 函数离开房间
      const tx = await contract.leaveRoom(roomId);
      await tx.wait(); // 等待交易被打包

      // 根据是否为创建者返回不同的消息
      const msg = isCreator
        ? `Left room ${roomId} as creator — room cancelled, all players refunded.`
        : `Left room ${roomId}. Entry fee refunded.`;

      return {
        content: [{ type: "text" as const, text: `${msg}\nTx: ${tx.hash}` }],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 14: 铸造测试 USDC ============
server.tool(
  "mint_test_usdc", // 工具名称
  "向你的钱包铸造测试 USDC（仅适用于本地 Anvil 或带有 MockUSDC 的测试网）。用于在加入游戏前为你的机器人提供资金。",
  {
    amount: z.number().min(1).max(100000).describe("要铸造的 USDC 数量（例如 1000）"),
  },
  async ({ amount }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 获取支付代币地址（优先使用环境变量，否则从合约查询）
      const tokenAddr = PAYMENT_TOKEN || (await new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider).paymentToken());
      // 创建代币合约实例
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, playerWallet);

      // 将 USDC 金额转换为 Wei（USDC 有 6 位小数）
      const amountWei = BigInt(amount) * 1_000_000n;
      // 调用代币的 mint 函数铸造代币
      const tx = await token.mint(playerWallet.address, amountWei);
      await tx.wait(); // 等待交易被打包

      // 查询新的余额
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
      // 检查错误类型
      const msg = String(error);
      if (msg.includes("execution reverted") || msg.includes("is not a function")) {
        // 如果是执行回退或函数不存在，说明不是 MockUSDC
        return {
          content: [{ type: "text" as const, text: "Error: mint() failed. This only works with MockUSDC on local/test networks." }],
          isError: true,
        };
      }
      // 其他类型的错误
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 15: 获取游戏历史 ============
server.tool(
  "get_game_history", // 工具名称
  "获取完整的游戏历史：每轮的所有投票、淘汰顺序和游戏结果。最适合在游戏结束后使用或回顾过去的游戏。",
  {
    roomId: z.string().describe("房间 ID 号"),
  },
  async ({ roomId }) => {
    const toolName = "get_game_history";
    logCallStart(toolName, `Querying history for room ${roomId}`);
    try {
      // 创建合约实例（只读）
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, provider);

      // 并行查询房间信息和当前轮次
      logRpcCall(toolName, "getRoomInfo/currentRound", { roomId });
      const [roomInfo, round] = await Promise.all([
        contract.getRoomInfo(roomId),
        contract.currentRound(roomId),
      ]);
      logRpcResponse(toolName, "getRoomInfo/currentRound", true, { round: round.toString() });

      // 确定查询的区块范围
      logRpcCall(toolName, "getBlockNumber");
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = roomInfo.startBlock > 0 ? Number(roomInfo.startBlock) : Math.max(0, currentBlock - 10000);
      logRpcResponse(toolName, "getBlockNumber", true, { currentBlock, fromBlock, blockRange: currentBlock - fromBlock });

      // 分页查询事件（每次最多 100 个区块，规避 Monad RPC 限制）
      const queryEventsInBatches = async (
        filter: any,
        start: number,
        end: number,
        filterName: string
      ): Promise<ethers.EventLog[]> => {
        const allEvents: ethers.EventLog[] = [];
        let currentFrom = start;
        let batchCount = 0;

        logRpcCall(toolName, `queryEventsInBatches(${filterName})`, { start, end, range: end - start });

        while (currentFrom <= end) {
          const currentTo = Math.min(currentFrom + 99, end); // 每次最多 100 个区块
          batchCount++;

          // 速率限制：每次批量查询前等待
          await rpcRateLimiter.wait();

          try {
            const batch = await contract.queryFilter(filter, currentFrom, currentTo);
            allEvents.push(...batch.filter((e): e is ethers.EventLog => "args" in e));
            if (batchCount % 20 === 0) {
              console.error(`${logPrefix(toolName, 'queryEventsInBatches')} 📊 Batch ${batchCount}: found ${allEvents.length} events so far`);
            }
          } catch (err) {
            // 单批次失败不影响其他批次
            logError(toolName, `Query batch ${currentFrom}-${currentTo} failed`, err);
          }
          currentFrom = currentTo + 1;
        }

        logRpcResponse(toolName, `queryEventsInBatches(${filterName})`, true, { totalBatches: batchCount, totalEvents: allEvents.length });
        return allEvents;
      };

      // 串行查询所有投票和淘汰事件（减少并行度，避免速率限制）
      const voteEvents = await queryEventsInBatches(contract.filters.VoteCast(roomId), fromBlock, currentBlock, "VoteCast");
      const elimEvents = await queryEventsInBatches(contract.filters.PlayerEliminated(roomId), fromBlock, currentBlock, "PlayerEliminated");

      // 按轮次分组投票记录
      const rounds: Record<string, { votes: { voter: string; target: string }[]; eliminated: { player: string; eliminatedBy: string; reason: string; finalScore: number } | null }> = {};

      // 遍历投票事件，按轮次分组
      for (const e of voteEvents) {
        if (!("args" in e)) continue;
        const ev = e as ethers.EventLog;
        const r = ev.args[3].toString(); // 轮次号
        if (!rounds[r]) rounds[r] = { votes: [], eliminated: null };
        rounds[r].votes.push({
          voter: ev.args[1], // 投票者
          target: ev.args[2], // 被投票目标
        });
      }

      // 通过区块邻近度将淘汰事件映射到轮次
      for (const e of elimEvents) {
        if (!("args" in e)) continue;
        const ev = e as ethers.EventLog;
        const elimBlock = ev.blockNumber; // 淘汰发生的区块号

        // 通过检查投票事件找到此淘汰属于哪一轮
        let elimRound = "0";
        for (const ve of voteEvents) {
          if (!("args" in ve)) continue;
          const vev = ve as ethers.EventLog;
          if (vev.blockNumber <= elimBlock) {
            elimRound = vev.args[3].toString();
          }
        }

        if (!rounds[elimRound]) rounds[elimRound] = { votes: [], eliminated: null };
        rounds[elimRound].eliminated = {
          player: ev.args[1], // 被淘汰玩家
          eliminatedBy: ev.args[2], // 淘汰者
          reason: ev.args[3], // 淘汰原因
          finalScore: Number(ev.args[4]), // 最终人性分
        };
      }

      // 获取淘汰顺序和游戏统计
      const eliminationOrder = await contract.getEliminationOrder(roomId);

      // 如果游戏已结束，获取游戏统计信息
      let gameStats = null;
      if (roomInfo.isEnded || Number(roomInfo.phase) === 2) { // 阶段 2 表示游戏已结束
        const stats = await contract.getGameStats(roomId);
        gameStats = {
          humansWon: stats.humansWon, // 人类是否获胜
          mvp: stats.mvp, // MVP 地址
          mvpVotes: Number(stats.mvpVotes), // MVP 得票数
        };
      }

      logSuccess(toolName, `Retrieved game history for room ${roomId}`, {
        totalRounds: Number(round),
        voteEvents: voteEvents.length,
        elimEvents: elimEvents.length
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                totalRounds: Number(round), // 总轮次数
                rounds, // 按轮次分组的投票和淘汰记录
                eliminationOrder: (eliminationOrder as string[]), // 淘汰顺序
                gameStats, // 游戏统计信息
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      logError(toolName, "Failed to retrieve game history", error);
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 工具 16: 匹配房间 ============
server.tool(
  "match_room", // 工具名称
  "通过扫描可用房间并加入第一个匹配项来进行匹配进入等待中的房间。检查 AI 插槽可用性（MCP = AI）。如果没有房间匹配，建议使用 create_room。",
  {
    minPlayers: z.number().min(3).max(50).optional().describe("最小房间大小（默认 3）"),
    maxPlayers: z.number().min(3).max(50).optional().describe("最大房间大小（默认 50）"),
    minFee: z.number().min(1).max(100).optional().describe("最小入场费，单位 USDC（默认 1）"),
    maxFee: z.number().min(1).max(100).optional().describe("最大入场费，单位 USDC（默认 100）"),
    tier: z.enum(["0", "1", "2"]).optional().describe("可选的等级过滤器：0=快速，1=标准，2=史诗"),
    name: z.string().min(1).max(20).optional().describe("玩家名称（1-20 字符，默认：AI-XXXX）"),
  },
  async ({ minPlayers, maxPlayers, minFee, maxFee, tier, name }) => {
    // 检查钱包是否已初始化
    if (!playerWallet) {
      return {
        content: [{ type: "text" as const, text: "Error: Session not initialized. Use init_session first." }],
        isError: true,
      };
    }

    try {
      // 创建合约实例
      const contract = new ethers.Contract(ARENA_CONTRACT, ARENA_ABI, playerWallet);
      // 检查是否已在房间中
      const activeRoom = await contract.playerActiveRoom(playerWallet.address);
      if (activeRoom > 0n) {
        return {
          content: [{ type: "text" as const, text: `已在房间 #${activeRoom} 中。请先离开或完成游戏再加入其他房间。` }],
          isError: true,
        };
      }

      // 获取房间总数
      const roomCount = await contract.getRoomCount();
      const total = Number(roomCount);

      // 如果没有房间存在
      if (total === 0) {
        return {
          content: [{ type: "text" as const, text: "No rooms exist yet. Use create_room to create one." }],
        };
      }

      // 设置过滤条件（使用提供的值或默认值）
      const filterMinPlayers = minPlayers ?? 3; // 最小玩家数
      const filterMaxPlayers = maxPlayers ?? 50; // 最大玩家数
      const feeMinWei = BigInt(Math.round((minFee ?? 1) * 1e6)); // 最小费用（转换为 Wei）
      const feeMaxWei = BigInt(Math.round((maxFee ?? 100) * 1e6)); // 最大费用（转换为 Wei）

      // 从最新到最旧扫描房间
      for (let i = total; i >= 1; i--) {
        await rpcRateLimiter.wait(); // 速率限制：每次房间查询前等待
        const roomId = i.toString();
        const roomInfo = await contract.getRoomInfo(roomId);

        // 提取房间信息
        const phase = Number(roomInfo.phase); // 游戏阶段
        const playerCount = Number(roomInfo.playerCount); // 当前玩家数
        const maxP = Number(roomInfo.maxPlayers); // 最大玩家数
        const entryFee = roomInfo.entryFee; // 入场费
        const roomTier = Number(roomInfo.tier); // 房间等级

        // 阶段必须是等待（0）且未满员
        if (phase !== 0 || playerCount >= maxP) continue;

        // 房间大小过滤器
        if (maxP < filterMinPlayers || maxP > filterMaxPlayers) continue;

        // 费用过滤器
        if (entryFee < feeMinWei || entryFee > feeMaxWei) continue;

        // 等级过滤器（如果指定）
        if (tier !== undefined && roomTier !== Number(tier)) continue;

        // NOTE: AI 插槽由 chat-server operator 管理（commit-reveal 方案）
        // 如果 operator 拒绝签名，getJoinAuth 会抛错，无需本地检查

        // 通过 chat-server operator 获取 commitment + 签名授权
        if (!chatClient) {
          return {
            content: [{ type: "text" as const, text: "Error: Chat server not configured (CHAT_SERVER_URL required for commit-reveal join)." }],
            isError: true,
          };
        }
        const joinAuth = await chatClient.getJoinAuth(Number(roomId), true, maxP);

        // 批准 USDC 并加入房间 — 合约通过 playerActiveRoom 强制单房间限制
        const tokenAddr = PAYMENT_TOKEN || (await contract.paymentToken()); // 获取代币地址
        const token = new ethers.Contract(tokenAddr, ERC20_ABI, playerWallet); // 创建代币合约实例
        const allowance = await token.allowance(playerWallet.address, ARENA_CONTRACT); // 查询授权额度
        if (allowance < entryFee) { // 如果授权额度不足，则进行授权
          const approveTx = await token.approve(ARENA_CONTRACT, entryFee);
          await approveTx.wait();
        }

        // 生成玩家名称（使用提供的名称或默认 AI-XXXX）
        const playerName = name || `AI-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        // 调用合约的 joinRoom 函数（commit-reveal: commitment + operatorSig 替代 bool isAI）
        const tx = await contract.joinRoom(roomId, joinAuth.commitment, joinAuth.operatorSig, playerName);
        await tx.wait(); // 等待交易被打包

        return {
          content: [{
            type: "text" as const,
            text: `Matched and joined Room #${roomId}!\n` +
              `Players: ${playerCount + 1}/${maxP}, Fee: ${ethers.formatUnits(entryFee, 6)} USDC\n` +
              `Tier: ${["Quick", "Standard", "Epic"][roomTier]}\nTx: ${tx.hash}`,
          }],
        };
      }

      // 如果没有找到匹配的房间
      return {
        content: [{
          type: "text" as const,
          text: "No rooms match your filters. Use create_room to create one.",
        }],
      };
    } catch (error) {
      // 捕获错误并返回错误信息
      return {
        content: [{ type: "text" as const, text: `Error: ${error}` }],
        isError: true,
      };
    }
  },
);

// ============ 启动服务器 ============
// 主函数：创建传输层并连接服务器
async function main() {
  // 如果设置了 PLAYER_PRIVATE_KEY 环境变量，自动初始化钱包
  const envKey = process.env.PLAYER_PRIVATE_KEY;
  if (envKey) {
    try {
      playerWallet = new ethers.Wallet(envKey, provider);
      chatClient = new ChatClient(CHAT_SERVER_URL, playerWallet);
      console.error(`[AUTO-INIT] Wallet initialized from PLAYER_PRIVATE_KEY: ${playerWallet.address}`);
    } catch (error) {
      console.error(`[AUTO-INIT] Failed to initialize wallet from PLAYER_PRIVATE_KEY: ${error}`);
    }
  }

  const transport = new StdioServerTransport(); // 创建标准输入输出传输层
  await server.connect(transport); // 连接服务器到传输层
  console.error("RTTA Arena MCP Server running (16 tools available)...");
}

// 启动服务器并捕获任何错误
main().catch(console.error);
