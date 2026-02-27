// ============ 投票策略类型 ============
// lowest_hp: 投票给人性分最低的敌方玩家
// most_active: 投票给最活跃的敌方玩家
// random_alive: 随机投票给一个存活的敌方玩家
export type VoteStrategy = "lowest_hp" | "most_active" | "random_alive";

// ============ 聊天策略类型 ============
// phase_aware: 根据游戏阶段发送聊天消息（默认）
// silent: 静默模式，不发送任何聊天消息
export type ChatStrategy = "phase_aware" | "silent";

// ============ 自动玩配置类型 ============
export type AutoPlayConfig = {
  roomId: string; // 房间 ID
  voteStrategy: VoteStrategy; // 投票策略
  chatStrategy: ChatStrategy; // 聊天策略
  chatFrequency: number; // 聊天频率（0-1，每次 tick 发送消息的概率）
  settleEnabled: boolean; // 是否在满足条件时调用 settleRound
  pollIntervalMs: number; // 轮询间隔（毫秒）
  maxRounds: number; // 最大轮次数（安全限制，自动停止）
};

// ============ 聊天记录类型 ============
export type ChatMessage = {
  round: number; // 轮次号
  content: string; // 消息内容
  timestamp: number; // 发送时间（Unix 时间戳，毫秒）
  txHash?: string; // 交易哈希（可选）
};

// ============ 投票记录类型 ============
export type VoteRecord = {
  round: number; // 轮次号
  target: string; // 投票目标地址
  timestamp: number; // 投票时间（Unix 时间戳，毫秒）
  txHash?: string; // 交易哈希（可选）
};

// ============ 自动玩状态类型 ============
export type AutoPlayStatus = {
  running: boolean; // 是否正在运行
  roomId: string; // 房间 ID
  round: number; // 当前轮次
  phase: number; // 游戏阶段（0=等待, 1=进行中, 2=已结束）
  phaseName: string; // 阶段名称
  humanityScore: number; // 当前人性分
  isAlive: boolean; // 是否存活
  votesThisGame: number; // 本游戏已投票数
  messagesThisGame: number; // 本游戏已发送消息数
  settlesThisGame: number; // 本游戏已结算轮次数
  chatHistory: ChatMessage[]; // 聊天历史记录
  voteHistory: VoteRecord[]; // 投票历史记录
  errors: string[]; // 错误列表
  startedAt: number; // 开始时间（Unix 时间戳，毫秒）
  lastTickAt: number; // 最后一次 tick 时间（Unix 时间戳，毫秒）
};

// ============ 玩家状态类型 ============
export type PlayerState = {
  address: string; // 玩家地址
  name: string; // 玩家名称
  humanityScore: number; // 人性分
  isAlive: boolean; // 是否存活
  isAI: boolean; // 是否为 AI（游戏中始终为 false，reveal 后才有真实值）
  actionCount: number; // 行动次数（聊天 + 投票）
  successfulVotes: number; // 成功投票次数（投中淘汰目标的次数）
};

// ============ 房间状态类型 ============
// NOTE: humanCount/aiCount removed — commit-reveal hides identity during gameplay
export type RoomState = {
  id: string; // 房间 ID
  phase: number; // 游戏阶段编号
  phaseName: string; // 游戏阶段名称
  entryFee: bigint; // 入场费（Wei）
  prizePool: bigint; // 奖池（Wei）
  maxPlayers: number; // 最大玩家数
  playerCount: number; // 当前玩家数
  aliveCount: number; // 存活玩家数
  isActive: boolean; // 是否活跃
  isEnded: boolean; // 是否已结束
  currentInterval: number; // 当前结算间隔（区块数）
  lastSettleBlock: number; // 上次结算区块号
  startBlock: number; // 开始区块号
};

// ============ 常量定义 ============

// 游戏阶段名称映射表
export const PHASE_NAMES = ["Waiting", "Active", "Ended"] as const;

// 默认自动玩配置（不含 roomId，由调用时提供）
export const DEFAULT_CONFIG: Omit<AutoPlayConfig, "roomId"> = {
  voteStrategy: "lowest_hp", // 默认投票给人性分最低的敌方
  chatStrategy: "phase_aware", // 默认使用阶段感知聊天策略
  chatFrequency: 0.3, // 每次 tick 有 30% 概率发送消息
  settleEnabled: true, // 启用自动结算
  pollIntervalMs: 10000, // 每 10 秒 tick 一次（降低 RPC 压力）
  maxRounds: 100, // 最多玩 100 轮（安全限制）
};
