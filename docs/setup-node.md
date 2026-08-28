# Node.js 安装指南

Fourth Spark 通过 `npm install -g` 分发，因此需要一个**全局 bin 目录在 PATH 中**的 Node.js 环境。

## 推荐安装方式

以下任一方式均可，它们都会自动处理 PATH：

| 方式 | 命令 | 全局 bin 位置 |
|------|------|--------------|
| **Homebrew**（macOS 推荐） | `brew install node` | `/opt/homebrew/bin/` |
| **官网 .pkg 安装器** | 下载安装 | `/usr/local/bin/` |
| **nvm** | `nvm install --lts` | `~/.nvm/versions/node/vX.Y.Z/bin/` |
| **fnm** | `fnm install --lts` | 由 fnm 管理 |

装完后验证：

```bash
node --version
npm --version
```

## 手动安装（解压 tarball）

如果从 [nodejs.org](https://nodejs.org/en/download/) 下载 tarball 手动解压，**必须把解压目录的 `bin/` 加入 PATH**：

```bash
# 示例：解压到 ~/.local/node/
tar -xf node-vX.Y.Z-darwin-arm64.tar.xz -C ~/.local/node --strip-components=1

# ~/.zshrc 或 ~/.bashrc 中添加
export PATH="$HOME/.local/node/bin:$PATH"
```

### 常见错误

只软链 `node`/`npm`/`npx` 到 PATH 中的目录，而不把 npm 全局 bin 目录整体加入 PATH：

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

## 安装后验证

装完 Node.js 后，运行以下命令确认全局安装链路正常：

```bash
# 1. 装一个带 bin 的包
npm install -g cowsay

# 2. 在新开的 shell 中验证命令可达
exec $SHELL
command -v cowsay   # 应输出路径

# 3. 清理
npm uninstall -g cowsay
```

> 关键点：验证包管理器不是验证「它自己能不能跑」，而是验证「**它装出来的东西能不能被 shell 找到**」。`npx` 不走全局 bin 目录，不能用来验证 PATH 是否正确。

## 然后安装 Fourth Spark

```bash
npm install -g fourth-spark
fourth-spark start
```

详见 [部署运维](deployment.md)。
