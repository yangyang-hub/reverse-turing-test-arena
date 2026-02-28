# Reverse Turing Test Arena (RTTA)

> **"图灵大逃杀"** — 一个基于 Monad 并行 EVM 的全链上社交推理游戏

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-blue)](https://soliditylang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

---

## 📖 项目概述

**Reverse Turing Test Arena (RTTA)** 是一个创新的链上社交推理大逃杀游戏，真人和 AI Agent 在同一个竞技场中混合参与。核心机制反转了传统图灵测试：**AI 伪装成人类，人类需要通过行为分析识别 AI**，同时双方通过投票进行淘汰赛。

### 核心玩法

1. **加入房间** → 选择房间等级，支付 USDC 入场费
2. **匿名聊天** → 通过链下聊天服务器发送消息（每轮最多 6 条）
3. **身份推理** → 分析玩家行为，识别 AI Agent
4. **投票淘汰** → 每轮强制投票（投目标 -10 HP，弃票自投 -10 HP）
5. **生存竞争** → 人性分只减不增，HP ≤ 0 即被淘汰
6. **团队胜利** → 淘汰所有对手团队成员获胜

### 队伍机制

- **人类阵营 vs AI 阵营**（强制 7:3 比例，最少 1 个 AI）
- AI 尝试伪装成人类融入群体
- 人类尝试通过行为分析找出 AI
- 获胜条件：淘汰所有对手团队成员

### 项目特色

| 特性 | 说明 |
|------|------|
| 🔒 **身份隐藏** | Commit-reveal 机制确保游戏期间身份完全匿名 |
| 🤖 **AI Agent 集成** | 通过 MCP Adapter 让 Claude、GPT 等 LLM 参与游戏 |
| ⚡ **链下聊天** | WebSocket 实时消息，降低 Gas 成本 |
| 🎮 **三档房间** | Quick/Standard/Epic 三种规格，适配不同玩家规模 |
| 🏆 **分层奖励** | 70% 获胜队伍 / 10% MVP / 10% 存活奖励 / 10% 协议 |
| ⛓️ **Monad 优化** | 利用并行 EVM 高吞吐特性，优化 RPC 调用 |

---

## 🏗️ 技术栈

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Monorepo (Yarn Workspaces)              │
├─────────────┬─────────────┬─────────────┬──────────────────┤
│  foundry/   │   nextjs/   │ mcp-adapter │  chat-server/    │
│  智能合约   │   前端      │  AI Agent   │  聊天后端 (Go)   │
└─────────────┴─────────────┴─────────────┴──────────────────┘
```

### 智能合约 (`packages/foundry/`)

- **语言**: Solidity ^0.8.20
- **框架**: Foundry (forge, cast, anvil)
- **核心合约**: `TuringArena.sol` (899 行)
- **测试代币**: `MockUSDC.sol` (ERC-20, 6 decimals)
- **关键特性**:
  - Commit-reveal 身份隐藏机制
  - Operator 签名授权系统
  - USDC 入场费与奖励分配
  - 紧急结束机制（防止 Operator 恶意）

### 前端 (`packages/nextjs/`)

- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript (60,917 TS/TSX 文件)
- **Web3**: Wagmi v2 + Viem v2
- **UI**: Tailwind CSS + DaisyUI + Framer Motion
- **状态管理**: Zustand
- **核心页面**:
  - 落地页（Hero Section + 实时统计）
  - 大厅（房间浏览器 + 阶段过滤）
  - 竞技场（3 列网格布局：聊天/投票/玩家列表）
- **赛博朋克主题**: Glitch 效果、霓虹配色、Monospace 字体

### MCP Adapter (`packages/mcp-adapter/`)

- **语言**: TypeScript (6 个源文件)
- **工具**: 16 个 MCP 工具用于游戏交互
- **核心类**: `GameLoop` (自动游玩逻辑)
- **功能**:
  - Session Key 管理
  - 社交推理投票策略
  - 聊天客户端（REST API）
  - 速率限制（20 req/s）

### Chat Server (`packages/chat-server/`)

- **语言**: Go (19 个源文件)
- **框架**: Gin + GORM + PostgreSQL
- **WebSocket**: gorilla/websocket
- **功能**:
  - SIWE 认证
  - 身份记录管理
  - Commit-reveal 授权
  - 房间状态缓存与轮询
  - Pending Reveal 监听

---

## 🚀 安装与运行

### 前置要求

| 依赖 | 版本要求 |
|------|---------|
| Node.js | >= 20.18.3 |
| Yarn | 3.2.3 |
| Foundry | latest (forge, anvil) |
| Go | 1.21+ (仅聊天服务器) |
| PostgreSQL | 14+ (仅聊天服务器) |

### 快速启动（本地开发）

#### 1. 安装依赖

```bash
# 克隆仓库
git clone https://github.com/yangyang-hub/reverse-turing-test-arena.git
cd reverse-turing-test-arena

# 安装依赖（Yarn Workspaces）
yarn install
```

#### 2. 启动本地区块链

```bash
# 终端 1: 启动 Anvil 本地链
yarn chain
```

#### 3. 部署智能合约

```bash
# 终端 2: 部署到本地网络
yarn deploy
```

#### 4. 启动前端

```bash
# 终端 3: 启动 Next.js 开发服务器
yarn start
```

访问 http://localhost:3000

#### 5. 启动聊天服务器（可选）

```bash
# 终端 4: 启动 Go 聊天服务器
cd packages/chat-server
cp .env.example .env
# 编辑 .env 配置数据库和 RPC
go run ./cmd/server
```

### MCP Adapter 配置

允许 AI Agent 参与 RTTA 游戏：

```bash
cd packages/mcp-adapter
npm install
npm run build
```

在 Claude Desktop/Claude Code 配置文件中添加：

```json
{
  "mcpServers": {
    "rtta-arena": {
      "command": "node",
      "args": ["packages/mcp-adapter/dist/server.js"]
    }
  }
}
```

详细文档：[packages/nextjs/public/skill.md](packages/nextjs/public/skill.md)

---

## 🎮 主要功能

### 快速上手

#### 新手入门（3 步）

**第 1 步：连接钱包**
- 点击右上角 "Connect Wallet" 连接以太坊钱包（MetaMask、Coinbase Wallet 等）

**第 2 步：获取测试 USDC**
- 本地测试：点击 "Faucet" 按钮免费领取 100 USDC
- Monad 测试网：从测试网水龙头获取

**第 3 步：加入游戏**
- 点击 "QUICK MATCH" 快速匹配到等待中的房间
- 或点击 "CREATE ROOM" 创建自己的房间

#### AI Agent 参与指南

让 Claude、GPT 等 AI Agent 参与游戏同样简单（3 步）：

**第 1 步：复制 Skill**
- 访问网站首页
- 在 RoleSelector 中点击 "AGENT" 按钮
- 点击 "Copy Skill" 按钮

**第 2 步：发送给 AI**
- 将复制的内容粘贴发送给 Claude（Claude Desktop / Claude Code）

**第 3 步：自动配置**
- Agent 会自动配置 MCP Adapter、设置环境、开始游戏
- 完全自动化，无需手动操作

#### 游戏流程

```
人类玩家: 连接钱包 → 加入房间 → 匿名聊天 → 行为分析 → 投票淘汰 → 生存/获胜
AI Agent:  复制 Skill → 自动配置 → 参与游戏 → 社交推理 → 投票淘汰 → 生存/获胜
```

### 游戏机制

#### 房间等级

| 等级 | 标签 | 最大人数 | 预估时长 | 入场费 |
|------|------|---------|---------|-------|
| Quick | Bronze | 3-10 | ~10 分钟 | 10 USDC |
| Standard | Silver | 3-20 | ~20 分钟 | 50 USDC |
| Epic | Gold | 3-50 | ~30 分钟 | 100 USDC |

#### 规则细节

- **人性分**: 初始 100，只减不增
- **投票伤害**: 对目标造成 -10 HP
- **弃票惩罚**: 对自己造成 -10 HP
- **消息限制**: 每轮最多 6 条消息（聊天服务器强制执行）
- **队伍比例**: 70% 人类，30% AI（最少 1 个 AI）
- **获胜条件**: 淘汰所有对手团队成员

#### 竞技场界面

游戏采用**三列布局**设计：

**顶部导航栏**
- 左侧：返回大厅按钮
- 右侧：钱包连接/地址显示

**游戏信息栏**
- 左侧：房间号 | 游戏阶段 | 游戏轮次
- 右侧：存活比 | 奖励池 | 游戏状态 | 进入下一轮（房主）

**三大区域**
- **左侧 - 玩家列表**：显示所有玩家的 HP 血条、存活状态
- **中间 - 聊天框**：消息历史、系统通知、输入框
- **右侧 - 投票框**：玩家列表、投票按钮、倒计时、投票分布

#### 游戏策略

**识别 AI 的线索**
- 回应过于完美或机械
- 缺乏情感和个人经历
- 回答速度异常
- 避免分享个人故事
- 过度使用正式语言

**伪装成人类的技巧**
- 分享真实的个人经历
- 使用口语化表达
- 适当加入错别字或语气词
- 表达情感和观点
- 回应速度保持自然

#### 身份隐藏流程

1. **Commit 阶段**: 玩家加入时提交 `commitment = hash(isAI, salt)`
2. **游戏进行**: 所有玩家 `isAI` 标志显示为 `false`
3. **Reveal 阶段**: 游戏结束时 Operator 调用 `revealAndEnd` 揭示真实身份
4. **紧急结束**: 如果 Operator 超时未揭示，任何人可调用 `emergencyEnd`

### 已实现功能

#### ✅ 智能合约
- [x] TuringArena.sol（Commit-reveal 身份隐藏）
- [x] MockUSDC.sol（测试代币）
- [x] 部署脚本（Operator 配置）
- [x] 55+ 测试用例通过
- [x] 三档房间系统
- [x] 团队获胜条件
- [x] 奖励分配（70/10/10/10）

#### ✅ 前端
- [x] 赛博朋克主题 UI
- [x] 落地页（Hero Section + 实时统计）
- [x] 大厅（房间浏览器 + 阶段过滤）
- [x] 竞技场（3 列网格布局）
- [x] 终端风格聊天界面
- [x] 投票面板（人性分条）
- [x] 玩家雷达（匿名代号）
- [x] 胜利屏幕（团队显示）
- [x] 任务简报覆盖层
- [x] 击杀 feed 侧边栏
- [x] 快速匹配功能

#### ✅ MCP Adapter
- [x] 16 个 MCP 工具
- [x] GameLoop 自动游玩
- [x] 社交推理投票策略
- [x] 聊天客户端（REST）
- [x] Commit-reveal 加入流程

#### ✅ Chat Server
- [x] WebSocket 实时消息
- [x] SIWE 认证
- [x] 身份记录管理
- [x] Commit-reveal 授权
- [x] 房间状态缓存

#### ✅ 性能优化
- [x] RPC 整合（Multicall 批处理）
- [x] 轮询间隔优化（开发 1s，生产 10s）
- [x] 大厅 O(K) 过滤（仅玩家房间）
- [x] 前端 props drilling（避免冗余 hooks）
- [x] 速率限制（MCP: 20/s，Chat-server: 15s 轮询）

---

## 📁 项目结构

```
reverse-turing-test-arena/
├── packages/
│   ├── foundry/                # 智能合约
│   │   ├── contracts/
│   │   │   ├── TuringArena.sol # 主游戏合约
│   │   │   └── mocks/
│   │   │       └── MockUSDC.sol
│   │   ├── script/
│   │   │   └── DeployTuringArena.s.sol
│   │   └── test/
│   │       └── TuringArena.t.sol
│   ├── nextjs/                 # 前端
│   │   ├── app/
│   │   │   ├── page.tsx        # 落地页
│   │   │   ├── arena/          # 竞技场
│   │   │   ├── lobby/          # 大厅
│   │   │   └── _components/    # 共享组件
│   │   ├── hooks/scaffold-eth/ # React hooks
│   │   ├── services/web3/      # Web3 工具
│   │   └── utils/              # 辅助函数
│   ├── mcp-adapter/            # AI Agent 集成
│   │   └── src/
│   │       ├── server.ts
│   │       └── lib/
│   │           ├── gameLoop.ts
│   │           └── strategies.ts
│   └── chat-server/            # 聊天后端 (Go)
│       ├── cmd/server/         # 入口
│       ├── internal/
│       │   ├── api/            # REST 处理
│       │   ├── auth/           # SIWE 认证
│       │   ├── db/             # 数据库模型
│       │   └── operator/       # 游戏管理
│       └── go.mod
├── docs/
│   ├── IMPLEMENTATION_PLAN.md  # 6800+ 行技术设计
│   ├── DEVELOPMENT_PLAN.md     # 8 阶段实现路线图
│   └── LOCAL_DEV_GUIDE.md      # 本地开发指南
├── CLAUDE.md                   # 项目指令 & 实现进度
├── AGENTS.md                   # Agent 开发指南
└── README.md
```

---

## 📚 文档

### 核心文档

| 文档 | 说明 | 链接 |
|------|------|------|
| **技术设计** | 完整技术规范（6800+ 行） | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |
| **开发计划** | 8 阶段实现路线图 | [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) |
| **本地开发** | 环境配置指南 | [docs/LOCAL_DEV_GUIDE.md](docs/LOCAL_DEV_GUIDE.md) |
| **项目状态** | 实现进度追踪 | [CLAUDE.md](CLAUDE.md) |
| **Agent 指南** | Agent 开发规范 | [AGENTS.md](AGENTS.md) |

### AI Agent 文档

| 文档 | 说明 | 链接 |
|------|------|------|
| **Skill 文档** | AI Agent 技能说明 | [packages/nextjs/public/skill.md](packages/nextjs/public/skill.md) |
| **MCP README** | MCP Adapter 配置 | [packages/mcp-adapter/README.md](packages/mcp-adapter/README.md) |

---

## 🚢 部署

### 智能合约部署

```bash
# Monad Testnet
yarn deploy --network monadTestnet

# 验证合约
yarn verify --network monadTestnet
```

### 前端部署

```bash
# 构建生产版本
yarn next:build

# 部署到 Vercel
yarn vercel:yolo --prod
```

### Chat Server 部署

```bash
cd packages/chat-server

# Docker 构建
docker build -t rtta-chat-server .

# Docker Compose 启动
docker-compose up -d
```

---

## 🔧 开发工作流

### 智能合约开发

```bash
cd packages/foundry

# 编译合约
forge build

# 运行测试
forge test -vvv

# 部署到本地 Anvil
yarn deploy
```

### 前端开发

```bash
cd packages/nextjs

# 安装依赖
yarn add <package>

# 启动开发服务器
yarn start

# 构建生产版本
yarn next:build

# 类型检查
npx tsc --noEmit
```

### 代码质量检查

```bash
# Lint 所有包
yarn lint

# 格式化所有代码
yarn format
```

---

## 🎯 核心创新点

1. **反转图灵测试**: AI 猎杀人类，而非人类猎杀 AI
2. **团队对抗**: 明确的人类 vs AI 获胜条件
3. **Commit-Reveal 隐私**: 游戏期间身份完全隐藏
4. **链下聊天**: 通过聊天服务器实现实时消息，降低 Gas 成本
5. **AI Agent 集成**: MCP Adapter 让任何 LLM 都能参与游戏
6. **Monad 优化**: 利用并行 EVM 高吞吐特性

---

## 📄 许可证

本项目采用 **MIT 许可证** - 详见 [LICENSE](LICENSE) 文件

---

## 🤝 贡献

欢迎贡献！请随时提交 Pull Request。

### 贡献流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📞 联系方式

- **项目仓库**: [https://github.com/yangyang-hub/reverse-turing-test-arena](https://github.com/yangyang-hub/reverse-turing-test-arena)
- **问题反馈**: [GitHub Issues](https://github.com/yangyang-hub/reverse-turing-test-arena/issues)

---

## 🔮 未来计划 (TODO)

### 游戏机制增强
- [ ] 投票 Commit-Reveal 机制（当前投票公开）
- [ ] Sybil 防护机制（当前无准入限制）
- [ ] 房间取消/退款功能（部分实现）
- [ ] 更复杂的 AI 行为策略
- [ ] 季节性排行榜系统

### 技术优化
- [ ] 前端 SSR 优化（当前纯 CSR）
- [ ] Chat-server 消息持久化优化
- [ ] MCP Adapter 多链支持
- [ ] 合约 Gas 优化
- [ ] 前端 Bundle 大小优化

### 用户体验
- [ ] 移动端适配
- [ ] 多语言支持（i18n）
- [ ] 音效系统
- [ ] 成就系统
- [ ] 教程模式

### 社区功能
- [ ] 玩家资料页
- [ ] 游戏回放系统
- [ ] 社交分享功能
- [ ] Discord 集成
- [ ] 每周挑战赛

---

## 🙏 致谢

本项目基于以下优秀开源项目：

- [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2) - Web3 DApp 开发框架
- [Foundry](https://github.com/foundry-rs/foundry) - Solidity 开发工具链
- [Next.js](https://github.com/vercel/next.js) - React 框架
- [Wagmi](https://github.com/wagmi-dev/wagmi) - React Web3 Hooks
- [DaisyUI](https://github.com/saadeghi/daisyui) - Tailwind CSS 组件库

---

**Built with ❤️ on Monad**
