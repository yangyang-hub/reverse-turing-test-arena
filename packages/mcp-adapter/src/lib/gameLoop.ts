import { ethers } from "ethers";
import { getArenaContract } from "./contracts.js";
import { pickVoteTarget, pickChatMessage, randomDelay, sleep } from "./strategies.js";
import { PHASE_NAMES } from "./types.js";
import type { AutoPlayConfig, AutoPlayStatus, PlayerState, RoomState, ChatMessage, VoteRecord } from "./types.js";

/**
 * GameLoop 类 - 自动玩游戏的后台循环
 *
 * 负责自动执行游戏操作：投票、聊天、结算轮次、领取奖励
 * 按照配置的轮询间隔定期执行 tick() 函数
 */
export class GameLoop {
  // ============ 私有属性 ============

  private config: AutoPlayConfig; // 自动玩配置
  private wallet: ethers.Wallet; // 玩家钱包（用于签名交易）
  private provider: ethers.Provider; // 区块链提供者（用于查询状态）
  private arenaAddress: string; // 竞技场合约地址
  private intervalId: ReturnType<typeof setInterval> | null = null; // 定时器 ID
  private ticking = false; // 防护标志：防止 tick 重叠执行

  private status: AutoPlayStatus; // 自动玩状态
  private recentErrors: string[] = []; // 最近的错误列表
  private chatHistory: ChatMessage[] = []; // 聊天历史记录
  private voteHistory: VoteRecord[] = []; // 投票历史记录
  private stopped = false; // 停止标志
  private log: (msg: string) => void; // 日志函数

  /**
   * 构造函数
   * @param config - 自动玩配置
   * @param wallet - 玩家钱包
   * @param arenaAddress - 竞技场合约地址
   * @param log - 可选的自定义日志函数
   */
  constructor(
    config: AutoPlayConfig,
    wallet: ethers.Wallet,
    arenaAddress: string,
    log?: (msg: string) => void,
  ) {
    this.config = config;
    this.wallet = wallet;
    this.provider = wallet.provider!; // 从钱包获取提供者
    this.arenaAddress = arenaAddress;
    // 使用自定义日志函数或默认输出到 stderr
    this.log = log ?? ((msg: string) => process.stderr.write(`[GameLoop] ${msg}\n`));

    // 初始化状态
    this.status = {
      running: false, // 初始未运行
      roomId: config.roomId,
      round: 0, // 初始轮次
      phase: 0, // 初始阶段（等待）
      phaseName: "Waiting",
      humanityScore: 100, // 初始人性分
      isAlive: true, // 初始存活
      votesThisGame: 0, // 本游戏投票计数
      messagesThisGame: 0, // 本游戏消息计数
      settlesThisGame: 0, // 本游戏结算计数
      chatHistory: [], // 聊天历史
      voteHistory: [], // 投票历史
      errors: [], // 错误列表
      startedAt: Date.now(), // 开始时间
      lastTickAt: 0, // 最后 tick 时间
    };
  }

  /**
   * 启动自动玩游戏循环
   * @returns 当前状态
   */
  start(): AutoPlayStatus {
    // 如果已经在运行，直接返回当前状态
    if (this.intervalId) return this.getStatus();

    this.stopped = false; // 重置停止标志
    this.status.running = true; // 设置运行状态
    this.status.startedAt = Date.now(); // 记录开始时间
    this.log(`Starting auto-play for room ${this.config.roomId}`);

    // 立即执行第一次 tick，然后按配置间隔定时执行
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.config.pollIntervalMs);

    return this.getStatus();
  }

  /**
   * 停止自动玩游戏循环
   * @returns 最终状态
   */
  stop(): AutoPlayStatus {
    this.stopped = true; // 设置停止标志
    if (this.intervalId) {
      clearInterval(this.intervalId); // 清除定时器
      this.intervalId = null;
    }
    this.status.running = false; // 设置未运行状态
    this.log("Auto-play stopped");
    return this.getStatus();
  }

  /**
   * 获取当前状态
   * @returns 当前状态的副本（包含最近 10 个错误、完整聊天和投票历史）
   */
  getStatus(): AutoPlayStatus {
    return {
      ...this.status,
      chatHistory: [...this.chatHistory],
      voteHistory: [...this.voteHistory],
      errors: [...this.recentErrors].slice(-10),
    };
  }

  /**
   * Tick 函数 - 每次轮询执行的核心逻辑
   *
   * 执行流程：
   * 1. 读取房间状态
   * 2. 验证玩家在房间内
   * 3. 游戏结束 → 领取奖励 → 停止
   * 4. 游戏未开始 → 等待
   * 5. 读取自己的玩家信息
   * 6. 已淘汰 → 等待游戏结束
   * 7. 获取所有玩家状态用于策略
   * 8. 如果本轮未投票 → 投票
   * 9. 可能发送聊天消息（遵守每轮 3 条限制）
   * 10. 可能结算轮次
   * 11. 检查最大轮次数限制
   */
  private async tick(): Promise<void> {
    // 防止重叠执行或已停止
    if (this.ticking || this.stopped) return;
    this.ticking = true; // 设置防护标志
    this.status.lastTickAt = Date.now(); // 记录本次 tick 时间

    const tickTime = new Date().toISOString();
    this.log(`\n🔄 [${tickTime}] Tick #${Math.floor((this.status.lastTickAt - this.status.startedAt) / this.config.pollIntervalMs)}`);

    try {
      // 创建合约实例
      const contract = getArenaContract(this.arenaAddress, this.wallet);
      const myAddr = this.wallet.address;

      // ========== 步骤 1: 读取房间状态 ==========
      this.log(`📡 RPC: getRoomInfo/getAllPlayers/currentRound`);
      const [roomInfo, playerAddresses, round] = await Promise.all([
        contract.getRoomInfo(this.config.roomId), // 房间信息
        contract.getAllPlayers(this.config.roomId), // 所有玩家地址
        contract.currentRound(this.config.roomId), // 当前轮次
      ]);
      this.log(`✅ RPC: Round ${round.toString()}, Phase ${roomInfo.phase.toString()}`);

      // 解析房间信息
      const room = this.parseRoomInfo(roomInfo);
      this.status.phase = room.phase;
      this.status.phaseName = room.phaseName;
      this.status.round = Number(round);

      // ========== 步骤 1.5: 验证自己在房间内 ==========
      const isInRoom = (playerAddresses as string[]).some(
        p => p.toLowerCase() === myAddr.toLowerCase(),
      );
      if (!isInRoom) {
        this.log("ERROR: Not in room. Use match_room or create_room first.");
        this.stop(); // 停止自动玩
        return;
      }

      // ========== 步骤 2: 游戏结束 → 领取奖励 → 停止 ==========
      if (room.isEnded || room.phase === 2) {
        this.log(`Game ended at round ${this.status.round}`);
        await this.tryClaim(contract); // 尝试领取奖励
        this.stop(); // 停止自动玩
        return;
      }

      // ========== 步骤 3: 游戏未开始（等待阶段） ==========
      if (room.phase === 0) {
        return; // 什么都不做，等待游戏开始
      }

      // ========== 步骤 4: 读取自己的玩家信息 ==========
      this.log(`📡 RPC: getPlayerInfo (my address)`);
      const myInfo = await contract.getPlayerInfo(this.config.roomId, myAddr);
      this.status.humanityScore = Number(myInfo.humanityScore);
      this.status.isAlive = myInfo.isAlive;
      this.log(`👤 My status: HP=${this.status.humanityScore}, Alive=${myInfo.isAlive}`);

      // ========== 步骤 5: 已淘汰 → 等待游戏结束 ==========
      if (!myInfo.isAlive) {
        this.log("💀 Eliminated, waiting for game to end...");
        return; // 什么都不做，等待游戏结束
      }

      // ========== 步骤 6: 获取所有玩家状态用于策略 ==========
      this.log(`📡 RPC: getAllPlayerInfos (${playerAddresses.length} players)`);
      const playerInfos = await Promise.all(
        (playerAddresses as string[]).map((addr: string) =>
          contract.getPlayerInfo(this.config.roomId, addr),
        ),
      );
      // 构建玩家状态数组
      const players: PlayerState[] = playerInfos.map((p: ethers.Result) => ({
        address: p.addr,
        humanityScore: Number(p.humanityScore),
        isAlive: p.isAlive,
        isAI: p.isAI,
        actionCount: Number(p.actionCount),
        successfulVotes: Number(p.successfulVotes),
      }));

      // ========== 步骤 7: 如果本轮未投票 → 投票 ==========
      this.log(`📡 RPC: hasVotedInRound`);
      const hasVoted = await contract.hasVotedInRound(
        this.config.roomId,
        round,
        myAddr,
      );
      if (!hasVoted) {
        this.log(`🗳️ Not voted yet, attempting to vote...`);
        await this.tryVote(contract, players, myAddr, myInfo.isAI);
      } else {
        this.log(`✅ Already voted this round`);
      }

      // ========== 步骤 8: 可能发送聊天消息（遵守每轮 3 条限制） ==========
      if (
        this.config.chatStrategy !== "silent" && // 不是静默模式
        Math.random() < this.config.chatFrequency / 3 // 根据频率概率决定
      ) {
        // 发送前检查消息数
        this.log(`📡 RPC: getMessageCount`);
        const msgCount = await contract.getMessageCount(this.config.roomId, round, myAddr);
        if (Number(msgCount) < 3) { // 每轮最多 3 条
          this.log(`💬 Attempting to send chat (${Number(msgCount)}/3 messages sent)...`);
          await this.tryChat(contract);
        }
      }

      // ========== 步骤 9: 可能结算轮次 ==========
      if (this.config.settleEnabled) {
        await this.trySettle(contract, room);
      }

      // ========== 步骤 10: 安全检查 - 最大轮次限制 ==========
      if (this.status.round >= this.config.maxRounds) {
        this.log(`Max rounds (${this.config.maxRounds}) reached, stopping`);
        this.stop(); // 达到最大轮次，停止自动玩
      }
    } catch (err) {
      this.handleError(err); // 处理错误
    } finally {
      this.ticking = false; // 清除防护标志
    }
  }

  /**
   * 尝试投票
   * @param contract - 合约实例
   * @param players - 所有玩家状态
   * @param myAddr - 自己的地址
   * @param myIsAI - 自己是否为 AI
   */
  private async tryVote(
    contract: ethers.Contract,
    players: PlayerState[],
    myAddr: string,
    myIsAI: boolean,
  ): Promise<void> {
    // 使用策略选择投票目标
    const target = pickVoteTarget(players, myAddr, this.config.voteStrategy, myIsAI);
    if (!target) return; // 没有可选目标

    // 模拟人类延迟：投票前等待 1-4 秒
    await sleep(randomDelay(1000, 4000));

    try {
      this.log(`🗳️  Voting for ${target.slice(0, 8)}... (strategy: ${this.config.voteStrategy})`);
      this.log(`📡 RPC: castVote`);
      const tx = await contract.castVote(this.config.roomId, target);
      this.log(`⏳ Tx submitted: ${tx.hash.slice(0, 10)}..., waiting for confirmation...`);
      const receipt = await tx.wait(); // 等待交易被打包
      this.log(`✅ Vote confirmed! Block: ${receipt?.blockNumber}`);
      this.status.votesThisGame++; // 增加投票计数

      // 记录投票历史
      this.voteHistory.push({
        round: this.status.round,
        target,
        timestamp: Date.now(),
        txHash: receipt?.hash,
      });
    } catch (err) {
      const msg = String(err);
      // 良性竞态条件 — 静默跳过
      if (msg.includes("Already voted") || msg.includes("Round not ended")) {
        this.log(`⚠️  Vote skipped: ${msg.split(":")[0]}`);
        return; // 已经投票或轮次未结束，忽略
      }
      if (msg.includes("eliminated") || msg.includes("not active")) {
        this.log(`💀 Eliminated during vote attempt`);
        this.status.isAlive = false; // 已淘汰，更新状态
        return;
      }
      this.log(`❌ Vote failed: ${msg}`);
      throw err; // 其他错误继续抛出
    }
  }

  /**
   * 尝试发送聊天消息
   * @param contract - 合约实例
   */
  private async tryChat(contract: ethers.Contract): Promise<void> {
    const message = pickChatMessage(); // 从消息池随机选择

    // 模拟人类延迟：发送前等待 0.5-2 秒
    await sleep(randomDelay(500, 2000));

    try {
      this.log(`💬  Sending: "${message.slice(0, 50)}${message.length > 50 ? "..." : ""}"`);
      this.log(`📡 RPC: sendMessage`);
      const tx = await contract.sendMessage(this.config.roomId, message);
      this.log(`⏳ Tx submitted: ${tx.hash.slice(0, 10)}..., waiting for confirmation...`);
      const receipt = await tx.wait(); // 等待交易被打包
      this.log(`✅ Message sent! Block: ${receipt?.blockNumber}`);
      this.status.messagesThisGame++; // 增加消息计数

      // 记录聊天历史
      this.chatHistory.push({
        round: this.status.round,
        content: message,
        timestamp: Date.now(),
        txHash: receipt?.hash,
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("Message limit")) {
        this.log(`⚠️  Chat skipped: message limit reached`);
        return; // 消息限制，非致命错误
      }
      if (msg.includes("eliminated") || msg.includes("not active")) {
        this.log(`💀 Eliminated during chat attempt`);
        this.status.isAlive = false; // 已淘汰，更新状态
        return;
      }
      this.log(`❌ Chat failed: ${msg}`);
      throw err; // 其他错误继续抛出
    }
  }

  /**
   * 尝试结算轮次
   * @param contract - 合约实例
   * @param room - 房间状态
   */
  private async trySettle(contract: ethers.Contract, room: RoomState): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber(); // 获取当前区块号
      const blocksSinceSettle = currentBlock - room.lastSettleBlock; // 计算距上次结算的区块数

      // 如果还没到结算间隔，直接返回
      if (blocksSinceSettle < room.currentInterval) return;

      this.log(`Settling round (blocks since last: ${blocksSinceSettle}, interval: ${room.currentInterval})`);
      const tx = await contract.settleRound(this.config.roomId);
      await tx.wait(); // 等待交易被打包
      this.status.settlesThisGame++; // 增加结算计数
    } catch (err) {
      const msg = String(err);
      // "Round not ended yet" 是正常的竞态条件
      if (msg.includes("Round not ended") || msg.includes("not active")) {
        return; // 轮次未结束，忽略
      }
      throw err; // 其他错误继续抛出
    }
  }

  /**
   * 尝试领取奖励
   * @param contract - 合约实例
   */
  private async tryClaim(contract: ethers.Contract): Promise<void> {
    try {
      // 查询奖励信息
      const [amount, claimed] = await contract.getRewardInfo(
        this.config.roomId,
        this.wallet.address,
      );
      if (amount > 0n && !claimed) {
        // 有奖励且未领取
        this.log(`Claiming reward: ${ethers.formatUnits(amount, 6)} USDC`);
        const tx = await contract.claimReward(this.config.roomId);
        await tx.wait(); // 等待交易被打包
        this.log("Reward claimed!");
      } else if (claimed) {
        this.log("Reward already claimed"); // 已领取
      } else {
        this.log("No reward to claim"); // 无奖励
      }
    } catch (err) {
      this.log(`Claim failed: ${err}`); // 领取失败
    }
  }

  /**
   * 解析房间信息
   * @param info - 合约返回的原始房间信息
   * @returns 解析后的房间状态
   */
  private parseRoomInfo(info: ethers.Result): RoomState {
    return {
      id: info.id.toString(),
      phase: Number(info.phase),
      phaseName: PHASE_NAMES[Number(info.phase)] ?? "Unknown",
      entryFee: info.entryFee,
      prizePool: info.prizePool,
      maxPlayers: Number(info.maxPlayers),
      playerCount: Number(info.playerCount),
      aliveCount: Number(info.aliveCount),
      humanCount: Number(info.humanCount),
      aiCount: Number(info.aiCount),
      isActive: info.isActive,
      isEnded: info.isEnded,
      currentInterval: Number(info.currentInterval),
      lastSettleBlock: Number(info.lastSettleBlock),
      startBlock: Number(info.startBlock),
    };
  }

  /**
   * 处理错误
   * @param err - 错误对象
   */
  private handleError(err: unknown): void {
    const msg = String(err);

    // 记录错误到stderr，便于调试
    console.error(`\n❌ [GameLoop] Error at ${new Date().toISOString()}:`);
    console.error(`   Message: ${msg.slice(0, 200)}${msg.length > 200 ? "..." : ""}`);

    // ===== 致命错误 — 停止循环 =====
    if (msg.includes("insufficient funds") || msg.includes("nonce too low")) {
      this.log(`💀 Fatal error: ${msg}`);
      this.recentErrors.push(msg.slice(0, 200));
      this.status.errors = [...this.recentErrors];
      this.stop(); // 停止自动玩
      return;
    }

    // ===== 瞬态错误 — 记录并下次重试 =====
    // 检测特定错误类型
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION")) {
      this.log(`⚠️  RPC Error (will retry): ${msg.slice(0, 100)}...`);
    } else if (msg.includes("50/second request limit")) {
      this.log(`⚠️  Rate limit exceeded, will retry...`);
      // 注意：不能在非async函数中await，下次轮询会自动等待
    } else {
      this.log(`⚠️  Tick error (will retry): ${msg.slice(0, 100)}...`);
    }

    this.recentErrors.push(msg.slice(0, 200));
    // 保持错误列表在合理大小（最多 20 个，最后 10 个）
    if (this.recentErrors.length > 20) {
      this.recentErrors = this.recentErrors.slice(-10);
    }
    this.status.errors = [...this.recentErrors];
  }
}
