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

## 单包打包与发布方案

目标是只发布一个 npm 包：

```text
dsh-plugin-minimal-web
```

`packages/` 下的 `@minimal-web/*` 仅用于仓库内开发，不单独发布。发布包必须包含运行所需的全部插件入口、浏览器静态资源和 Cordis 配置，安装后不能再依赖本仓库源码或内部 workspace 链接。

### 1. 生成自包含产物

Node端使用打包工具将以下入口及它们引用的 `@minimal-web/*` 代码打入根包的 `lib/`：

- `host-apiproxy`
- `host-webserver`
- `client-connection`
- `client-modules`
- `host-frontend-static-minimal`

浏览器端继续由 Vite生成静态资源，输出到发布包的 `web/`。React、Client Connection、Runtime、UI Slots和Minimal Chat都包含在这些浏览器产物中。

构建时遵循以下依赖规则：

- 所有 `@minimal-web/*` workspace引用必须打入产物，发布包中不能保留 `workspace:*`。
- `@deepseek-ai/*` 和 `@deepseek-ai/cordis` 由 DSH基础 bundle提供，作为external保留。
- `ws`、`zod` 等插件自己的Node运行时依赖由根 `package.json` 声明。

目标发布结构：

```text
dsh-plugin-minimal-web/
├── package.json
├── README.md
├── cordis.patch.yml
├── lib/
│   ├── host-apiproxy.js
│   ├── host-webserver.js
│   ├── client-connection.js
│   ├── client-modules.js
│   └── host-frontend-static-minimal.js
└── web/
    ├── index.html
    ├── assets/
    └── plugins/
```

`/boot.js` 仍由 `client-modules` Host插件在运行时生成，不作为静态文件打入tarball。

根 `package.json` 需要同步完成以下调整：

- 删除 `private: true`。
- 将 `exports` 改为指向 `lib/` 中的发布入口。
- 将 `files` 限定为 `lib/`、`web/`、`cordis.patch.yml` 和必要文档。
- 增加 `prepack` 脚本，在打包和发布前执行测试及完整构建。
- 保留以下bundle声明，让DSH识别该包：

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

### 2. 本地 tarball 验证

完成单包构建后，先生成tarball，不要直接发布：

```sh
pnpm install
pnpm test
pnpm build
pnpm pack --pack-destination <输出目录>
```

预期只生成一个包：

```text
dsh-plugin-minimal-web-0.1.0.tgz
```

在一个未引用源码仓库的Profile中安装并启动：

```sh
npx @deepseek-ai/dsh@0.1.0-rc.5 \
  plugin --profile minimal-web add ./dsh-plugin-minimal-web-0.1.0.tgz

npx @deepseek-ai/dsh@0.1.0-rc.5 --profile minimal-web
```

`dsh plugin add` 会自动创建Profile，并生成如下bundle关系，不需要用户手写Profile配置：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-plugin-minimal-web"
      ]
    }
  }
}
```

发布前至少验证：

- Profile的依赖中只有一个本项目发布包，不包含任何 `@minimal-web/*` 包。
- 不依赖插件源码目录也能启动。
- `/health` 返回 `ok`。
- 浏览器可以创建Session、发送消息并收到LLM事件。
- tarball中不包含 `.env`、API Key、源码、测试、缓存和构建临时文件。

### 3. 发布到 npm

本地tarball验证通过后登录npm并发布：

```sh
pnpm login
pnpm publish --access public
```

每次重新发布前必须更新版本号。发布后用户只需安装根包：

```sh
npx @deepseek-ai/dsh@0.1.0-rc.5 \
  plugin --profile minimal-web add dsh-plugin-minimal-web@0.1.0

npx @deepseek-ai/dsh@0.1.0-rc.5 --profile minimal-web
```

默认Profile保存在 `~/.dsh/profiles/minimal-web`。只有需要隔离不同DSH环境时才设置 `DSH_HOME`，安装和启动时应使用相同的值。
