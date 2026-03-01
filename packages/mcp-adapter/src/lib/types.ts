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
