# Minimal Web

## 使用说明

### 1. 准备目录

在插件仓库根目录执行以下命令。这里假设 `deepseek-harness` 与插件目录同级；如目录结构不同，修改 `HARNESS_DIR` 即可：

```sh
PLUGIN_DIR="$PWD"
HARNESS_DIR="$(cd ../deepseek-harness && pwd)"
MINIMAL_DSH_HOME="$HOME/.dsh-minimal-web"
```

### 2. 安装依赖并构建

```sh
cd "$PLUGIN_DIR"
pnpm install
pnpm build
```

`pnpm build` 会先执行 TypeScript构建，再由 Vite生成 `packages/client-web/dist`。修改浏览器代码后需要重新执行该命令。

可选地运行完整单元测试：

```sh
pnpm test
```

### 3. 创建 `minimal-web` Profile

```sh
cd "$HARNESS_DIR"
DSH_HOME="$MINIMAL_DSH_HOME" \
  pnpm dsh plugin --profile minimal-web add "link:$PLUGIN_DIR"
```

第一次执行会初始化 `$MINIMAL_DSH_HOME/profiles/minimal-web`，保留基础 bundle，并将 `dsh-plugin-minimal-web` 加入该 Profile。重复执行用于刷新本地 link依赖，不需要修改 `deepseek-harness` 源码。

### 4. 配置模型密钥

插件目录的 `.env` 使用以下变量名：

```dotenv
API_KEY=你的模型密钥
```

启动时可以从插件目录加载：

```sh
set -a
source "$PLUGIN_DIR/.env"
set +a
```

也可以将 `.env` 放到 `$MINIMAL_DSH_HOME/.env`，DSH启动器会自动读取，此时无需执行 `source`：

```sh
cp "$PLUGIN_DIR/.env" "$MINIMAL_DSH_HOME/.env"
```

`.env` 不应提交到版本库。

### 5. 启动服务

```sh
cd "$HARNESS_DIR"
DSH_HOME="$MINIMAL_DSH_HOME" pnpm dsh --profile minimal-web
```

使用的是 Profile参数，不需要新增 `pnpm dsh miniweb` 子命令。启动成功后会输出访问地址：

```text
minimal web: http://127.0.0.1:3080
```

默认访问地址：

```text
http://127.0.0.1:3080
```

浏览器打开该地址即可发送消息。健康检查：

```sh
curl http://127.0.0.1:3080/health
```

预期输出：

```text
ok
```

按 `Ctrl+C` 停止服务。同一时间只能启动一个监听 `3080` 的实例；修改 Host代码、Profile或 `.env` 后需要重启服务。
