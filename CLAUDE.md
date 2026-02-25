# CLAUDE.md

@AGENTS.md

## Project: Reverse Turing Test Arena (RTTA)

RTTA 是一个基于 Monad 并行 EVM 的全链上"图灵大逃杀"博弈场。真人和 AI Agent 混合参与，通过聊天和投票进行社交推理淘汰赛。

### Design Doc

- **核心设计文档**: `docs/IMPLEMENTATION_PLAN.md` (~6800 行)
  - 所有组件设计、合约接口、游戏机制的唯一权威来源
  - 修改前端/合约时务必先参考对应章节，确保实现与设计一致
  - 章节索引: 合约(5)、MCP(6)、Session Key(7)、前端(8.1-8.30)、AI Agent(9)、游戏机制(10)
- **实现计划**: `docs/DEVELOPMENT_PLAN.md` — 分阶段实现路线图 (8 个阶段)

### Smart Contract

- 主合约: `TuringArena.sol` — 包含房间管理、投票、淘汰、分层奖励
- 合约名在前端 hooks 中统一使用 `"TuringArena"` (不是 `"YourContract"`)
- 事件名: `PlayerEliminated`, `VoteCast`, `NewMessage`, `GameEnded`, `RoomCreated`
- Entry fee 使用 USDC (ERC-20, 6 decimals), 通过 `approve + transferFrom` 支付
- `createRoom(RoomTier, uint256 _maxPlayers, uint256 _entryFee)` — custom player count (2-50) and fee (1-10000 USDC)
- MockUSDC.sol: 测试用 USDC mock 合约 (`packages/foundry/contracts/mocks/MockUSDC.sol`)
- 合约架构参考 `docs/IMPLEMENTATION_PLAN.md` Section 5.1

### Frontend Conventions

- 状态管理: `packages/nextjs/services/store/gameStore.ts` (Zustand)
- Lobby 页面: `packages/nextjs/app/page.tsx`
- Arena 页面: `packages/nextjs/app/arena/page.tsx`
- 所有 arena 组件在 `packages/nextjs/app/arena/_components/`
- Lobby 组件在 `packages/nextjs/app/_components/`
- 动画依赖: `framer-motion` (需手动安装: `cd packages/nextjs && yarn add framer-motion`)
- 主题: 赛博朋克风格 — 黑底、霓虹色 (cyan/green/purple/red)、monospace 字体

### Key Rules

- Team-based game: Humans vs AI agents — eliminate the opposing team to win
- Web players = Human tag, MCP players = AI tag (30% AI slot cap enforced)
- Game phases: Waiting → Active → Ended (simplified from 5-phase system)
- 人性分 (humanityScore) 只减不加，初始 100
- 每轮强制投票，未投票自投 -10 分 (VOTE_DAMAGE)，投票扣目标 -10 分
- 每轮最多 3 条消息 (MAX_MESSAGES_PER_ROUND)
- 房间满员自动开始游戏 (auto-start)
- Team win: 所有 AI 被淘汰 → 人类胜; 所有人类被淘汰 → AI 胜; 剩余 2 人 → HP 比较 (平局 AI 胜)
- 奖励分配: 70% 获胜队伍, 10% MVP, 10% 存活, 10% 协议
- 房间三档: Quick(Bronze) / Standard(Silver) / Epic(Gold)
- 所有聊天内容仅通过事件存储，不写入 storage
- Quick 局 baseInterval=100 (Monad ≈ 40s/轮), Standard/Epic=150 (≈ 60s/轮)
- `createRoom(RoomTier, uint256 _maxPlayers, uint256 _entryFee, bool _isAI)` — 4th param: creator is human (web) or AI (MCP)
- `joinRoom(uint256 _roomId, bool _isAI)` — 2nd param: player identity tag

---

## Implementation Progress

> **Last updated**: 2026-02-25 — Quick Match button: auto-scan rooms + join from lobby/landing page

### Current Status: Game Mechanics Overhaul Complete (Team-Based Humans vs AI)

| Module | Status | Notes |
|--------|--------|-------|
| Design Doc (IMPLEMENTATION_PLAN.md) | DONE | 12 sections, ~6800 lines |
| TuringArena.sol | DONE | Team-based Humans vs AI, simplified {Waiting, Active, Ended}, 7:3 ratio, auto-start, 3 msg/round, self-vote -10, 48 tests passing |
| MockUSDC.sol | DONE | Test USDC mock with 6 decimals, public mint |
| Deploy Script | DONE | DeployTuringArena.s.sol — deploys MockUSDC + TuringArena |
| Contract Tests | DONE | 48 test cases, 100% pass (incl. team win, AI slot cap, auto-start, message limit) |
| Zustand gameStore | DONE | gameStore.ts with team-based types (GamePhase: Waiting/Active/Ended, Player.isAI) |
| Cyberpunk CSS | DONE | globals.css with glitch text, cyber-grid-bg, tier/phase classes |
| scaffold.config.ts | DONE | Foundry + Monad Testnet, env-based dev/prod config |
| Landing Page | DONE | page.tsx — HeroSection (with RoleSelector dual-path), How It Works, live stats |
| Lobby Page | DONE | lobby/page.tsx — room browser with filter tabs (All/Waiting/Active/Ended/My Games) |
| Lobby Components | DONE | HeroSection.tsx, RoleSelector.tsx, RoomCard.tsx, CreateRoomModal.tsx |
| Arena Page | DONE | arena/page.tsx with 3-column grid, HUD top bar, Suspense |
| ArenaTerminal | DONE | Terminal chat UI, on-chain messages, 3/round message limit, discussion topics per round |
| VotePanel | DONE | Vote target selection, humanity score bars, castVote flow |
| PlayerRadar | DONE | Player list with AI/Human badges, HP bars, alive/dead status |
| GameHUD | DONE | Sticky top bar with phase/alive/humanity/round |
| GameCountdown | DONE | 3-2-1-FIGHT fullscreen countdown with framer-motion |
| PhaseTransition | DONE | Phase change fullscreen wipe animation |
| VictoryScreen | DONE | Team-based display (HUMANS WIN / AIs WIN), MVP section, claim button |
| KillFeed | DONE | Fixed sidebar elimination notifications |
| ChatMessage | DONE | 5 message types with styled rendering |
| VotingGraph | DONE | Canvas ring-layout network visualization |
| DataStream | DONE | Real-time blockchain tx stream (NewMessage, VoteCast) |
| PlayerIdentityCard | DONE | Modal with SVG humanity gauge, stats, vote button |
| MCP Adapter | DONE | packages/mcp-adapter/ with 14 tools, team-based (MCP=AI, Web=Human), auto-play game loop |
| MCP Auto-Play | DONE | GameLoop class (lib/gameLoop.ts), vote strategies, chat pool, 3 msg/round limit, standalone bot |
| Skills Page | DONE | packages/nextjs/public/skills.md — 14 tools, team-based rules, standalone bot usage |
| Player Alias Utility | DONE | utils/playerAlias.ts — deterministic codenames + colored avatars per room |
| Narrative Flip | DONE | "Spot the AI" instead of "find humans" — landing page + HeroSection |
| In-Game Anonymity | DONE | All 9 arena components use aliases during gameplay, real addresses revealed on game end |
| Discussion Topics | DONE | utils/topics.ts — 30 per-round topics, deterministic by round number |
| Quick Match | DONE | QuickMatchButton.tsx — auto-scan & join waiting rooms, landing page + lobby integration |

### Known Design Bugs (from review)

~~Most P0/P1 bugs were addressed during implementation.~~ Remaining open items:

1. ~~**P0 — zeroCount 计算 bug**~~ (addressed in TuringArena.sol implementation)
2. ~~**P0 — _endGame 重入**~~ (addressed with ReentrancyGuard)
3. ~~**P0 — PlayerEliminated 事件缺字段**~~ (added eliminatedBy field)
4. ~~**P1 — createRoom 签名不匹配**~~ (aligned: contract takes tier enum)
5. ~~**P1 — entry fee 值不一致**~~ (unified in TierConfig)
6. ~~**P1 — 缺少 claimReward 函数**~~ (implemented in contract)
7. ~~**P1 — halfwayBlock 不准确**: 未考虑 phase acceleration~~ (no longer applicable — multi-phase removed)
8. ~~**P1 — _updateEntropy 从未调用**: EntropyEngine was dropped~~ (no longer applicable — removed)
9. **P2 — 投票透明**: 无 commit-reveal 机制 (future enhancement)
10. **P2 — 无 Sybil 防护**: 无准入机制 (future enhancement)
11. ~~**P2 — 无房间取消/退款**: createRoom 后无法退出~~ (implemented: leaveRoom + _cancelRoom with full USDC refund)
12. **P2 — withdrawUnclaimed 无时间限制**: Treasury 可随时提取任意金额，包括未领取的玩家奖励 (future enhancement)
13. ~~**P2 — TierConfig 遗留字段**: minPlayers/maxPlayers/entryFee 不再使用~~ (removed from struct and constructor)

---

## Tooling & MCP Servers

| Tool | Purpose |
|------|---------|
| Context7 MCP | 获取任意库的最新文档 (Wagmi, Viem, DaisyUI, etc.) |
| Foundry MCP | Cast/Anvil/Forge 操作、合约交互、Heimdall 反编译 |
| OpenZeppelin MCP | OZ 合约标准参考 |
| Slither MCP | 智能合约静态分析、安全审计 |

### Available Plugins

- `feature-dev`: 7 阶段引导式功能开发 (`/feature-dev`)
- `code-review`: PR 代码审查 (`/code-review`)
- `commit-commands`: Git 提交 (`/commit`, `/commit-push-pr`)
- `frontend-design`: 高质量前端 UI 生成 (`/frontend-design`)
- `typescript-lsp`: TypeScript 语言服务
- `security-guidance`: 安全指导

---

## MANDATORY: Post-Code Sync Protocol

> **这是硬性约束，不是建议。每次写完或修改代码后，必须立即执行以下同步操作，不得跳过。**

### 触发条件

以下任一操作完成后，必须执行同步:
- 创建新文件
- 修改现有代码文件 (.sol, .tsx, .ts, .css, .json)
- 删除文件
- 安装/移除依赖

### 同步清单 (按顺序执行)

**Step 1 — 更新 CLAUDE.md `Implementation Progress` 表格**
- 将已完成模块的 Status 改为 `DONE` 或 `IN PROGRESS`
- 更新 `Last updated` 日期
- 更新 `Current Status: Phase X` 标题
- 如有新模块/文件，添加新行

**Step 2 — 更新 `Known Design Bugs` 列表**
- 已修复的 bug → 标记 ~~删除线~~ 或移除
- 新发现的 bug → 追加到列表末尾，标注优先级
- 合约接口变更 → 检查前端调用是否需要同步

**Step 3 — 更新 MEMORY.md**
- 路径: `~/.claude/projects/-home-yangyang-workspace-solidity-reverse-turing-test-arena/memory/MEMORY.md`
- 更新 `Current Status` 章节
- 记录关键架构决策和踩过的坑
- 更新 `Recent Changes` 列表

**Step 4 — 验证一致性** (如适用)
- 新增文件 → 检查 `docs/IMPLEMENTATION_PLAN.md` Section 8.2 文件树是否包含
- 合约函数签名变更 → 检查前端 hook 调用参数是否匹配
- 事件字段变更 → 检查前端 `useScaffoldEventHistory` 是否匹配

### 示例

```
# 场景: 完成了 TuringArena.sol 并通过测试

Step 1: CLAUDE.md 表格
  TuringArena.sol       | NOT STARTED → DONE | Passed 13 tests
  Deploy Script         | NOT STARTED → DONE | DeployTuringArena.s.sol
  Contract Tests        | NOT STARTED → DONE | 13 test cases, 100% pass

Step 2: Known Design Bugs
  ~~P0 — zeroCount 计算 bug~~ (已修复)
  ~~P1 — createRoom 签名不匹配~~ (已修复)

Step 3: MEMORY.md
  Current Status: Phase 1 (Smart Contract) → DONE
  Recent Changes: + Implemented TuringArena.sol with 13 test cases

Step 4: 验证
  deployedContracts.ts 已自动生成 ✓
  前端 contractName: "TuringArena" ✓
```
