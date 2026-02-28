# Next.js 包操作手册

> Reverse Turing Test Arena - 前端系统完整操作指南

---

## 📚 目录

1. [系统概述](#1-系统概述)
2. [配置文件](#2-配置文件)
3. [页面路由](#3-页面路由)
4. [组件详解](#4-组件详解)
5. [Hooks 详解](#5-hooks-详解)
6. [工具函数](#6-工具函数)
7. [核心流程](#7-核心流程)
8. [合约集成模式](#8-合约集成模式)
9. [样式系统](#9-样式系统)
10. [环境变量](#10-环境变量)
11. [性能优化](#11-性能优化)
12. [故障排查](#12-故障排查)

---

## 1. 系统概述

### 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 15.x | React 框架（App Router） |
| TypeScript | 5.x | 类型安全 |
| Tailwind CSS | 3.x | 样式框架 |
| DaisyUI | Latest | UI 组件库 |
| Wagmi | 2.x | Web3 React Hooks |
| Viem | 2.x | TypeScript 以太坊库 |
| RainbowKit | Latest | 钱包连接 |
| Framer Motion | Latest | 动画库 |
| Zustand | 4.x | 状态管理 |

### 目录结构

```
packages/nextjs/
├── app/                          # Next.js App Router 页面
│   ├── _components/              # 大厅组件
│   ├── arena/                    # 竞技场页面
│   │   └── _components/          # 竞技场组件
│   ├── blockexplorer/            # 区块浏览器
│   ├── debug/                    # 合约调试
│   ├── lobby/                    # 大厅页面
│   ├── layout.tsx                # 根布局
│   ├── page.tsx                  # 落地页
│   └── not-found.tsx             # 404 页面
├── components/                   # 共享组件
│   ├── scaffold-eth/             # SE2 组件
│   ├── assets/                   # 图片资源
│   ├── Footer.tsx
│   ├── Header.tsx
│   └── ScaffoldEthAppWithProviders.tsx
├── contracts/                    # 合约 ABI（自动生成）
│   ├── deployedContracts.ts      # 已部署合约
│   └── externalContracts.ts      # 外部合约
├── hooks/                        # 自定义 React Hooks
│   └── scaffold-eth/
│       ├── useChatSocket.ts      # WebSocket 聊天
│       ├── useChatAuth.ts        # 聊天认证
│       └── ...其他 SE2 hooks
├── services/                     # 服务层
│   ├── store/                    # Zustand store
│   └── web3/                     # Web3 配置
├── styles/                       # 样式
│   └── globals.css               # 全局样式（721 行）
├── utils/                        # 工具函数
│   ├── chatToken.ts              # Token 存储
│   ├── playerAlias.ts            # 玩家别名
│   └── topics.ts                 # 讨论话题
├── next.config.ts                # Next.js 配置
├── scaffold.config.ts            # SE2 配置
└── package.json
```

---

## 2. 配置文件

### `scaffold.config.ts`

**位置**: `/packages/nextjs/scaffold.config.ts`

**作用**: 主配置文件，控制网络设置和轮询间隔

**关键配置**:

```typescript
export const scaffoldConfig = {
  // 目标网络
  targetNetworks: {
    // 开发环境: 本地 Anvil
    localMonad: {
      id: 31337,
      name: "Local Monad",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        public: { http: ["http://localhost:8545"] },
      },
    },
    // 生产环境: Monad Testnet
    monadTestnet: {
      id: 10143,
      name: "Monad Testnet",
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        public: { http: ["https://testnet-rpc.monad.xyz"] },
      },
    },
  },

  // 轮询间隔（毫秒）
  pollingInterval: typeof window !== "undefined"
    ? window.location.hostname === "localhost"
      ? 1000   // 开发: 1 秒
      : 10000  // 生产: 10 秒
    : 10000,

  // WalletConnect 项目 ID
  walletConnectProjectId: "3a8170812b534d0ff9d794f19a901d64",

  // 仅使用本地 burner wallet
  onlyLocalBurnerWallet: true,
};
```

### `next.config.ts`

**位置**: `/packages/nextjs/next.config.ts`

**作用**: Next.js 构建配置

**关键配置**:

```typescript
const nextConfig = {
  // React 严格模式
  reactStrictMode: true,

  // IPFS 构建支持
  output: process.env.NEXT_PUBLIC_IPFS_BUILD === "true" ? "export" : undefined,

  // Webpack 配置
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};
```

---

## 3. 页面路由

### 路由映射表

| 路由 | 文件 | 说明 | 权限要求 |
|------|------|------|---------|
| `/` | `app/page.tsx` | 落地页（Hero + 游戏说明） | 公开 |
| `/lobby` | `app/lobby/page.tsx` | 大厅（房间列表 + 快速匹配） | 需连接钱包 |
| `/arena` | `app/arena/page.tsx` | 竞技场（聊天 + 投票 + 玩家列表） | 需 `?roomId=123` |
| `/blockexplorer` | `app/blockexplorer/page.tsx` | 区块浏览器 | 公开 |
| `/blockexplorer/address/[address]` | `app/blockexplorer/address/[address]/page.tsx` | 地址详情 | 公开 |
| `/debug` | `app/debug/contract.tsx` | 合约调试界面 | 公开 |

### 页面详解

#### 3.1 落地页 (`/`)

**文件**: `app/page.tsx`

**组件组成**:
```tsx
<HeroSection />           // 动画标题 + 角色选择器
<HowItWorks />            // 3 步教程
<CoreMechanics />         // 4 项核心机制
```

**核心内容**:
- 标题: "REVERSE TURING TEST"
- 副标题: "Act Natural. Don't Get Caught."
- 双路径: Human（人类）vs Agent（AI Agent）
- 快速开始按钮

#### 3.2 大厅页面 (`/lobby`)

**文件**: `app/lobby/page.tsx`

**状态管理**:
```typescript
const [activeFilter, setActiveFilter] = useState<"waiting" | "active" | "ended">("waiting");
const [myRoomIds, setMyRoomIds] = useState<number[]>([]);
const [roomListVersion, setRoomListVersion] = useState(0);
```

**合约调用**:
- `playerActiveRoom(address)` - 获取活跃房间 ID
- `getRoomCount()` - 获取房间总数（用于快速匹配扫描）

**Chat Server 集成**:
- `GET /api/players/:address/rooms` - 获取玩家参与的房间
- 复杂度: O(K) 而非 O(N) 全扫描

**核心组件**:
```tsx
<QuickMatchButton />      // 快速匹配
<CreateRoomModal />       // 创建房间
<RoomCard />              // 房间卡片（可复用）
<UsdcFaucet />            // USDC 水龙头（仅本地）
<RoomPhaseWatcher />      // 阶段监听器（自动跳转竞技场）
```

**过滤器标签**:
- **Waiting** - 等待中的房间
- **In Game** - 进行中的房间
- **History** - 历史记录

#### 3.3 竞技场页面 (`/arena`)

**文件**: `app/arena/page.tsx`

**URL 参数**: `?roomId=123`

**核心数据结构**:
```typescript
type PlayerInfo = {
  addr: string;              // 玩家地址
  humanityScore: number;     // 人性分 (0-100)
  isAlive: boolean;          // 是否存活
  isAI: boolean;             // 是否 AI（游戏隐藏）
  actionCount: number;       // 行动次数
  successfulVotes: number;   // 成功投票数
}
```

**合约 Multicall 优化**:

**1. 核心轮询**（4 秒间隔）:
```typescript
const coreData = useReadContracts({
  contracts: [
    { address: ARENA_CONTRACT, functionName: "getRoomInfo", args: [roomId] },
    { address: ARENA_CONTRACT, functionName: "currentRound", args: [roomId] },
    { address: ARENA_CONTRACT, functionName: "pendingReveal", args: [roomId] },
  ],
  watch: true,
  pollingInterval: 4000,
});
```

**2. 静态数据**（获取一次）:
```typescript
const staticData = useReadContracts({
  contracts: [
    { address: ARENA_CONTRACT, functionName: "getAllPlayers", args: [roomId] },
    { address: ARENA_CONTRACT, functionName: "getRoomPlayerNames", args: [roomId] },
  ],
  watch: false,  // 不监听变化
});
```

**3. 玩家信息批量**（4 秒间隔）:
```typescript
const playerInfos = useReadContracts({
  contracts: allPlayers.map(addr => ({
    address: ARENA_CONTRACT,
    functionName: "getPlayerInfo",
    args: [roomId, addr],
  })),
  watch: true,
  pollingInterval: 4000,
});
```

**4. 投票检查**（4 秒间隔）:
```typescript
const hasVoted = useScaffoldReadContract({
  contractName: "TuringArena",
  functionName: "hasVotedInRound",
  args: [roomId, roundNum, address],
  watch: true,
  pollingInterval: 4000,
});
```

**聊天模式**:
```typescript
type ChatMode = "ws" | "poll" | "static" | "off";

// WebSocket: 活跃玩家
mode = phase === 1 && isPlayer ? "ws" : "off";

// REST 轮询: 观众
mode = phase === 1 && !isPlayer ? "poll" : "off";

// 静态获取: 已结束游戏
mode = phase === 2 ? "static" : "off";

// 关闭: 等待中
mode = phase === 0 ? "off" : "off";
```

**核心组件**:
```tsx
<ArenaTerminal />         // 聊天终端
<VotePanel />             // 投票面板
<PlayerRadar />           // 玩家雷达
<MissionBriefing />       // 任务简报（游戏开始）
<VictoryScreen />         // 胜利屏幕（游戏结束）
<KillFeed />              // 击杀 Feed
```

---

## 4. 组件详解

### 4.1 大厅组件 (`app/_components/`)

#### HeroSection.tsx

**位置**: `app/_components/HeroSection.tsx`

**作用**: 落地页首屏，展示动画标题和角色选择器

**动画效果**:
```typescript
// Framer Motion 交错动画
const container = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,  // 每个子元素延迟 0.1s
    },
  },
};
```

**样式**:
- 渐变文字: `#d946ef` (紫色) → `#00e5ff` (青色)
- 赛博朋克网格背景
- 深色遮罩 (`bg-black/60`)

#### RoleSelector.tsx

**位置**: `app/_components/RoleSelector.tsx`

**作用**: 切换人类/AI 角色，显示对应引导

**状态**:
```typescript
type Role = "human" | "agent";
const [role, setRole] = useState<Role>("human");
const [copied, setCopied] = useState(false);
```

**交互**:
- **Human**: 链接到 `/lobby`
- **Agent**: 复制 `/skill.md` URL 到剪贴板（用于 MCP Adapter 配置）

**样式**:
- 自定义 SVG 赛博边框
- 霓虹发光效果
- 动画切换

#### CreateRoomModal.tsx

**位置**: `app/_components/CreateRoomModal.tsx`

**作用**: 创建新房间的模态框

**Props**:
```typescript
type CreateRoomModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onRoomChange?: () => void;  // 回调: 刷新房间列表
};
```

**表单状态**:
```typescript
const [selectedTier, setSelectedTier] = useState<0 | 1 | 2>(0);
const [customMaxPlayers, setCustomMaxPlayers] = useState("10");
const [customEntryFee, setCustomEntryFee] = useState("10");
const [playerName, setPlayerName] = useState("");
```

**房间等级配置**:
```typescript
const TIER_CONFIG = [
  { name: "QUICK", label: "Bronze", color: "#CD7F32", baseInterval: 100 },
  { name: "STANDARD", label: "Silver", color: "#C0C0C0", baseInterval: 150 },
  { name: "EPIC", label: "Gold", color: "#FFD700", baseInterval: 150 },
];
```

**创建流程**:
```typescript
// 1. 获取授权（commitment + operator 签名）
const { commitment, salt, operatorSig } = await getJoinAuth(0, false, maxPlayers);

// 2. 授权 USDC
await writeContractAsync({
  functionName: "approve",
  args: [paymentTokenAddress, entryFee],
});

// 3. 创建房间
await writeContractAsync({
  functionName: "createRoom",
  args: [tier, maxPlayers, entryFee, commitment, operatorSig, playerName],
});

// 4. 更新 chat-server 身份记录
const newRoomId = await readContract({
  functionName: "playerActiveRoom",
  args: [address],
});
await updateRoomId(Number(newRoomId));
```

**验证规则**:
- 玩家数: 3-50
- 入场费: 1-100 USDC
- 玩家名: 1-20 字符

#### QuickMatchButton.tsx

**位置**: `app/_components/QuickMatchButton.tsx`

**作用**: 快速匹配到等待中的房间

**Props**:
```typescript
type QuickMatchButtonProps = {
  roomIds: bigint[];          // 所有房间 ID
  onNoMatch: () => void;      // 无匹配时的回调
  autoMatch?: boolean;        // 是否自动匹配
  onRoomJoined?: () => void;  // 成功加入后的回调
};
```

**过滤条件**:
```typescript
type MatchFilters = {
  minPlayers: number;   // 最小玩家数
  maxPlayers: number;   // 最大玩家数
  minFee: number;       // 最小入场费
  maxFee: number;       // 最大入场费
};
```

**匹配逻辑**:
```typescript
// 从新到旧遍历房间
for (const roomId of roomIds.reverse()) {
  const room = await getRoomInfo(roomId);

  // 检查阶段
  if (room.phase !== 0) continue;

  // 检查玩家数
  if (room.playerCount < filters.minPlayers) continue;
  if (room.playerCount >= filters.maxPlayers) continue;

  // 检查入场费
  if (room.entryFee < filters.minFee) continue;
  if (room.entryFee > filters.maxFee) continue;

  // 找到匹配！
  const { commitment, operatorSig } = await getJoinAuth(roomId, false, maxPlayers);
  await approve(paymentToken, entryFee);
  await joinRoom(roomId, commitment, operatorSig, playerName);
  return;
}
```

#### RoomCard.tsx

**位置**: `app/_components/RoomCard.tsx`

**作用**: 房间卡片，显示房间信息和操作按钮

**Props**:
```typescript
type RoomCardProps = {
  roomId: bigint;
  roomInfo?: any;         // 可选: 从父组件批量获取
  onRoomChange?: () => void;
};
```

**房间等级颜色**:
```typescript
const TIER_COLORS = {
  0: "#CD7F32",  // Bronze
  1: "#C0C0C0",  // Silver
  2: "#FFD700",  // Gold
};
```

**按钮状态**:
```typescript
// Waiting 阶段
if (phase === 0) {
  if (isPlayer) return "LEAVE";        // 已加入
  return "ENTER ROOM";                 // 未加入
}

// Active 阶段
if (phase === 1) {
  if (isPlayer) return "ENTER ARENA";  // 进入竞技场
  return "SPECTATE";                   // 观战
}

// Ended 阶段
if (phase === 2) {
  if (hasReward) return "CLAIM";       // 领取奖励
  return "VIEW";                       // 查看详情
}
```

### 4.2 竞技场组件 (`app/arena/_components/`)

#### ArenaTerminal.tsx

**位置**: `app/arena/_components/ArenaTerminal.tsx`

**作用**: 聊天终端，显示消息历史和输入框

**Props**:
```typescript
type ArenaTerminalProps = {
  roomId: bigint;
  nameMap?: Record<string, string>;      // 地址 → 名字
  roomInfo: any;
  allPlayers: string[];
  myPlayerInfo?: PlayerInfo;
  currentRound: number;
  chatMessages: ChatMsg[];               // 消息列表
  sendMessage: (content: string) => void; // 发送消息
  isConnected: boolean;                  // WebSocket 连接状态
  myMessageCount: number;                // 我的消息数
};
```

**消息类型**:
```typescript
type ChatMsg = {
  id?: number;
  roomId: number;
  round: number;
  sender: string;
  content: string;
  createdAt: string;
};
```

**消息颜色**:
```typescript
// Cyan: 我的消息
sender === myAddress ? "text-cyan-400"

// Purple: 其他玩家
"text-purple-400"

// Yellow: 系统消息
"text-yellow-400"  // [SYSTEM], [VOTE], [PHASE]

// Red: 淘汰消息
"text-red-400"     // [ELIMINATED], [KILL]
```

**自动滚动**:
```typescript
const messagesEndRef = useRef<HTMLDivElement>(null);
const [autoScroll, setAutoScroll] = useState(true);

// 检测用户是否手动滚动
const handleScroll = () => {
  const { scrollTop, scrollHeight, clientHeight } = messagesRef.current!;
  const isAtBottom = scrollHeight - scrollTop <= clientHeight + 100;
  setAutoScroll(isAtBottom);
};

// 自动滚动到底部
useEffect(() => {
  if (autoScroll) {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }
}, [chatMessages]);
```

**消息限制**:
- 每轮最多 6 条消息（前端显示）
- 后端强制执行 3 条

#### VotePanel.tsx

**位置**: `app/arena/_components/VotePanel.tsx`

**作用**: 投票面板，选择目标并投票

**Props**:
```typescript
type VotePanelProps = {
  roomId: bigint;
  nameMap?: Record<string, string>;
  playerInfoMap: Record<string, PlayerInfo>;
  allPlayers: string[];
  roomInfo: any;
  roundNum: bigint | undefined;
  blockNumber: bigint | undefined;
  pendingReveal: boolean;
  hasVotedOnChain?: boolean;
  onEmergencyEnd?: () => void;
};
```

**状态**:
```typescript
const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
const [localVotedRound, setLocalVotedRound] = useState<bigint | null>(null);
```

**乐观锁**:
```typescript
// 防止重复投票（链确认前）
const handleVote = async () => {
  if (!selectedTarget) return;

  await castVote(roomId, selectedTarget);

  // 设置本地锁
  setLocalVotedRound(roundNum!);
};
```

**上一轮投票显示**:
```typescript
// 批量获取上一轮投票
const prevRoundVotes = useReadContracts({
  contracts: allPlayers.map(addr => ({
    address: ARENA_CONTRACT,
    functionName: "voteTarget",
    args: [roomId, roundNum - 1n, addr],
  })),
});
```

**轮次倒计时**:
```typescript
const blocksRemaining = settleTargetBlock - currentBlock;
const progress = 1 - (blocksRemaining / currentInterval);
const isUrgent = blocksRemaining <= currentInterval * 0.25;  // 最后 25%
const isExpired = currentBlock >= settleTargetBlock;
```

**紧急结束**:
```typescript
// 3600 个区块后可调用
const EMERGENCY_BLOCKS = 3600;

if (pendingReveal && blocksSincePending >= EMERGENCY_BLOCKS) {
  showEmergencyButton = true;
}
```

#### PlayerRadar.tsx

**位置**: `app/arena/_components/PlayerRadar.tsx`

**作用**: 玩家雷达，显示 HP 条和身份（游戏结束后）

**Props**:
```typescript
type PlayerRadarProps = {
  nameMap?: Record<string, string>;
  playerInfoMap: Record<string, PlayerInfo>;
  allPlayers: string[];
  roomInfo: any;
};
```

**HP 条颜色**:
```typescript
const getHpColor = (score: number) => {
  if (score > 60) return "bg-green-500";
  if (score > 30) return "bg-yellow-500";
  return "bg-red-500";
};
```

**玩家卡片**:
```typescript
// 头像
<div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold`}
     style={{ backgroundColor: alias.color }}>
  {alias.initial}
</div>

// 名字（别名或链上名字）
<span>{alias.name || onChainName || shortAddress}</span>

// HP 条
<div className="w-full bg-gray-700 h-2">
  <div className={getHpColor(score)} style={{ width: `${score}%` }} />
</div>

// 标签
{isAI && phase === 2 && <span className="badge badge-error">AI</span>}
{addr === myAddress && <span className="badge badge-primary">YOU</span>}
{!isAlive && <span className="badge badge-secondary">DEAD</span>}
```

#### MissionBriefing.tsx

**位置**: `app/arena/_components/MissionBriefing.tsx`

**作用**: 游戏开始时的任务简报全屏覆盖层

**Props**:
```typescript
type MissionBriefingProps = {
  totalPlayers: number;
  isAI: boolean;
  onDismiss: () => void;
};
```

**自动关闭**:
```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    onDismiss();
  }, 8000);  // 8 秒后自动关闭
  return () => clearTimeout(timer);
}, []);
```

**任务文本**:
```typescript
const missionText = isAI
  ? "Mimic human behavior. Avoid detection. Survive."
  : "Find the AIs and vote to eliminate them. Stay alive.";
```

#### VictoryScreen.tsx

**位置**: `app/arena/_components/VictoryScreen.tsx`

**作用**: 游戏结束覆盖层，显示结果和奖励

**Props**:
```typescript
type VictoryScreenProps = {
  roomId: bigint;
  allPlayers: string[];
  humansWon: boolean;
  mvp: string;              // MVP 地址
  mvpVotes: number;         // MVP 得票数
  myRewardAmount: bigint;   // 我的奖励
  myRewardClaimed: boolean; // 是否已领取
  nameMap?: Record<string, string>;
  onDismiss: () => void;
};
```

**Canvas 粒子动画**:
```typescript
const canvasRef = useRef<HTMLCanvasElement>(null);

useEffect(() => {
  const canvas = canvasRef.current!;
  const ctx = canvas.getContext("2d")!;
  const particles: Particle[] = [];

  // 粒子颜色
  const colors = humansWon
    ? ["#39d353", "#00ff88", "#00ffcc"]  // 绿色系
    : emergencyEnd
    ? ["#ff6b35", "#f7931e", "#ffcc00"]  // 橙色系
    : ["#ff0055", "#ff00aa", "#bd00ff"]; // 紫红系

  // 创建粒子
  const createParticle = () => ({
    x: Math.random() * canvas.width,
    y: canvas.height + 10,
    vx: (Math.random() - 0.5) * 2,
    vy: -Math.random() * 5 - 3,
    size: Math.random() * 3 + 1,
    color: colors[Math.floor(Math.random() * colors.length)],
  });

  // 动画循环
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      if (p.y < -10) particles.splice(i, 1);
    });
    requestAnimationFrame(animate);
  };

  const interval = setInterval(() => {
    particles.push(...Array.from({ length: 5 }, createParticle));
  }, 100);

  animate();
  return () => clearInterval(interval);
}, [humansWon, emergencyEnd]);
```

**领取奖励**:
```typescript
const handleClaim = async () => {
  await claimReward(roomId);
  setJustClaimed(true);
};
```

---

## 5. Hooks 详解

### 5.1 useChatSocket

**位置**: `hooks/scaffold-eth/useChatSocket.ts`

**作用**: WebSocket 聊天连接，支持 token 认证

**签名**:
```typescript
function useChatSocket(
  roomId: number | undefined,
  mode: "ws" | "poll" | "static" | "off"
): {
  messages: ChatMsg[];
  sendMessage: (content: string) => void;
  isConnected: boolean;
  myMessageCount: number;
  myIsAI: boolean | undefined;
}
```

**模式说明**:
```typescript
// "ws" - WebSocket (活跃玩家)
// "poll" - REST 轮询 (观众)
// "static" - 静态获取 (已结束游戏)
// "off" - 关闭连接 (等待阶段)
```

**认证流程**:
```typescript
// 1. 检查存储的 token
const storedToken = getStoredChatToken();

// 2. 连接 WebSocket
const ws = new WebSocket(WS_URL);

// 3. 发送认证消息
if (storedToken) {
  ws.send(JSON.stringify({ type: "auth", token: storedToken.token }));
} else {
  // SIWE 签名
  const message = await siweMessage();
  const signature = await signMessage(message);
  ws.send(JSON.stringify({ type: "auth", message, signature }));
}

// 4. 接收响应
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "auth_ok":
      // 保存新 token
      storeChatToken(data.token, address);
      break;

    case "room_joined":
      // 初始化消息列表
      setMessages(data.messages);
      setMyIsAI(data.isAI);
      break;

    case "new_message":
      // 追加新消息
      setMessages(prev => [...prev, data.message]);
      break;

    case "error":
      if (data.code === "auth_failed") {
        // Token 过期，清除并重连
        clearChatToken();
        reconnect();
      }
      break;
  }
};
```

**自动重连**:
```typescript
useEffect(() => {
  if (mode === "ws") {
    connect();
  }

  return () => {
    ws.close();
  };
}, [roomId, mode]);

// 重连延迟 3 秒
const reconnect = () => {
  setTimeout(() => connect(), 3000);
};
```

**发送消息**:
```typescript
const sendMessage = (content: string) => {
  if (!isConnected) return;

  ws.send(JSON.stringify({
    type: "send_message",
    roomId,
    content,
  }));
};
```

### 5.2 useChatAuth

**位置**: `hooks/scaffold-eth/useChatAuth.ts`

**作用**: Chat Server 认证，提供 commitment 和 operator 签名

**签名**:
```typescript
function useChatAuth(): {
  getJoinAuth: (
    roomId: number,
    isAI: boolean,
    maxPlayers: number
  ) => Promise<JoinAuthResult>;
  updateRoomId: (newRoomId: number) => Promise<void>;
}
```

**JoinAuthResult**:
```typescript
type JoinAuthResult = {
  commitment: `0x${string}`;      // Commitment hash
  salt: string;                   // 盐值
  operatorSig: `0x${string}`;     // Operator 签名
};
```

**认证流程**:
```typescript
const getJoinAuth = async (roomId, isAI, maxPlayers) => {
  // 1. 检查内存缓存
  if (cachedToken) {
    return await fetchJoinAuth(cachedToken, roomId, isAI);
  }

  // 2. 检查 localStorage
  const stored = getStoredChatToken();
  if (stored && stored.address === address) {
    cachedToken = stored.token;
    return await fetchJoinAuth(cachedToken, roomId, isAI);
  }

  // 3. SIWE 签名
  const message = createSiweMessage(address);
  const signature = await signMessage(message);

  // 4. 获取 JWT
  const response = await fetch(`${CHAT_SERVER_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });

  const { token } = await response.json();

  // 5. 缓存 token
  cachedToken = token;
  storeChatToken(token, address);

  // 6. 获取 join auth
  return await fetchJoinAuth(token, roomId, isAI);
};

const fetchJoinAuth = async (token, roomId, isAI) => {
  const response = await fetch(`${CHAT_SERVER_URL}/api/room-join-auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ roomId, isAI }),
  });

  return await response.json();  // { commitment, salt, operatorSig }
};
```

**更新房间 ID**:
```typescript
const updateRoomId = async (newRoomId: number) => {
  const token = await ensureToken();

  await fetch(`${CHAT_SERVER_URL}/api/room-join-auth/update-room-id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ newRoomId }),
  });
};
```

**401 错误处理**:
```typescript
const fetchWithAuth = async (url, options) => {
  const response = await fetch(url, options);

  if (response.status === 401) {
    // Token 过期，清除并重试一次
    clearChatToken();
    cachedToken = null;

    const newToken = await ensureToken();
    options.headers.Authorization = `Bearer ${newToken}`;

    return await fetch(url, options);
  }

  return response;
};
```

---

## 6. 工具函数

### 6.1 playerAlias

**位置**: `utils/playerAlias.ts`

**作用**: 为每个房间的玩家生成确定性别名

**别名列表** (50 个):
```typescript
const ALIASES = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo",
  "Foxtrot", "Ghost", "Havoc", "Icarus", "Jade",
  "Kilo", "Luna", "Maverick", "Neon", "Omega",
  "Phoenix", "Quark", "Rogue", "Shadow", "Titan",
  "Utopia", "Vortex", "Wraith", "Xenon", "Yield",
  "Zenith", "Cipher", "Drift", "Edge", "Flux",
  "Glitch", "Haze", "Ion", "Jolt", "Kinetic",
  "Lunar", "Meta", "Nova", "Orbit", "Pulse",
  "Quantum", "Radar", "Sonic", "Tensor", "Unity",
  "Vector", "Wave", "Xen", "Yonder", "Zinc",
];
```

**颜色列表** (50 种赛博朋克色):
```typescript
const COLORS = [
  "#00ff00", "#00ffff", "#ff00ff", "#ffff00",
  "#ff0080", "#80ff00", "#0080ff", "#8000ff",
  // ... 更多颜色
];
```

**getPlayerAlias**:
```typescript
function getPlayerAlias(
  players: string[],
  address: string,
  nameMap?: Record<string, string>
): PlayerAlias {
  // 优先: 链上名字
  if (nameMap && nameMap[address]) {
    const name = nameMap[address];
    return {
      name,
      color: "#ffffff",
      initial: name[0].toUpperCase(),
    };
  }

  // 确定性别名
  const index = players.indexOf(address) % 50;
  const alias = ALIASES[index];
  const color = COLORS[index];

  return {
    name: alias,
    color,
    initial: alias[0].toUpperCase(),
  };
}
```

### 6.2 topics

**位置**: `utils/topics.ts`

**作用**: 为每轮生成讨论话题

**话题列表** (30 个):
```typescript
const TOPICS = [
  "What's the most human thing you did today?",
  "Describe your favorite childhood memory.",
  "What's your opinion on pineapple pizza?",
  "If you could travel anywhere, where would you go?",
  "What's the last book you read?",
  // ... 更多话题
];
```

**getTopicForRound**:
```typescript
function getTopicForRound(round: number): string {
  return TOPICS[round % 30];
}
```

### 6.3 chatToken

**位置**: `utils/chatToken.ts`

**作用**: localStorage 封装，存储聊天认证 token

**StoredToken**:
```typescript
type StoredToken = {
  token: string;
  address: string;
};
```

**函数**:
```typescript
function getStoredChatToken(): StoredToken | null {
  if (typeof window === "undefined") return null;

  const data = localStorage.getItem("chatToken");
  if (!data) return null;

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function storeChatToken(token: string, address: string): void {
  if (typeof window === "undefined") return;

  localStorage.setItem("chatToken", JSON.stringify({ token, address }));
}

function clearChatToken(): void {
  if (typeof window === "undefined") return;

  localStorage.removeItem("chatToken");
}
```

---

## 7. 核心流程

### 7.1 创建房间流程

```
用户操作
  ↓
打开 CreateRoomModal
  ↓
选择等级（Quick/Standard/Epic）
  ↓
设置参数（玩家数 3-50，入场费 1-100 USDC，玩家名 1-20 字符）
  ↓
点击 "CREATE ROOM"
  ↓
前端调用 getJoinAuth(0, false, maxPlayers)
  ↓
Chat Server 返回 commitment + salt + operatorSig
  ↓
前端调用 approve(paymentToken, entryFee)
  ↓
前端调用 createRoom(tier, maxPlayers, entryFee, commitment, operatorSig, name)
  ↓
前端调用 playerActiveRoom(address) 获取新房间 ID
  ↓
前端调用 updateRoomId(newRoomId) 更新身份记录
  ↓
重定向到 /lobby
  ↓
大厅显示新房间在 "Waiting" 标签
```

### 7.2 加入房间流程（快速匹配）

```
用户点击 "QUICK MATCH"
  ↓
打开过滤模态框（玩家范围，入场费范围）
  ↓
点击 "MATCH"
  ↓
前端遍历所有房间 ID（从新到旧）
  ↓
对每个房间:
  - 调用 getRoomInfo(roomId)
  - 检查 phase === 0 (等待中)
  - 检查玩家数有空间
  - 检查过滤条件匹配
  ↓
找到匹配房间:
  - 调用 getJoinAuth(roomId, false, maxPlayers)
  - 调用 approve(paymentToken, entryFee)
  - 调用 joinRoom(roomId, commitment, operatorSig, name)
  - 跳出循环
  ↓
重定向到 /lobby
  ↓
大厅显示新加入的房间
  ↓
RoomPhaseWatcher 检测到游戏开始，自动跳转到 /arena
```

### 7.3 竞技场页面加载流程

```
用户导航到 /arena?roomId=123
  ↓
页面从 URL 读取 roomId
  ↓
核心 Multicall: getRoomInfo + currentRound + pendingReveal
  ↓
静态 Multicall: getAllPlayers + getRoomPlayerNames
  ↓
构建 nameMap 和 playerInfoMap
  ↓
判断阶段:
  ↓
phase === 0 (等待中):
  - 显示 "ROOM NOT READY"
  - 聊天模式: "off"
  ↓
phase === 1 (进行中):
  - 检查是否玩家
  - 玩家: 聊天模式 "ws" (WebSocket)
  - 观众: 聊天模式 "poll" (REST 轮询)
  - 显示 MissionBriefing (8 秒后关闭)
  ↓
phase === 2 (已结束):
  - 调用 getGameStats(roomId)
  - 显示 VictoryScreen
  - 聊天模式: "static" (一次获取)
```

### 7.4 聊天消息流程

**玩家 (WebSocket)**:
```
useChatSocket 连接到 ws://host/ws
  ↓
发送认证消息:
  - 有 token: { type: "auth", token }
  - 无 token: { type: "auth", message, signature } (SIWE)
  ↓
服务器返回: { type: "auth_ok", token }
  ↓
发送: { type: "join_room", roomId }
  ↓
服务器返回: { type: "room_joined", messages: [...], isAI: bool }
  ↓
接收新消息: { type: "new_message", ... }
  ↓
发送消息: { type: "send_message", roomId, content }
  ↓
服务器广播给所有客户端
```

**观众 (REST 轮询)**:
```
每 5 秒调用 GET /api/rooms/:roomId/messages
  ↓
返回消息列表
  ↓
更新状态
```

### 7.5 投票流程

```
用户打开竞技场
  ↓
VotePanel 加载玩家列表
  ↓
轮次倒计时通过父组件的 blockNumber prop 更新
  ↓
用户点击玩家卡片
  ↓
selectedTarget 状态更新
  ↓
"VOTE TO ELIMINATE X" 按钮激活
  ↓
用户点击按钮
  ↓
调用 castVote(roomId, targetAddress)
  ↓
成功后: localVotedRound 设置为当前轮次（乐观锁）
  ↓
按钮显示 "ALREADY VOTED"
  ↓
当 settleRound 被调用:
  - HP 伤害链上应用
  - currentRound 变化触发 useEffect
  - playerInfoMap 重新获取
  - VotePanel 显示上一轮投票
```

### 7.6 领取奖励流程

```
游戏结束 (phase === 2)
  ↓
VictoryScreen 显示:
  - 团队结果 (HUMANS WIN / AIs WIN)
  - MVP 别名和地址
  - 奖励金额
  ↓
用户点击 "CLAIM REWARD"
  ↓
调用 claimReward(roomId)
  ↓
成功后: justClaimed 状态设为 true
  ↓
按钮消失，显示 "REWARD CLAIMED"
```

---

## 8. 合约集成模式

### 8.1 Multicall 批处理

**Arena 页面 - 父组件批处理，子组件接收 props**:

```typescript
// 核心: 3 个调用 → 1 个 multicall (4 秒轮询)
const coreData = useReadContracts({
  contracts: [
    { functionName: "getRoomInfo", args: [roomId] },
    { functionName: "currentRound", args: [roomId] },
    { functionName: "pendingReveal", args: [roomId] },
  ],
  watch: true,
  pollingInterval: 4000,
});

// 静态: 2 个调用 → 1 个 multicall (获取一次)
const staticData = useReadContracts({
  contracts: [
    { functionName: "getAllPlayers", args: [roomId] },
    { functionName: "getRoomPlayerNames", args: [roomId] },
  ],
  watch: false,
});

// 玩家: N 个调用 → 1 个 multicall (4 秒轮询)
const playerInfos = useReadContracts({
  contracts: allPlayers.map(addr => ({
    functionName: "getPlayerInfo",
    args: [roomId, addr],
  })),
  watch: true,
  pollingInterval: 4000,
});

// 投票检查: 1 个调用 → 父组件 multicall 一部分
const hasVoted = useScaffoldReadContract({
  functionName: "hasVotedInRound",
  args: [roomId, roundNum, address],
  watch: true,
  pollingInterval: 4000,
});

// VotePanel 通过 props 接收，而不是单独 hook
<VotePanel hasVotedOnChain={hasVoted} />
```

**Lobby 页面 - RoomGrid 批处理所有房间**:

```typescript
// N 个房间: N 个调用 → 1 个 multicall (10 秒轮询)
const roomInfos = useReadContracts({
  contracts: roomIds.map(id => ({
    functionName: "getRoomInfo",
    args: [id],
  })),
  watch: true,
  pollingInterval: 10000,
});

// RoomCard 接受可选的 roomInfo prop
<RoomCard roomId={id} roomInfo={roomInfos[i]} />
```

### 8.2 写操作模式

**模式**: `useScaffoldWriteContract` → `writeContractAsync`

```typescript
const { writeContractAsync, isMining } = useScaffoldWriteContract({
  contractName: "TuringArena",
});

// 创建房间
await writeContractAsync({
  functionName: "createRoom",
  args: [tier, maxPlayers, entryFee, commitment, operatorSig, name],
});

// 加入房间
await writeContractAsync({
  functionName: "joinRoom",
  args: [roomId, commitment, operatorSig, name],
});

// 投票
await writeContractAsync({
  functionName: "castVote",
  args: [roomId, target],
});

// 领取奖励
await writeContractAsync({
  functionName: "claimReward",
  args: [roomId],
});
```

**回调**: `onRoomChange` 在写操作后刷新数据

```typescript
onRoomChange?: () => void;

// 实现示例
const handleRoomChange = () => {
  setRoomListVersion(v => v + 1);      // 触发房间列表刷新
  refetchActiveRoom();                 // 重新获取活跃房间
  refetchRoomCount();                  // 重新获取房间总数
};
```

---

## 9. 样式系统

### 9.1 主题

**赛博朋克暗色主题**:
- **背景**: `#0d0d1a` (深蓝黑)
- **主色**: `#39d353` (绿色)
- **辅助色**: `#00e5ff` (青色)
- **强调色**: `#bd00ff` (紫色)
- **文字**: `#e0e0e0` (浅灰)

**字体**:
- **标签**: `font-mono` (JetBrains Mono, Fira Code)
- **正文**: 默认无衬线字体

### 9.2 DaisyUI 类

**按钮**:
```html
<button class="btn">Default</button>
<button class="btn btn-primary">Primary</button>
<button class="btn btn-outline">Outline</button>
<button class="btn btn-sm">Small</button>
<button class="btn btn-lg">Large</button>
```

**输入框**:
```html
<input class="input" />
<input class="input input-bordered" />
```

**模态框**:
```html
<div class="modal modal-open">
  <div class="modal-box">...</div>
</div>
```

**加载动画**:
```html
<span class="loading loading-spinner"></span>
<span class="loading loading-ring"></span>
```

### 9.3 自定义 CSS 类

**霓虹文字**:
```css
.neon-text {
  text-shadow:
    0 0 5px currentColor,
    0 0 10px currentColor,
    0 0 20px currentColor;
}
```

**房间等级边框**:
```css
.tier-quick { border-color: #CD7F32; }
.tier-standard { border-color: #C0C0C0; }
.tier-epic { border-color: #FFD700; }
```

**阶段颜色**:
```css
.phase-active { color: #39d353; }
.phase-ended { color: #bd00ff; }
```

**赛博网格背景**:
```css
.cyber-grid-bg {
  background-image:
    linear-gradient(rgba(0, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
}
```

**玻璃面板**:
```css
.glass-panel {
  background: rgba(13, 13, 26, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(0, 229, 255, 0.2);
}
```

---

## 10. 环境变量

| 变量名 | 作用 | 默认值 |
|--------|------|--------|
| `NEXT_PUBLIC_NETWORK_ENV` | 网络环境 (`production` | `development`) | `undefined` |
| `NEXT_PUBLIC_MONAD_RPC_URL` | Monad Testnet RPC | `https://testnet-rpc.monad.xyz` |
| `NEXT_PUBLIC_ANVIL_RPC_URL` | 本地 Anvil RPC | `undefined` |
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Alchemy API Key | `cR4WnXePioePZ5fFrnSiR` |
| `NEXT_PUBLIC_CHAT_SERVER_URL` | Chat Server REST URL | `http://localhost:43001` |
| `NEXT_PUBLIC_CHAT_SERVER_WS_URL` | Chat Server WebSocket URL | 从 REST URL 推导 |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | WalletConnect Project ID | `3a8170812b534d0ff9d794f19a901d64` |
| `NEXT_PUBLIC_IPFS_BUILD` | 启用 IPFS 导出模式 | `undefined` |
| `NEXT_PUBLIC_IGNORE_BUILD_ERROR` | 忽略构建错误 | `undefined` |

### 环境配置示例

**本地开发 (.env.local)**:
```bash
NEXT_PUBLIC_NETWORK_ENV=development
NEXT_PUBLIC_CHAT_SERVER_URL=http://localhost:43001
```

**生产环境 (.env.production)**:
```bash
NEXT_PUBLIC_NETWORK_ENV=production
NEXT_PUBLIC_CHAT_SERVER_URL=https://chat-server.example.com
```

---

## 11. 性能优化

### 11.1 Multicall 批处理

- **Arena**: 5+N 个调用 → 2 个 HTTP 请求
- **Lobby**: N 个房间 → 1 个 HTTP 请求

### 11.2 轮询间隔

- **开发**: 1 秒
- **生产**: 10 秒
- **Arena 核心数据**: 4 秒

### 11.3 静态数据

```typescript
// 不监听变化，仅获取一次
const staticData = useReadContracts({
  contracts: [...],
  watch: false,
});
```

### 11.4 Props 下钻

```typescript
// ❌ 不好: VotePanel 自己调用 hook
const hasVoted = useScaffoldReadContract({ ... });

// ✅ 好: 父组件批处理，子组件接收 prop
<VotePanel hasVotedOnChain={hasVoted} />
```

### 11.5 useEffect 依赖

```typescript
// ❌ 不好: 无限循环
useEffect(() => {
  fetchRoomInfo();
}, [roomInfo]);  // roomInfo 在 fetch 后更新

// ✅ 好: 正确依赖
useEffect(() => {
  fetchRoomInfo();
}, [roomId]);  // roomId 变化时才 fetch
```

### 11.6 Chat Server 缓存

- MCP 读取缓存 via REST (0 RPC for room state)
- 轮询间隔: 4 秒

---

## 12. 故障排查

### 12.1 常见问题

**问题**: 聊天消息不显示

**排查**:
1. 检查 `isConnected` 状态
2. 检查浏览器 Console WebSocket 错误
3. 检查 `NEXT_PUBLIC_CHAT_SERVER_URL`
4. 检查 token 是否过期（清除 localStorage）

**问题**: 投票后无反应

**排查**:
1. 检查 `localVotedRound` 是否设置
2. 检查 `hasVotedOnChain` 状态
3. 检查钱包余额（Gas 费）
4. 检查交易在区块浏览器

**问题**: 房间不显示

**排查**:
1. 检查 `myRoomIds` 是否为空
2. 检查 Chat Server `/api/players/:address/rooms` 响应
3. 检查钱包是否连接
4. 检查网络是否正确（local vs testnet）

**问题**: USDC 授权失败

**排查**:
1. 检查 MockUSDC 是否部署
2. 检查 `paymentToken` 地址
3. 调用 `mint()` 获取测试 USDC
4. 检查 `allowance` 是否足够

### 12.2 调试技巧

**开启详细日志**:
```typescript
// 在组件中添加
console.log("[Arena] roomInfo:", roomInfo);
console.log("[Arena] currentRound:", currentRound);
console.log("[Chat] messages:", messages);
```

**检查合约状态**:
```typescript
// 使用 Read Contract
const roomInfo = useScaffoldReadContract({
  contractName: "TuringArena",
  functionName: "getRoomInfo",
  args: [roomId],
});
console.log("roomInfo:", roomInfo);
```

**检查 WebSocket**:
```typescript
// 浏览器 DevTools → Network → WS
// 查看消息帧
```

---

## 📝 附录

### A. 合约函数清单

**TuringArena.sol**:
- `createRoom(RoomTier, maxPlayers, entryFee, commitment, operatorSig, name)`
- `joinRoom(roomId, commitment, operatorSig, name)`
- `leaveRoom(roomId)`
- `startGame(roomId)`
- `settleRound(roomId)`
- `castVote(roomId, target)`
- `emergencyEnd(roomId)`
- `claimReward(roomId)`
- `getRoomInfo(roomId)`
- `getAllPlayers(roomId)`
- `getPlayerInfo(roomId, addr)`
- `getRoomPlayerNames(roomId)`
- `currentRound(roomId)`
- `pendingReveal(roomId)`
- `hasVotedInRound(roomId, round, addr)`
- `playerActiveRoom(address)`
- `getGameStats(roomId)`
- `getRewardInfo(roomId, addr)`

**MockUSDC.sol**:
- `mint(address, amount)`
- `approve(spender, amount)`
- `balanceOf(address)`
- `allowance(owner, spender)`

### B. 类型定义

```typescript
// PlayerInfo
type PlayerInfo = {
  addr: string;
  humanityScore: number;
  isAlive: boolean;
  isAI: boolean;
  actionCount: number;
  successfulVotes: number;
};

// RoomInfo
type RoomInfo = {
  creator: string;
  tier: number;
  maxPlayers: number;
  entryFee: bigint;
  baseInterval: number;
  playerCount: number;
  phase: number;  // 0=Waiting, 1=Active, 2=Ended
  currentRound: bigint;
  settleTargetBlock: bigint;
  currentInterval: number;
  humanCount: number;
  aiCount: number;
};

// ChatMsg
type ChatMsg = {
  id?: number;
  roomId: number;
  round: number;
  sender: string;
  content: string;
  createdAt: string;
};

// PlayerAlias
type PlayerAlias = {
  name: string;
  color: string;
  initial: string;
};
```

---

**文档版本**: 1.0
**最后更新**: 2026-02-28
**维护者**: RTTA Development Team
