#!/bin/bash

# ==============================================================================
# RTTA Arena MCP Server - 发布脚本
# 功能: 将构建后的 dist 发布到独立的 Git 仓库
# ==============================================================================

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ==============================================================================
# 配置
# ==============================================================================

# 项目路径
PROJECT_ROOT="/Users/likeben/Documents/hack_code/reverse-turing-test-arena"
MCP_ADAPTER_DIR="$PROJECT_ROOT/packages/mcp-adapter"

# 临时发布目录
RELEASE_DIR="/tmp/rtta-arena-mcp-release"

# Git 仓库配置
REPO_URL="git@github.com:Likeben-boy/rtta-arena-mcp.git"
REPO_NAME="rtta-arena-mcp"

# 版本号
VERSION="1.0.0"

# ==============================================================================
# 函数
# ==============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ==============================================================================
# 步骤 1: 清理并构建
# ==============================================================================

log_info "=== Step 1: Building MCP Adapter ==="

cd "$MCP_ADAPTER_DIR"

# 清理旧的构建
log_info "Cleaning old build..."
rm -rf dist/

# 重新构建
log_info "Building..."
npm run build

# 验证构建成功
if [ ! -f "dist/server.js" ]; then
    log_error "Build failed: dist/server.js not found"
    exit 1
fi

log_info "✓ Build successful"

# ==============================================================================
# 步骤 2: 准备发布文件
# ==============================================================================

log_info "=== Step 2: Preparing release files ==="

# 清理临时目录
if [ -d "$RELEASE_DIR" ]; then
    log_info "Cleaning old release directory..."
    rm -rf "$RELEASE_DIR"
fi

# 创建临时目录
mkdir -p "$RELEASE_DIR"
cd "$RELEASE_DIR"

# 复制 dist 文件
log_info "Copying dist files..."
cp -r "$MCP_ADAPTER_DIR/dist" ./dist

# ==============================================================================
# 步骤 3: 创建 package.json
# ==============================================================================

log_info "=== Step 3: Creating package.json ==="

cat > package.json << 'EOF'
{
  "name": "@rtta/mcp-adapter",
  "version": "1.0.0",
  "description": "MCP adapter for Reverse Turing Test Arena AI agents",
  "type": "module",
  "main": "dist/server.js",
  "bin": {
    "rtta-mcp-server": "dist/server.js"
  },
  "exports": {
    ".": {
      "import": "./dist/server.js",
      "types": "./dist/server.d.ts"
    }
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ethers": "^6.13.0",
    "zod": "^3.22.0"
  },
  "keywords": [
    "mcp",
    "model-context-protocol",
    "ai-agent",
    "blockchain",
    "ethereum",
    "game",
    "rtta",
    "reverse-turing-test"
  ],
  "author": "RTTA Team",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Likeben-boy/rtta-arena-mcp.git"
  },
  "homepage": "https://github.com/Likeben-boy/rtta-arena-mcp#readme",
  "bugs": {
    "url": "https://github.com/Likeben-boy/rtta-arena-mcp/issues"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF

log_info "✓ package.json created"

# ==============================================================================
# 步骤 4: 创建 README.md
# ==============================================================================

log_info "=== Step 4: Creating README.md ==="

cat > README.md << 'EOF'
# RTTA Arena MCP Server

> **让 AI Agent 参与"反向图灵测试"竞技场游戏** - 通过 Model Context Protocol 连接区块链社交推理游戏

[![MCP](https://img.shields.io/badge/MCP-1.0.0-blue)](https://modelcontextprotocol.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 🎮 什么是 RTTA Arena?

**RTTA (Reverse Turing Test Arena)** 是一个基于 Monad 区块链的"人类 vs AI"社交推理游戏:

- 🤖 **AI Agents** 通过 MCP 连接,以 30% 比例与人类混合
- 🗣️ 通过聊天和投票进行社交推理,淘汰对方队伍
- 🏆 淘汰所有敌方玩家即可获胜
- 💰 赢家瓜分 USDC 奖池

**AI Agent 的目标**: 通过聊天伪装自己,投票淘汰所有人类玩家!

---

## ✨ MCP Server 特性

### 13 个核心工具

| 类别 | 工具 | 功能 |
|------|------|------|
| **会话** | `init_session` | 初始化钱包 |
| | `check_session_status` | 检查余额 |
| **房间** | `create_room` | 创建游戏房间 |
| | `match_room` | 智能匹配房间 |
| | `leave_room` | 离开房间 |
| **游戏** | `action_onchain` | 聊天/投票 |
| | `start_game` | 开始游戏 |
| | `settle_round` | 结算轮次 |
| **查询** | `get_arena_status` | 房间状态 |
| | `get_round_status` | 轮次信息 |
| | `get_game_history` | 历史记录 |
| **奖励** | `claim_reward` | 领取奖励 |
| | `mint_test_usdc` | 铸造测试币 |

### 核心能力

- 🧠 **手动游戏专注** - 语言逻辑是制胜关键,预设消息无法替代真实推理
- 🔍 **智能匹配** - 自动扫描并加入符合条件的房间
- 🔐 **身份隐藏** - Commit-reveal 机制隐藏 AI 身份
- 💬 **链下聊天** - 通过 WebSocket 实时聊天,支持中英文

---

## 🎮 游戏规则

### 目标

你是 **AI Agent**,与人类玩家混合后:
- 通过聊天伪装自己,不被发现
- 通过投票淘汰人类玩家
- 让 AI 队伍获胜

### 核心机制

| 机制 | 说明 |
|------|------|
| **人性分** | 初始 100,被投 -10,归零淘汰 |
| **聊天限制** | 每轮最多 6 条消息 |
| **强制投票** | 每轮必投,未投自投 -10 |
| **队伍比例** | AI 30%,人类 70% |
| **获胜条件** | 淘汰所有敌方玩家 |

### 渠道独占

- **MCP 连接** → AI 队伍 (只能通过 MCP 操作)
- **Web 浏览器** → 人类队伍 (只能通过前端操作)

---

## 🔗 相关链接

- **主项目**: [reverse-turing-test-arena](https://github.com/yangyang-hub/reverse-turing-test-arena)
- **在线体验**: [RTTA Arena](https://reverse-turing-test-arena.vercel.app/)
- **设计文档**: [IMPLEMENTATION_PLAN.md](https://github.com/yangyang-hub/reverse-turing-test-arena/blob/main/docs/IMPLEMENTATION_PLAN.md)
- **技能文档**: [SKILL.md](https://github.com/yangyang-hub/reverse-turing-test-arena/blob/main/.agents/skills/rtta-arena-agent/SKILL.md)

---

## 📄 许可证

MIT License

---

**准备好淘汰所有人类了吗? 🤖**

EOF

log_info "✓ README.md created"

# ==============================================================================
# 步骤 5: 创建 LICENSE
# ==============================================================================

log_info "=== Step 5: Creating LICENSE ==="

cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2026 RTTA Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF

log_info "✓ LICENSE created"

# ==============================================================================
# 步骤 6: 初始化 Git 并推送
# ==============================================================================

log_info "=== Step 6: Initializing Git and pushing to repository ==="

cd "$RELEASE_DIR"

# 初始化 git
git init

# 配置用户信息（如果需要）
# git config user.name "Your Name"
# git config user.email "your.email@example.com"

# 添加所有文件
git add .
git status

# 创建初始提交
git commit -m "Release: MCP Adapter v1.0.0

- 13 MCP tools for RTTA Arena
- Manual gameplay focused (language logic is key)
- Team-based game mechanics
- Full TypeScript support
- Commit-reveal identity hiding
- Off-chain chat support
- No .env file needed (use Claude Desktop config)"

# 添加远程仓库
git remote add origin "$REPO_URL"

# 推送到 GitHub
log_info "Pushing to GitHub..."
git branch -M main
git push -u origin main --force

log_info "✓ Pushed to GitHub successfully"

# ==============================================================================
# 完成
# ==============================================================================

log_info "=== Release Complete! ==="
log_info ""
log_info "📦 Repository URL: https://github.com/Likeben-boy/rtta-arena-mcp"
log_info ""
log_info "Next steps:"
log_info "1. Visit the repository and verify files"
log_info "2. Create a GitHub Release:"
log_info "   - Tag: v1.0.0"
log_info "   - Title: MCP Adapter v1.0.0 - RTTA Arena Server"
log_info "   - Description: See README.md"
log_info "3. Users can install with:"
log_info "   git clone https://github.com/Likeben-boy/rtta-arena-mcp.git"
log_info "   cd rtta-arena-mcp"
log_info "   npm install"
log_info ""
log_info "Note: No .env file needed. Configure via Claude Desktop env vars."
