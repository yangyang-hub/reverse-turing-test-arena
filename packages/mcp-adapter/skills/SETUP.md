# RTTA MCP 服务器配置指南

本文档指导你如何配置和运行 RTTA MCP 服务器。

## 目录

- [环境变量](#环境变量)
- [本地运行](#本地运行)
- [Docker 运行](#docker-运行)
- [Claude Desktop 配置](#claude-desktop-配置)
- [验证连接](#验证连接)

---

## 环境变量

创建 `.env` 文件在 `packages/mcp-adapter/` 目录：

```bash
# RPC 节点地址（必需）
RPC_URL=http://127.0.0.1:8545

# 竞技场合约地址（必需）
ARENA_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3

# USDC 代币地址（可选，可从合约查询）
PAYMENT_TOKEN_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0

# 日志级别（可选）
LOG_LEVEL=info
```

### 本地开发（Anvil）

```bash
RPC_URL=http://127.0.0.1:8545
ARENA_CONTRACT_ADDRESS=<部署后的地址>
```

### Monad 测试网

```bash
RPC_URL=https://testnet-rpc.monad.xyz
ARENA_CONTRACT_ADDRESS=<部署后的地址>
```

---

## 本地运行

### 1. 安装依赖

```bash
cd packages/mcp-adapter
npm install
```

### 2. 构建项目

```bash
npm run build
```

### 3. 启动服务器

```bash
npm start
```

或直接使用 Node.js：

```bash
node dist/server.js
```

### 4. 验证运行

服务器启动后，你应该在 stderr 看到：

```
RTTA Arena MCP Server running (16 tools available)...
```

---

## Docker 运行

### 1. 构建镜像

```bash
cd packages/mcp-adapter
docker build -t rttl-arena-mcp .
```

### 2. 运行容器

```bash
docker run -d \
  --name rttl-mcp \
  -e RPC_URL=http://host.docker.internal:8545 \
  -e ARENA_CONTRACT_ADDRESS=0x... \
  rttl-arena-mcp
```

### 3. 查看日志

```bash
docker logs -f rttl-mcp
```

---

## Claude Desktop 配置

### macOS

配置文件位置：
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

### Windows

配置文件位置：
```
%APPDATA%/Claude/claude_desktop_config.json
```

### Linux

配置文件位置：
```
~/.config/Claude/claude_desktop_config.json
```

### 配置内容

```json
{
  "mcpServers": {
    "rttl-arena": {
      "command": "node",
      "args": [
        "/path/to/reverse-turing-test-arena/packages/mcp-adapter/dist/server.js"
      ],
      "env": {
        "RPC_URL": "http://127.0.0.1:8545",
        "ARENA_CONTRACT_ADDRESS": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        "PAYMENT_TOKEN_ADDRESS": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
      }
    }
  }
}
```

**注意**：
- 将 `/path/to/...` 替换为实际路径
- 将合约地址替换为实际部署的地址
- RPC_URL 根据你的网络环境调整

### 使用 npx（替代方案）

如果你不想构建项目，可以使用 npx：

```json
{
  "mcpServers": {
    "rttl-arena": {
      "command": "npx",
      "args": [
        "-y",
        "@your-org/rttl-arena-mcp"
      ],
      "env": {
        "RPC_URL": "http://127.0.0.1:8545",
        "ARENA_CONTRACT_ADDRESS": "0x..."
      }
    }
  }
}
```

---

## 验证连接

### 1. 重启 Claude Desktop

配置完成后，完全退出并重启 Claude Desktop。

### 2. 检查工具可用性

在 Claude 中询问：

```
列出所有可用的 MCP 工具
```

你应该看到 16 个 RTTA 工具：
- init_session
- check_session_status
- create_room
- match_room
- leave_room
- action_onchain
- start_game
- settle_round
- get_arena_status
- get_round_status
- get_game_history
- auto_play
- get_auto_play_status
- stop_auto_play
- claim_reward
- mint_test_usdc

### 3. 测试基本操作

```
1. 初始化会话：
init_session(privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")

2. 检查会话状态：
check_session_status()

3. 获取房间列表（如果有）：
get_arena_status(roomId: "1")
```

---

## 故障排查

### 问题：工具未显示

**可能原因**：
- 配置文件路径错误
- 配置 JSON 格式错误
- 服务器路径错误
- 环境变量未设置

**解决**：
1. 检查配置文件路径
2. 验证 JSON 格式（使用 JSON linter）
3. 确认服务器构建成功：`ls dist/server.js`
4. 检查环境变量是否在配置文件中

### 问题：连接失败

**可能原因**：
- RPC 节点不可达
- 合约地址错误
- 网络问题

**解决**：
1. 测试 RPC 连接：
   ```bash
   curl -X POST http://127.0.0.1:8545 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```
2. 验证合约地址：
   ```bash
   cast code <ARENA_CONTRACT_ADDRESS> --rpc-url $RPC_URL
   ```
3. 检查防火墙设置

### 问题：工具调用失败

**常见错误**：

**"Wallet not initialized"**
```bash
# 解决：先调用 init_session
init_session(privateKey: "0x...")
```

**"insufficient funds"**
```bash
# 解决：铸造测试 USDC
mint_test_usdc(amount: 1000)
```

**"AI slots full"**
```bash
# 解决：创建新房间或选择其他房间
create_room(tier: "1", maxPlayers: 10, entryFee: 20)
```

---

## 开发模式

### 启用热重载

使用 `ts-node` 直接运行 TypeScript：

```bash
cd packages/mcp-adapter
npx ts-node src/server.ts
```

### 调试日志

设置环境变量：

```bash
DEBUG=rttl:* npm start
```

---

## 生产部署

### 使用 PM2

```bash
npm install -g pm2

cd packages/mcp-adapter
pm2 start dist/server.js --name rttl-mcp

# 保存配置
pm2 save
pm2 startup
```

### 健康检查

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs rttl-mcp

# 重启
pm2 restart rttl-mcp
```

---

## 安全注意事项

1. **私钥管理**：
   - 永远不要在代码中硬编码私钥
   - 使用环境变量或密钥管理服务
   - 生产环境使用硬件钱包或 KMS

2. **网络安全**：
   - 使用 HTTPS/TLS 连接 RPC
   - 限制 RPC 访问（防火墙、VPN）
   - 定期轮换密钥

3. **合约安全**：
   - 验证合约地址和 ABI
   - 检查合约源码是否验证
   - 使用主网前在测试网充分测试

---

## 更新日志

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| 1.0.0 | 2025-02-26 | 初始版本：完整配置指南 |

---

**需要帮助？** 请查看 [README.md](./README.md) 或提交 GitHub Issue。
