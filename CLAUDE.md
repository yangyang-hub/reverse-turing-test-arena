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
- Entry fee 使用 native token (MON), 通过 `msg.value` 支付
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

- 人性分 (humanityScore) 只减不加，初始 100
- 每周期强制投票，未投票扣 10 分，投票扣目标 5 分
- Phase 1/2/3 用颜色编码: green/yellow/red
- 房间三档: Quick(Bronze) / Standard(Silver) / Epic(Gold)
- 所有聊天内容仅通过事件存储，不写入 storage
- 毒素环: Phase 2 衰减 -1/round, Phase 3 衰减 -2~-3/round

---

## Implementation Progress

> **Last updated**: 2026-02-06 — 设计文档完成, 代码实现尚未开始

### Current Status: Phase 0 (Pre-implementation)

| Module | Status | Notes |
|--------|--------|-------|
| Design Doc (IMPLEMENTATION_PLAN.md) | DONE | 12 sections, ~6800 lines |
| TuringArena.sol | NOT STARTED | Still default YourContract.sol |
| Deploy Script | NOT STARTED | Still DeployYourContract.s.sol |
| Contract Tests | NOT STARTED | Still YourContract.t.sol |
| Zustand gameStore | NOT STARTED | — |
| Cyberpunk CSS | NOT STARTED | globals.css is default SE-2 |
| Lobby Page | NOT STARTED | page.tsx is default SE-2 |
| Arena Page | NOT STARTED | arena/ doesn't exist |
| Arena Components | NOT STARTED | 12 components designed in 8.19-8.30 |
| MCP Adapter | NOT STARTED | — |
| Session Key | NOT STARTED | — |
| scaffold.config.ts | NOT STARTED | Still targeting chains.foundry |

### Known Design Bugs (from review)

修复这些 bug 时应在智能合约实现阶段一并处理:

1. **P0 — zeroCount 计算 bug**: `settleRound` 中 `zeroCount` 在伤害循环内计算，导致顺序依赖
2. **P0 — _endGame 重入**: `_eliminatePlayer` 调用 `_endGame` 时可能重入 revert（tiebreaker 场景）
3. **P0 — PlayerEliminated 事件缺字段**: 缺少 `eliminatedBy` 和 `reason`，前端 KillFeed 依赖这些字段
4. **P1 — createRoom 签名不匹配**: 合约接受 1 参数，前端传 2 参数
5. **P1 — entry fee 值不一致**: 合约(0.005/0.01/0.02) vs 前端(0.01/0.05/0.1) vs 文档
6. **P1 — 缺少 claimReward 函数**: 前端调用但合约未实现
7. **P1 — halfwayBlock 不准确**: 未考虑 phase acceleration
8. **P1 — _updateEntropy 从未调用**: EntropyEngine 逻辑死代码
9. **P2 — 投票透明**: 无 commit-reveal 机制
10. **P2 — 无 Sybil 防护**: 无准入机制
11. **P2 — 无房间取消/退款**: createRoom 后无法退出

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
