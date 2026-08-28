# 部署运维

## npm 安装（推荐）

> 需要 Node.js 且全局 bin 目录在 PATH 中。新机器搭建环境参见 [Node.js 安装指南](setup-node.md)。

```bash
npm install -g fourth-spark
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

## 生产部署检查清单

- [ ] Docker 已安装且可运行
- [ ] OpenCode CLI 已安装（`opencode --version`）
- [ ] 端口 3000 可用（或通过 `--port` 指定其他端口）
- [ ] 端口 5432 可用（PostgreSQL）
- [ ] 端口 8081–8199 范围可用（OpenCode 子进程）
- [ ] （可选）配置 APNs 环境变量以启用 iOS 推送
- [ ] （可选）配置 `EXTRA_ORIGINS` 以允许额外的前端来源

## 更新

```bash
# 方式一：自我更新
fourth-spark upgrade

# 方式二：通过 npm
npm update -g fourth-spark
```

启动时如有新版本，终端会提示。Web UI 中也会显示版本更新通知。
