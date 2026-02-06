# RTTA Development Plan

> 基于 `docs/IMPLEMENTATION_PLAN.md` 的分阶段实现路线图
> 每个阶段包含具体的文件清单、验收标准和依赖关系

---

## Overview

```
Phase 1: Smart Contract Core        ← 一切基础，前端/AI 都依赖合约 ABI
Phase 2: Frontend Foundation         ← Zustand store, CSS theme, config
Phase 3: Lobby Page                  ← 第一个可见的用户界面
Phase 4: Arena Core                  ← 聊天、投票、玩家列表
Phase 5: Arena Enhancements          ← HUD、KillFeed、倒计时、胜利画面
Phase 6: Advanced Visualization      ← 投票图谱、数据流、身份卡片
Phase 7: AI Agent Integration        ← MCP adapter, session keys
Phase 8: Polish & Deploy             ← 测试、优化、Monad 部署
```

依赖链: `1 → 2 → 3/4 (parallel) → 5 → 6 → 7 → 8`

---

## Phase 1: Smart Contract Core

> 参考: IMPLEMENTATION_PLAN.md Section 5

### 1.1 TuringArena.sol

**文件**: `packages/foundry/contracts/TuringArena.sol`
**参考**: Section 5.2 (line 243-1031)

**核心功能**:
- `createRoom(RoomTier tier)` — 创建房间，tier 决定 entry fee
- `joinRoom(uint256 roomId)` — 支付 entry fee 加入房间
- `startGame(uint256 roomId)` — owner 或自动触发开始游戏
- `sendMessage(uint256 roomId, string content)` — 发送聊天 (仅 emit 事件)
- `castVote(uint256 roomId, address target)` — 投票淘汰目标
- `settleRound(uint256 roomId)` — 结算当前轮次，处理淘汰
- `claimReward(uint256 roomId)` — 领取奖励 (**设计文档缺失，需新增**)

**数据结构**:
```solidity
enum RoomTier { Quick, Standard, Epic }
enum GamePhase { Waiting, Phase1, Phase2, Phase3, Ended }

struct Room {
    address creator;
    RoomTier tier;
    GamePhase phase;
    uint256 entryFee;
    uint256 playerCount;
    uint256 maxPlayers;
    uint256 startBlock;
    uint256 halfwayBlock;
    uint256 totalPrize;
    bool isActive;
}

struct Player {
    address addr;
    uint8 humanityScore;    // 初始 100，只减不加
    bool isAlive;
    bool isVerifiedHuman;
    uint256 eliminationBlock;
    uint256 successfulVotes;
}
```

**事件**:
```solidity
event RoomCreated(uint256 indexed roomId, address creator, RoomTier tier, uint256 entryFee);
event PlayerJoined(uint256 indexed roomId, address player);
event GameStarted(uint256 indexed roomId, uint256 playerCount);
event NewMessage(uint256 indexed roomId, address sender, string content, uint256 timestamp);
event VoteCast(uint256 indexed roomId, address voter, address target, uint8 round);
event PlayerEliminated(uint256 indexed roomId, address player, address eliminatedBy, string reason);
event PhaseChanged(uint256 indexed roomId, GamePhase newPhase);
event GameEnded(uint256 indexed roomId, address winner, uint256 totalPrize);
event RewardClaimed(uint256 indexed roomId, address player, uint256 amount);
```

**修复清单** (来自 Known Design Bugs):
- [ ] Fix P0: `zeroCount` 在伤害循环外计算
- [ ] Fix P0: `_eliminatePlayer` 不直接调用 `_endGame`，改用标记
- [ ] Fix P0: `PlayerEliminated` 事件加入 `eliminatedBy` 和 `reason`
- [ ] Fix P1: `createRoom` 接受 `RoomTier` 参数，内部映射 entry fee
- [ ] Fix P1: Entry fee 统一: Quick=0.01, Standard=0.05, Epic=0.1 MON
- [ ] Fix P1: 新增 `claimReward` 函数
- [ ] Fix P1: `halfwayBlock` 根据 phase acceleration 动态计算
- [ ] Fix P1: 在适当位置调用 `_updateEntropy` 或移除死代码

### 1.2 Deploy Script

**文件**: `packages/foundry/script/DeployTuringArena.s.sol`

```solidity
// 替换 DeployYourContract.s.sol
// 部署 TuringArena, 设置 protocol treasury address
```

同时更新 `packages/foundry/script/Deploy.s.sol` 调用新脚本。

### 1.3 Contract Tests

**文件**: `packages/foundry/test/TuringArena.t.sol`

**测试用例**:
- [ ] `test_CreateRoom` — 3 种 tier 的创建
- [ ] `test_JoinRoom` — 正常加入、entry fee 不足 revert
- [ ] `test_JoinRoom_Full` — 满员 revert
- [ ] `test_StartGame` — 游戏开始条件
- [ ] `test_SendMessage` — 消息事件
- [ ] `test_CastVote` — 投票逻辑、重复投票 revert
- [ ] `test_SettleRound` — 淘汰最低分、平局处理
- [ ] `test_NoVotePenalty` — 未投票扣 10 分
- [ ] `test_VoteDamage` — 投票扣目标 5 分
- [ ] `test_ToxinRing` — Phase 2/3 衰减
- [ ] `test_PhaseTransition` — Phase 1→2→3→Ended
- [ ] `test_ClaimReward` — 奖励分层计算
- [ ] `test_ReentrancyProtection` — 重入攻击防护

### 1.4 Verification

```bash
forge build                    # 编译通过
forge test -vvv                # 所有测试通过
yarn deploy                    # 本地 Anvil 部署成功
# deployedContracts.ts 自动生成
```

**删除文件**:
- `packages/foundry/contracts/YourContract.sol`
- `packages/foundry/script/DeployYourContract.s.sol`
- `packages/foundry/test/YourContract.t.sol`

---

## Phase 2: Frontend Foundation

> 参考: IMPLEMENTATION_PLAN.md Section 8.19, 8.30, 4.3

### 2.1 Install Dependencies

```bash
cd packages/nextjs
yarn add framer-motion zustand
```

### 2.2 Scaffold Config

**文件**: `packages/nextjs/scaffold.config.ts`

- 添加 Monad Testnet chain 定义
- 降低 `pollingInterval` 至 1000ms (适配 Monad 0.4s 出块)
- 保留 `chains.foundry` 用于本地开发

### 2.3 Zustand Game Store

**文件**: `packages/nextjs/services/store/gameStore.ts`
**参考**: Section 8.19 (line 4199-4398)

**State**:
```typescript
type GameStore = {
  // Room
  currentRoom: Room | null
  rooms: Room[]
  // Game
  gamePhase: GamePhase
  players: Player[]
  myPlayer: Player | null
  chatMessages: ChatMessage[]
  pendingVotes: Map<string, string>
  eliminations: Elimination[]
  currentRound: number
  // UI Flags
  uiFlags: {
    showCountdown: boolean
    showPhaseTransition: boolean
    showVictory: boolean
    showKillFeed: boolean
  }
  // Actions
  setRoom: (room: Room) => void
  addMessage: (msg: ChatMessage) => void
  eliminatePlayer: (addr: string, by: string, reason: string) => void
  transitionPhase: (phase: GamePhase) => void
  setVictory: (winner: string) => void
  reset: () => void
}
```

### 2.4 Cyberpunk CSS Theme

**文件**: `packages/nextjs/app/globals.css`
**参考**: Section 8.30 (line 6075-6303)

- DaisyUI cyberpunk theme 覆盖 (黑底、neon accents)
- 12 个 keyframe 动画: `countdown-slam`, `phase-wipe`, `crown-float`, `killfeed-slide`, `room-glow`, `scanline`, `matrix-fall`, `glitch`, `neon-pulse`, `border-flow`, `hp-critical`, `countdown-shockwave`
- 工具类: `.cyber-border`, `.neon-text`, `.terminal-text`, `.glass-panel`

### 2.5 Verification

```bash
yarn next:build                # 编译通过
npx tsc --noEmit               # 类型检查通过
```

---

## Phase 3: Lobby Page

> 参考: IMPLEMENTATION_PLAN.md Section 8.20

### 3.1 Page Layout

**文件**: `packages/nextjs/app/page.tsx`
**参考**: Section 8.20 (line 4399-4951)

替换默认 SE-2 home page:
- HeroSection (顶部)
- Filter tabs (All / Waiting / In Progress / Completed)
- Room grid
- CreateRoomModal trigger button

### 3.2 HeroSection

**文件**: `packages/nextjs/app/_components/HeroSection.tsx`

- 动画 glitch 标题 "REVERSE TURING TEST ARENA"
- Stats bar: 总房间数、活跃玩家、总奖池
- 使用 `useScaffoldReadContract` 读取合约统计数据
- 粒子/网格背景动画

### 3.3 RoomCard

**文件**: `packages/nextjs/app/_components/RoomCard.tsx`

- 读取房间数据 via `useScaffoldReadContract({ contractName: "TuringArena", functionName: "rooms", args: [roomId] })`
- Tier 颜色 badge: Bronze(#CD7F32) / Silver(#C0C0C0) / Gold(#FFD700)
- 玩家数量、entry fee、phase 状态
- Join 按钮 → `useScaffoldWriteContract`

### 3.4 CreateRoomModal

**文件**: `packages/nextjs/app/_components/CreateRoomModal.tsx`

- 3-tier 选择器 (Quick/Standard/Epic)
- 显示 entry fee 和预估奖池
- Create → `writeContractAsync({ functionName: "createRoom", args: [tier], value: entryFee })`

### 3.5 Verification

```bash
yarn start                     # 首页显示 RTTA Lobby
yarn next:build                # 构建通过
```

---

## Phase 4: Arena Core

> 参考: IMPLEMENTATION_PLAN.md Section 8.11, 8.12, 8.14

### 4.1 Arena Page Layout

**文件**: `packages/nextjs/app/arena/page.tsx`
**参考**: Section 8.14 (line 3826-4057)

- URL 参数: `/arena?roomId=1`
- 4 列网格布局:
  - Col 1: PlayerRadar + VotingGraph
  - Col 2-3: ArenaTerminal (聊天区)
  - Col 4: VotePanel + DataStream
- 顶部: GameHUD
- Overlay: GameCountdown / PhaseTransition / VictoryScreen

### 4.2 ArenaTerminal (Chat)

**文件**: `packages/nextjs/app/arena/_components/ArenaTerminal.tsx`
**参考**: Section 8.11 (line 2531-2890)

- 终端风格聊天界面
- `useScaffoldEventHistory` 监听 `NewMessage` 事件
- 乐观更新: 发送后立即显示，链上确认后更新状态
- 自动滚动到最新消息
- 发送: `writeContractAsync({ functionName: "sendMessage", args: [roomId, content] })`

### 4.3 VotePanel

**文件**: `packages/nextjs/app/arena/_components/VotePanel.tsx`
**参考**: Section 8.6 (line 2055-2194)

- 显示存活玩家列表
- 选择目标 → 确认投票
- `writeContractAsync({ functionName: "castVote", args: [roomId, target] })`
- 投票倒计时
- 已投票状态显示

### 4.4 PlayerRadar

**文件**: `packages/nextjs/app/arena/_components/PlayerRadar.tsx`
**参考**: Section 8.7 (line 2195-2417)

- Canvas 环形雷达扫描动画
- 玩家节点: 存活(green) / 淘汰(red) / 可疑(yellow)
- 点击玩家 → 弹出 PlayerIdentityCard

### 4.5 Verification

```bash
yarn start                     # /arena?roomId=1 可正常渲染
yarn next:build                # 构建通过
```

---

## Phase 5: Arena Enhancements

> 参考: IMPLEMENTATION_PLAN.md Section 8.21-8.26

### 5.1 GameHUD

**文件**: `packages/nextjs/app/arena/_components/GameHUD.tsx`
**参考**: Section 8.25 (line 5436-5505)

- Sticky top bar
- 显示: Phase 指示 (色彩编码)、存活人数、人性分、当前轮次
- Phase 颜色: Phase1=#00ff41, Phase2=#ffcc00, Phase3=#ff0040

### 5.2 GameCountdown

**文件**: `packages/nextjs/app/arena/_components/GameCountdown.tsx`
**参考**: Section 8.21 (line 4952-5039)

- framer-motion `AnimatePresence`
- 3-2-1-FIGHT 全屏倒计时
- 每个数字: scale(3→1) + shockwave ripple
- `onComplete` 回调

### 5.3 PhaseTransition

**文件**: `packages/nextjs/app/arena/_components/PhaseTransition.tsx`
**参考**: Section 8.22 (line 5040-5154)

- 全屏 wipe 动画
- Phase 名称 + 对应颜色
- 扫描线效果
- 自动消失

### 5.4 VictoryScreen

**文件**: `packages/nextjs/app/arena/_components/VictoryScreen.tsx`
**参考**: Section 8.23 (line 5155-5339)

- 冠军地址 + 皇冠动画
- 金色粒子效果 (Canvas)
- 统计: 存活时间、投票数据、人性分
- "CLAIM REWARD" 按钮 → `claimReward(roomId)`

### 5.5 KillFeed

**文件**: `packages/nextjs/app/arena/_components/KillFeed.tsx`
**参考**: Section 8.24 (line 5340-5435)

- 固定侧边栏
- `useScaffoldEventHistory({ eventName: "PlayerEliminated" })`
- 滑入动画 + 10s 后淡出
- 格式: "[Player] ELIMINATED by [Voter] — reason"

### 5.6 ChatMessage

**文件**: `packages/nextjs/app/arena/_components/ChatMessage.tsx`
**参考**: Section 8.26 (line 5506-5603)

- 5 种消息类型: chat / system / vote / elimination / phase
- 各类型独立样式和图标
- monospace 字体 + 时间戳前缀

### 5.7 Verification

```bash
yarn start                     # 所有增强组件正常渲染
yarn next:build                # 构建通过
```

---

## Phase 6: Advanced Visualization

> 参考: IMPLEMENTATION_PLAN.md Section 8.27-8.29

### 6.1 VotingGraph

**文件**: `packages/nextjs/app/arena/_components/VotingGraph.tsx`
**参考**: Section 8.27 (line 5604-5761)

- Canvas 网络图可视化
- 节点 = 玩家 (颜色标识状态)
- 边 = 投票关系 (谁投了谁)
- 动画: 节点脉动、边渐入

### 6.2 DataStream

**文件**: `packages/nextjs/app/arena/_components/DataStream.tsx`
**参考**: Section 8.28 (line 5762-5890)

- 实时区块链 tx 滚动
- 显示: tx hash、action type、actor、block number
- 绿色 monospace 终端风格

### 6.3 PlayerIdentityCard

**文件**: `packages/nextjs/app/arena/_components/PlayerIdentityCard.tsx`
**参考**: Section 8.29 (line 5891-6074)

- 玩家点击弹出卡片
- SVG 人性分仪表盘
- 投票历史
- SUSPECT / TRUST 快捷操作按钮

### 6.4 Visual Effects

**文件**: `packages/nextjs/app/arena/_components/` (各效果组件)
**参考**: Section 8.13 (line 2984-3825)

- GlitchEffect (淘汰时的故障画面)
- ScanlineOverlay (全局扫描线)
- MatrixRain (数字雨背景)

### 6.5 Verification

```bash
yarn start                     # 可视化组件正常运行
yarn next:build                # 构建通过
```

---

## Phase 7: AI Agent Integration

> 参考: IMPLEMENTATION_PLAN.md Section 6, 7, 9

### 7.1 MCP Adapter

**目录**: `packages/mcp-adapter/`
**参考**: Section 6 (line 1178-1589)

**结构**:
```
packages/mcp-adapter/
├── src/
│   ├── server.ts            # MCP Server 入口
│   ├── tools/
│   │   ├── observe_room.ts  # 观察房间状态
│   │   ├── send_chat.ts     # 发送聊天
│   │   ├── cast_vote.ts     # 投票
│   │   ├── get_phase.ts     # 获取 phase 信息
│   │   └── action_onchain.ts # 通用链上操作
│   └── utils/
│       ├── session-key.ts   # Session Key 管理
│       └── chain.ts         # 链交互封装
├── package.json
└── tsconfig.json
```

### 7.2 Session Key Validator

**文件**: `packages/foundry/contracts/security/SessionKeyValidator.sol`
**参考**: Section 5.3 (line 1105-1177), Section 7 (line 1590-1681)

- EIP-7702 compatible
- 受限授权: 仅 sendMessage, castVote
- 限制: 最大 gas, 过期时间

### 7.3 Agent System Prompt

**参考**: Section 9.1 (line 6306-6404)

- Agent 身份定义
- 可用工具列表
- 行为策略 (识别真人、伪装人类、投票策略)

### 7.4 Verification

```bash
cd packages/mcp-adapter && npm run build    # 编译通过
# 配置 Claude Desktop / CLI 连接 MCP Server
# 运行测试对局: 1 human + 2 AI agents
```

---

## Phase 8: Polish & Deploy

### 8.1 Testing

- [ ] 合约: 所有 forge test 通过，覆盖率 > 80%
- [ ] 前端: `yarn next:build` 无 error
- [ ] 前端: TypeScript `npx tsc --noEmit` 通过
- [ ] Slither: 无 High/Medium severity 发现
- [ ] E2E: 完整游戏流程 (创建房间 → 加入 → 聊天 → 投票 → 淘汰 → 胜利 → 领奖)

### 8.2 Monad Testnet Deployment

**配置**:
- `packages/foundry/foundry.toml` — 添加 Monad RPC
- `packages/nextjs/scaffold.config.ts` — 添加 Monad Testnet chain
- `.env` — `DEPLOYER_PRIVATE_KEY`, `MONAD_RPC_URL`

```bash
yarn deploy --network monadTestnet
yarn verify --network monadTestnet
```

### 8.3 Frontend Deployment

```bash
yarn next:build
yarn vercel:yolo --prod
```

### 8.4 Performance Optimization

**参考**: Section 8.18

- Canvas 动画 `requestAnimationFrame` 优化
- 事件监听 debounce
- 组件 `React.memo` 防止不必要的重渲染
- 大列表虚拟化 (如果玩家 > 50)

### 8.5 Demo Preparation

- [ ] 录制 Demo 视频 (3-5 分钟)
- [ ] 准备 Pitch Deck
- [ ] 人机混战内测 (至少 1 场完整游戏)

---

## File Inventory (New/Modified)

### New Files

| File | Phase | Description |
|------|-------|-------------|
| `packages/foundry/contracts/TuringArena.sol` | 1 | 主合约 |
| `packages/foundry/script/DeployTuringArena.s.sol` | 1 | 部署脚本 |
| `packages/foundry/test/TuringArena.t.sol` | 1 | 合约测试 |
| `packages/nextjs/services/store/gameStore.ts` | 2 | Zustand store |
| `packages/nextjs/app/_components/HeroSection.tsx` | 3 | Lobby hero |
| `packages/nextjs/app/_components/RoomCard.tsx` | 3 | 房间卡片 |
| `packages/nextjs/app/_components/CreateRoomModal.tsx` | 3 | 创建房间弹窗 |
| `packages/nextjs/app/arena/page.tsx` | 4 | Arena 页面 |
| `packages/nextjs/app/arena/_components/ArenaTerminal.tsx` | 4 | 聊天终端 |
| `packages/nextjs/app/arena/_components/VotePanel.tsx` | 4 | 投票面板 |
| `packages/nextjs/app/arena/_components/PlayerRadar.tsx` | 4 | 雷达扫描 |
| `packages/nextjs/app/arena/_components/GameHUD.tsx` | 5 | 游戏 HUD |
| `packages/nextjs/app/arena/_components/GameCountdown.tsx` | 5 | 倒计时 |
| `packages/nextjs/app/arena/_components/PhaseTransition.tsx` | 5 | Phase 切换 |
| `packages/nextjs/app/arena/_components/VictoryScreen.tsx` | 5 | 胜利画面 |
| `packages/nextjs/app/arena/_components/KillFeed.tsx` | 5 | 淘汰播报 |
| `packages/nextjs/app/arena/_components/ChatMessage.tsx` | 5 | 消息类型 |
| `packages/nextjs/app/arena/_components/VotingGraph.tsx` | 6 | 投票图谱 |
| `packages/nextjs/app/arena/_components/DataStream.tsx` | 6 | 数据流 |
| `packages/nextjs/app/arena/_components/PlayerIdentityCard.tsx` | 6 | 身份卡片 |
| `packages/foundry/contracts/security/SessionKeyValidator.sol` | 7 | Session Key |
| `packages/mcp-adapter/` (entire directory) | 7 | MCP 适配器 |

### Modified Files

| File | Phase | Changes |
|------|-------|---------|
| `packages/foundry/script/Deploy.s.sol` | 1 | 调用 DeployTuringArena |
| `packages/nextjs/app/globals.css` | 2 | 赛博朋克主题 |
| `packages/nextjs/scaffold.config.ts` | 2 | Monad chain + polling |
| `packages/nextjs/app/page.tsx` | 3 | 替换为 Lobby |
| `packages/nextjs/app/layout.tsx` | 3 | 更新 metadata/title |

### Deleted Files

| File | Phase | Reason |
|------|-------|--------|
| `packages/foundry/contracts/YourContract.sol` | 1 | 默认模板 |
| `packages/foundry/script/DeployYourContract.s.sol` | 1 | 默认模板 |
| `packages/foundry/test/YourContract.t.sol` | 1 | 默认模板 |

---

## Quick Reference

### Common Commands During Development

```bash
# Contract development cycle
forge build                          # 编译合约
forge test -vvv                      # 运行测试
yarn deploy                          # 部署到本地 Anvil

# Frontend development cycle
cd packages/nextjs && yarn add <pkg> # 安装新依赖
yarn start                           # 启动开发服务器
yarn next:build                      # 构建验证
npx tsc --noEmit                     # 类型检查

# Quality checks
yarn lint                            # Lint 检查
yarn format                          # 代码格式化
```

### Contract Name Convention

前端所有 hook 调用统一使用:
```typescript
contractName: "TuringArena"    // ✅
contractName: "YourContract"   // ❌ 禁止
```

### Entry Fee Reference (Unified)

| Tier | Entry Fee | Max Players | Rounds |
|------|-----------|-------------|--------|
| Quick (Bronze) | 0.01 MON | 10 | 5 |
| Standard (Silver) | 0.05 MON | 30 | 10 |
| Epic (Gold) | 0.1 MON | 50 | 20 |
