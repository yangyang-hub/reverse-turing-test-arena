import { ethers } from "ethers";

// ============ ERC-20 代币合约 ABI ============
// 用于代币授权、余额查询、铸造等操作
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)", // 授权指定地址使用代币
  "function allowance(address owner, address spender) view returns (uint256)", // 查询授权额度
  "function balanceOf(address account) view returns (uint256)", // 查询余额
  "function decimals() view returns (uint8)", // 查询代币小数位数
  "function mint(address to, uint256 amount)", // 铸造代币（仅测试用）
];

// ============ TuringArena 竞技场合约 ABI ============
// MCP 适配器使用的完整合约接口
// NOTE: humanCount/aiCount removed from Room struct (commit-reveal hides identity)
// NOTE: isAI removed from events (identity hidden until reveal)
export const ARENA_ABI = [
  // ===== 只读函数 - 结构体查询 =====
  "function getRoomInfo(uint256 roomId) view returns (tuple(uint256 id, address creator, uint8 tier, uint8 phase, uint256 entryFee, uint256 prizePool, uint256 startBlock, uint256 baseInterval, uint256 currentInterval, uint256 maxPlayers, uint256 playerCount, uint256 aliveCount, uint256 eliminatedCount, uint256 lastSettleBlock, bool isActive, bool isEnded))", // 获取房间信息（无 humanCount/aiCount）
  "function getPlayerInfo(uint256 roomId, address player) view returns (tuple(address addr, int256 humanityScore, bool isAlive, bool isAI, uint256 joinBlock, uint256 eliminationBlock, uint256 eliminationRank, uint256 lastActionBlock, uint256 actionCount, uint256 successfulVotes))", // 获取玩家信息（isAI 在游戏中始终为 false）
  "function getGameStats(uint256 roomId) view returns (tuple(bool humansWon, address mvp, uint256 mvpVotes))", // 获取游戏统计信息
  "function getAllPlayers(uint256 roomId) view returns (address[])", // 获取所有玩家地址列表
  "function getRoomCount() view returns (uint256)", // 获取房间总数
  "function paymentToken() view returns (address)", // 获取支付代币地址
  "function operator() view returns (address)", // 获取 operator 地址

  // ===== 只读函数 - 映射查询 =====
  "function currentRound(uint256 roomId) view returns (uint256)", // 获取当前轮次
  "function hasVotedInRound(uint256 roomId, uint256 round, address player) view returns (bool)", // 查询玩家在某轮是否已投票
  "function voteTarget(uint256 roomId, uint256 round, address voter) view returns (address)", // 查询玩家在某轮的投票目标
  "function getRewardInfo(uint256 roomId, address player) view returns (uint256 amount, bool claimed)", // 获取奖励信息
  "function pendingReveal(uint256 roomId) view returns (bool)", // 查询房间是否等待 reveal
  "function identityCommitments(uint256 roomId, address player) view returns (bytes32)", // 查询身份承诺

  // ===== 只读函数 - 辅助查询 =====
  "function getEliminationOrder(uint256 roomId) view returns (address[])", // 获取淘汰顺序
  "function allAliveVoted(uint256 roomId) view returns (bool)", // 查询是否所有存活玩家都已投票
  "function getContractBalance() view returns (uint256)", // 获取合约余额
  "function playerActiveRoom(address player) view returns (uint256)", // 查询玩家当前所在房间
  "function getPlayerName(uint256 roomId, address player) view returns (string)", // 获取玩家名称
  "function getRoomPlayerNames(uint256 roomId) view returns (string[])", // 获取房间所有玩家名称

  // ===== 写入函数 =====
  "function castVote(uint256 roomId, address target)", // 投票
  "function joinRoom(uint256 roomId, bytes32 commitment, bytes operatorSig, string name)", // 加入房间（commitment 隐藏身份）
  "function settleRound(uint256 roomId)", // 结算当前轮次
  "function startGame(uint256 roomId)", // 开始游戏
  "function createRoom(uint8 tier, uint256 maxPlayers, uint256 entryFee, bytes32 commitment, bytes operatorSig, string name) returns (uint256 roomId)", // 创建房间（commitment 隐藏身份）
  "function leaveRoom(uint256 roomId)", // 离开房间
  "function claimReward(uint256 roomId)", // 领取奖励
  "function revealAndEnd(uint256 roomId, address[] players, bool[] isAIs, bytes32[] salts)", // operator reveal 身份并结束游戏
  "function emergencyEnd(uint256 roomId)", // 超时紧急结束

  // ===== 事件 =====
  "event RoomCreated(uint256 indexed roomId, address indexed creator, uint8 tier, uint256 entryFee, uint256 maxPlayers)", // 房间创建事件（无 isAI）
  "event PlayerJoined(uint256 indexed roomId, address indexed player)", // 玩家加入事件（无 isAI）
  "event VoteCast(uint256 indexed roomId, address indexed voter, address indexed target, uint256 round)", // 投票事件
  "event PlayerEliminated(uint256 indexed roomId, address indexed player, address eliminatedBy, string reason, int256 finalScore)", // 玩家淘汰事件
  "event GameEnded(uint256 indexed roomId, bool humansWon, uint256 totalPrize)", // 游戏结束事件
  "event IdentitiesRevealed(uint256 indexed roomId, bool humansWon)", // 身份揭示事件
  "event EmergencyEndTriggered(uint256 indexed roomId)", // 紧急结束事件
];

// ============ 合约工厂辅助函数 ============

// 创建竞技场合约实例
// 参数：合约地址 + 签名者/提供者（用于读写或只读操作）
export function getArenaContract(addressOrProvider: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(addressOrProvider, ARENA_ABI, signerOrProvider);
}

// 创建 ERC20 代币合约实例
// 参数：合约地址 + 签名者/提供者（用于读写或只读操作）
export function getTokenContract(address: string, signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(address, ERC20_ABI, signerOrProvider);
}
