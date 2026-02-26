# 本地开发启动指南

> 让 RTTA 项目在本地完整跑起来，包含合约链、前端、MCP 适配器三个服务。

---

## 前置要求

| 工具 | 版本要求 | 检查命令 |
|------|----------|----------|
| Node.js | ≥ 20.18.3 | `node -v` |
| Yarn | 3.2.3 (自动用) | `yarn -v` |
| Foundry (forge/anvil) | 最新版 | `forge --version` |

安装 Foundry（如果没装）:
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

---

## 第一次初始化（只需做一次）

```bash
# 在项目根目录安装所有依赖
cd /Users/gtkj/project/reverse-turing-test-arena
yarn install
```

---

## 启动顺序：必须按 1 → 2 → 3 顺序

---

## 第一步：启动本地区块链

> 新建一个终端窗口，保持运行

```bash
# 在项目根目录
yarn chain
```

成功后会看到类似输出：
```
Listening on 127.0.0.1:8545

Available Accounts
==================
(0) 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
(1) 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
...

Private Keys
==================
(0) 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
...
```

> ⚠️ **保持这个窗口开着**，这是你的本地区块链（Anvil），关掉就断链了

---

## 第二步：部署合约

> 新建另一个终端窗口

```bash
# 在项目根目录
yarn deploy
```

成功后会看到：
```
Deploying contracts with deployer: 0xf39F...
MockUSDC deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
TuringArena deployed at: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
```

> ✅ 合约部署完成后，前端会**自动读取**这些地址（Scaffold-ETH 会把地址写入 `packages/nextjs/contracts/deployedContracts.ts`），不需要手动配置。

---

## 第三步：启动前端

> 新建另一个终端窗口

```bash
# 在项目根目录
yarn start
```

成功后访问：[http://localhost:3000](http://localhost:3000)

> 💡 前端热更新，修改代码会自动刷新

---

## 验证前端能连上合约

打开 [http://localhost:3000](http://localhost:3000)，右上角连接钱包时选择：
- 开发模式下可以用 **Burner Wallet**（页面自动生成的测试钱包）
- 或者用 MetaMask 导入 Anvil 私钥 `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

---

## 第四步（可选）：启动 MCP 适配器（AI Agent）

MCP 适配器让 AI（如 Claude）可以自主参与游戏，需要配置环境变量。

### 4.1 创建环境变量文件

```bash
# 在 mcp-adapter 目录下创建 .env 文件
touch /Users/gtkj/project/reverse-turing-test-arena/packages/mcp-adapter/.env
```

编辑 `.env`，填入以下内容（合约地址从第二步部署输出里复制）：

```bash
# 本地 Anvil RPC
RPC_URL=http://127.0.0.1:8545

# 从 yarn deploy 输出里复制的合约地址
ARENA_CONTRACT_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
PAYMENT_TOKEN_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3

# SessionKeyValidator（如果部署了的话，否则留空）
SESSION_CONTRACT_ADDRESS=
```

### 4.2 启动 MCP 服务

```bash
cd /Users/gtkj/project/reverse-turing-test-arena/packages/mcp-adapter
yarn dev
```

MCP 适配器通过 **stdio** 运行（不是 HTTP 服务器），它等待 AI 客户端连接。

### 4.3 快速测试：用脚本自动玩一局

```bash
cd /Users/gtkj/project/reverse-turing-test-arena/packages/mcp-adapter
yarn autoplay
```

---

## 三个服务汇总

| 服务 | 命令 | 地址/作用 |
|------|------|-----------|
| 本地区块链 | `yarn chain` | `http://127.0.0.1:8545` |
| 合约部署 | `yarn deploy` | 写入地址到前端配置 |
| 前端 | `yarn start` | `http://localhost:3000` |
| MCP 适配器 | `cd mcp-adapter && yarn dev` | stdio，AI Agent 接入 |

---

## 常用调试命令

```bash
# 重新部署合约（合约代码改了之后）
yarn deploy

# 查看合约测试
yarn test

# 编译合约（检查语法错误）
yarn compile

# 查看 Foundry 帮助命令
cat packages/foundry/Makefile
```

---

## 常见问题

### Q: 前端连不上合约？
- 检查本地链是否在运行（Step 1 的终端有没有报错）
- 重新运行 `yarn deploy`，确保地址是最新的

### Q: `yarn chain` 报错 `anvil: command not found`？
- 需要安装 Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`

### Q: MetaMask 连不上本地网络？
- 手动在 MetaMask 里添加网络：
  - 网络名: Localhost
  - RPC URL: `http://127.0.0.1:8545`
  - Chain ID: `31337`
  - 货币符号: `ETH`

### Q: MCP 适配器提示 "no reward" / "no USDC"？
- 需要先 mint 测试 USDC，调用 MCP 工具 `mint_test_usdc`，或者直接在前端操作

---

## 开发工作流（日常）

```
每次开发前:
1. 终端1: yarn chain          ← 启动链（如果没跑）
2. 终端2: yarn deploy         ← 只有合约变更才需要
3. 终端3: yarn start          ← 前端热更新，改代码不需要重启

修改合约后:
→ 先 Ctrl+C 停掉 yarn chain
→ 重新 yarn chain（重置链数据）
→ 再 yarn deploy
→ 前端自动同步新地址
```
