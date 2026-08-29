# 部署运维

## 依赖总览

Fourth Spark 通过 `npm install -g` 分发，运行时依赖 PostgreSQL（容器）和 Agent CLI。

| 依赖 | 用途 | 必须？ |
|------|------|--------|
| Node.js + npm | 安装和运行 fourth-spark | 是 |
| Docker 或 OrbStack | 运行 PostgreSQL 容器 | 是（二选一） |
| OpenCode CLI | 默认 Agent 运行时 | 是（至少装一个运行时） |
| Claude Code CLI | 可选 Agent 运行时 | 否 |

---

## 环境准备

### 1. Node.js & npm

Fourth Spark 通过 `npm install -g` 安装，因此需要一个**全局 bin 目录在 PATH 中**的 Node.js 环境。

#### macOS

以下任一方式均可，它们都会自动处理 PATH：

| 方式 | 命令 | 全局 bin 位置 |
|------|------|--------------|
| **Homebrew**（推荐） | `brew install node` | `/opt/homebrew/bin/` |
| **官网 .pkg 安装器** | [下载安装](https://nodejs.org/) | `/usr/local/bin/` |
| **nvm** | `nvm install --lts` | `~/.nvm/versions/node/vX.Y.Z/bin/` |
| **fnm** | `fnm install --lts` | 由 fnm 管理 |

#### Linux

| 方式 | 命令 |
|------|------|
| **nvm**（推荐） | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh \| bash && nvm install --lts` |
| **fnm** | `curl -fsSL https://fnm.vercel.app/install \| bash && fnm install --lts` |
| **apt（Ubuntu/Debian）** | `sudo apt update && sudo apt install -y nodejs npm` |
| **dnf（Fedora/RHEL）** | `sudo dnf install -y nodejs npm` |

> **注意**：部分 Linux 发行版的系统包管理器提供的 Node.js 版本较旧。推荐使用 nvm 或 fnm 获取最新 LTS 版本。

#### 手动安装（解压 tarball）

如果从 [nodejs.org](https://nodejs.org/en/download/) 下载 tarball 手动解压，**必须把解压目录的 `bin/` 加入 PATH**：

```bash
# 示例：解压到 ~/.local/node/
tar -xf node-vX.Y.Z-linux-x64.tar.xz -C ~/.local/node --strip-components=1

# ~/.zshrc 或 ~/.bashrc 中添加
export PATH="$HOME/.local/node/bin:$PATH"
```

**常见错误**：只软链 `node`/`npm`/`npx` 到 PATH 中的目录，而不把 npm 全局 bin 目录整体加入 PATH：

```bash
# 错误做法 — 之后 npm install -g 装的包都不可达
ln -s ~/.local/node/bin/node ~/.local/bin/node
ln -s ~/.local/node/bin/npm  ~/.local/bin/npm
```

npm 的全局 prefix 决定了 `npm install -g` 的安装目标目录。可以用以下命令确认：

```bash
npm prefix -g
# 输出即为全局 prefix，其下的 bin/ 目录必须在 PATH 中
```

#### 验证 Node.js 安装

```bash
node --version
npm --version

# 验证全局安装链路（关键！）
npm install -g cowsay
exec $SHELL
command -v cowsay   # 应输出路径
npm uninstall -g cowsay
```

> 关键点：验证包管理器不是验证「它自己能不能跑」，而是验证「**它装出来的东西能不能被 shell 找到**」。`npx` 不走全局 bin 目录，不能用来验证 PATH 是否正确。

### 2. 容器运行时

Fourth Spark 使用容器运行 PostgreSQL 数据库。

#### macOS

| 方式 | 安装 | 说明 |
|------|------|------|
| **OrbStack**（推荐） | `brew install orbstack` 或 [下载](https://orbstack.dev/) | 轻量快速，兼容 Docker CLI |
| **Docker Desktop** | `brew install --cask docker` 或 [下载](https://docs.docker.com/desktop/install/mac-install/) | 官方工具，较重 |

> OrbStack 和 Docker Desktop 都提供 `docker` 和 `docker-compose` 命令，二选一即可。

#### Linux

安装 Docker Engine（**不需要** Docker Desktop）：

**Ubuntu/Debian：**

```bash
# 添加 Docker 官方源
curl -fsSL https://get.docker.com | sh

# 免 sudo 运行（需重新登录生效）
sudo usermod -aG docker $USER
```

**Fedora/RHEL：**

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

#### 验证容器运行时

```bash
docker run --rm hello-world
```

### 3. Agent 运行时

Fourth Spark 支持多种 Agent 运行时，按仓库配置。至少需要安装一个。

#### OpenCode CLI（默认，推荐）

```bash
# macOS
brew install opencode-ai/tap/opencode

# Linux
curl -fsSL https://opencode.ai/install | bash
```

验证：

```bash
opencode version
```

#### Claude Code CLI（可选）

```bash
npm install -g @anthropic-ai/claude-code
```

验证：

```bash
claude --version
```

> Claude Code 是按仓库可选配置的运行时。不安装不影响使用 OpenCode 运行时的仓库。

---

## 安装 Fourth Spark

```bash
npm install -g fourth-spark
fourth-spark start
```

`postinstall` 脚本会根据当前平台自动从 GitHub Release 下载对应的编译二进制：

| 平台 | 产物 |
|------|------|
| macOS x64 | `fourth-spark-darwin-x64.tar.gz` |
| macOS arm64 | `fourth-spark-darwin-arm64.tar.gz` |
| Linux x64 | `fourth-spark-linux-x64.tar.gz` |
| Linux arm64 | `fourth-spark-linux-arm64.tar.gz` |
| Windows x64 | `fourth-spark-windows-x64.zip` |

npm 包内容：

```
fourth-spark/
├── bin/cli.js          # Node wrapper → 调用同目录下的编译二进制
├── postinstall.js      # 按平台下载二进制
├── fourth-spark        # 编译二进制（postinstall 下载）
├── public/             # 前端静态资源
├── drizzle/            # SQL migration 文件
├── docker-compose.yml  # PostgreSQL 容器配置
└── README.md
```

首次启动会自动完成以下操作：
1. 拉起 PostgreSQL 容器
2. 执行数据库 migration
3. 下载 SenseVoice 语音识别模型（约 240 MB，存放在 `~/.fourth-spark/models/sensevoice/`）

---

## CLI 命令详解

### `fourth-spark` / `fourth-spark serve`

前台启动 Server（`Ctrl-C` 停止）。

启动序列：
1. 连接 PostgreSQL
2. 自动执行 DB migration（生产模式）或 schema push（开发模式）
3. 初始化系统内置 Agent
4. 为所有注册的仓库启动 OpenCode 子进程
5. 启动 Session Monitor

启动后检查是否有新版本可用。

### `fourth-spark start [--port PORT]`

后台启动：

1. 启动 PostgreSQL Docker 容器（使用包内的 `docker-compose.yml`）
2. 等待 PostgreSQL 就绪
3. Fork server 进程到后台

可选参数：
- `--port PORT` — 指定 Server 监听端口（默认 3000）

### `fourth-spark stop`

停止所有服务：

1. 通过 PID 文件找到后台 server 进程并杀死
2. 停止 PostgreSQL 容器

### `fourth-spark status`

显示运行状态：
- Server 进程是否存活
- PostgreSQL 容器状态
- Server HTTP 可达性

### `fourth-spark upgrade`

检查并更新到最新版本：

1. 查询 GitHub Release 获取最新版本号
2. 与当前版本比较
3. 下载新版本二进制（tar.gz/zip）
4. 原子替换当前二进制（先写临时文件，再 rename）
5. 显示更新结果

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | Server 监听端口 |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS 允许的前端来源 |
| `EXTRA_ORIGINS` | (空) | 额外 CORS 来源，逗号分隔 |
| `DEFAULT_VARIANT` | `max` | 默认模型变体 |
| `STATIC_DIR` | `{二进制目录}/public` | 前端静态文件目录 |
| `APP_VERSION` | git commit hash | 版本号（构建时注入） |

### APNs 推送（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APNS_KEY_ID` | (空) | Apple Push Key ID |
| `APNS_TEAM_ID` | (空) | Apple Team ID |
| `APNS_KEY_PATH` | (空) | `.p8` 密钥文件路径 |
| `APNS_BUNDLE_ID` | `com.fourthspark.app` | App Bundle ID |
| `APNS_PRODUCTION` | `false` | 是否使用 APNs 生产环境 |

> 未配置 APNs 变量时，推送功能静默跳过，不影响 Server 运行。

### 数据库

PostgreSQL 连接参数通过 Docker Compose 配置：

```yaml
POSTGRES_USER: fourth_spark
POSTGRES_PASSWORD: fourth_spark
POSTGRES_DB: fourth_spark
```

端口映射 `5432:5432`。Drizzle 连接字符串在 `packages/server/drizzle.config.ts` 中配置。

---

## 生产部署检查清单

- [ ] Node.js + npm 已安装，全局 bin 在 PATH 中
- [ ] Docker 或 OrbStack 已安装且可运行
- [ ] OpenCode CLI 已安装（`opencode version`）
- [ ] 端口 3000 可用（或通过 `--port` 指定其他端口）
- [ ] 端口 5432 可用（PostgreSQL）
- [ ] 端口 8081–8199 范围可用（OpenCode 子进程）
- [ ] （可选）Claude Code CLI 已安装
- [ ] （可选）配置 APNs 环境变量以启用 iOS 推送
- [ ] （可选）配置 `EXTRA_ORIGINS` 以允许额外的前端来源

```bash
# 快速验证所有依赖
node --version           # >= 18
npm --version
docker --version
docker compose version
opencode version         # OpenCode
claude --version         # Claude Code（可选）
fourth-spark status
```

---

## 更新

```bash
# 方式一：自我更新
fourth-spark upgrade

# 方式二：通过 npm
npm update -g fourth-spark
```

启动时如有新版本，终端会提示。Web UI 中也会显示版本更新通知。

---

## CI/CD

GitHub Actions 工作流（`.github/workflows/release.yml`），由 git tag `v*` 触发：

### 构建阶段

5 个平台并行构建：

```
bun-linux-x64    → fourth-spark-linux-x64.tar.gz
bun-linux-arm64  → fourth-spark-linux-arm64.tar.gz
bun-darwin-x64   → fourth-spark-darwin-x64.tar.gz
bun-darwin-arm64 → fourth-spark-darwin-arm64.tar.gz
bun-windows-x64  → fourth-spark-windows-x64.zip
```

每个构建执行：
1. `bun install --frozen-lockfile`
2. `bash scripts/build.sh $TARGET`
3. 打包为 tar.gz（或 Windows 的 zip）
4. 上传为 GitHub Actions artifact

### 发布阶段

1. 下载所有平台的构建产物
2. 创建 GitHub Release（自动生成 release notes）
3. 上传 5 个平台的压缩包

### npm 发布阶段

1. 本地构建（不指定 target，产出 npm 包）
2. `npm publish dist/npm/ --access public`

> 需要在 GitHub Secrets 中配置 `NPM_TOKEN`。

## 跨平台构建流程

`scripts/build.sh` 执行以下步骤：

```bash
# 1. 构建前端
cd packages/web && APP_VERSION="$VERSION" bunx vite build

# 2. 复制静态资源
cp -r packages/web/dist → dist/public

# 3. 编译 Server 为原生二进制
bun build packages/server/src/cli.ts --compile --outfile dist/fourth-spark \
  --define "process.env.APP_VERSION=\"$VERSION\""
  [--target bun-linux-x64]  # 可选，指定目标平台

# 4. 生成 DB migration
cd packages/server && bunx drizzle-kit generate

# 5. 复制运行时资源
cp docker-compose.yml → dist/
cp -r packages/server/drizzle → dist/drizzle

# 6. 组装 npm 包（仅本地构建）
mkdir dist/npm && 复制 cli.js, postinstall.js, public/, drizzle/, docker-compose.yml
sed 替换 package.json 中的版本号
```

版本号从 git tag 提取（如 `v0.4.0` → `0.4.0`），无 tag 时 fallback 到 commit hash。

## 发布新版本

```bash
# 1. 确保代码已合并到 main
git checkout main && git pull

# 2. 打 tag
git tag v0.5.0
git push origin v0.5.0

# 3. GitHub Actions 自动执行
#    → 5 平台构建 → GitHub Release → npm publish
```
