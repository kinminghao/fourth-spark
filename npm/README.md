# Fourth Spark

自托管的 AI Agent 平台 — 在浏览器中管理多个 Git 仓库，与 AI Agent 实时对话，让它们直接操作你的代码。

基于 [OpenCode](https://opencode.ai/)，每个仓库隔离为独立 Agent 运行时，集成 GitHub / Gitea / GitLab。

## 安装

```bash
npm install -g fourth-spark
```

安装时自动下载对应平台的编译二进制（macOS/Linux/Windows，x64/arm64）。

## 前置依赖

- [Docker](https://docs.docker.com/get-docker/) — 用于运行 PostgreSQL
- [OpenCode](https://opencode.ai/) CLI — `opencode serve`

## 使用

```bash
# 启动（自动拉起 PostgreSQL + 后台运行 server）
fourth-spark start

# 查看运行状态
fourth-spark status

# 停止所有服务
fourth-spark stop
```

启动后访问 **http://localhost:3000**。

## 所有命令

| 命令 | 说明 |
|------|------|
| `fourth-spark` | 前台启动 server（Ctrl-C 停止） |
| `fourth-spark start` | 后台启动（PostgreSQL + server） |
| `fourth-spark stop` | 停止所有服务 |
| `fourth-spark status` | 查看运行状态 |
| `fourth-spark upgrade` | 检查并更新到最新版本 |
| `fourth-spark --version` | 查看版本号 |

## 更新

```bash
# 自我更新（下载最新二进制并替换）
fourth-spark upgrade

# 或通过 npm
npm update -g fourth-spark
```

## 文档

完整文档、架构说明和开发指南见 [GitHub](https://github.com/kinminghao/fourth-spark)。

## License

MIT
