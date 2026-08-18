# Minimal Web 方案

如果按原有包的职责边界做“最小实现”，应保留分层，而不是把所有逻辑塞进一个 Server：

```text
React UI
  ↓
client-ui-slots
  ↓
client-runtime
  ↓
client-connection
  ↓ HTTP + WebSocket
host-webserver
  ↓
host-apiproxy
  ↓
Agent / Session / LLM
```

建议只实现：

- 一个 Session。
- 文本输入。
- LLM文本增量。
- 一个 HTTP上行接口。
- 一个 WebSocket下行通道。
- 不做历史恢复、工具展示、审批、设置、多会话、HMR。

## 每个包的最小职责

| 包                                      | 最小实现                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `dsh-host-webserver`                    | Node HTTP监听、精确/prefix路由、WebSocket Upgrade、生命周期关闭           |
| `dsh-host-apiproxy`                     | `session.create`、`session.prompt`、`events.mux` 三个接口；直接调用 Agent |
| `dsh-client-connection`                 | 浏览器HTTP Client、一个 WebSocket、重连可暂不实现                         |
| `dsh-client-modules`                    | 注入最小启动清单、加载浏览器插件；不做扫描和HMR                           |
| `dsh-client-runtime`                    | 一个 Session store；发送消息；折叠 Assistant delta                        |
| `dsh-client-ui-slots`                   | 只支持一个 `root` single slot                                             |
| `dsh-client-web`                        | `createRoot()`、创建浏览器 Cordis Context、加载插件、渲染 root            |
| 新增 `dsh-host-frontend-static-minimal` | 提供 Vite `dist`                                                          |
| 新增 `dsh-client-ui-minimal-chat`       | 输入框、发送按钮、回答显示                                                |

后两个是必要的：原来的七个包分别是基础设施，没有具体页面，也没有静态文件 fallback owner。

## 1. 先定义最小协议

建议由 `dsh-host-apiproxy` 拥有共享类型和 Schema。

### 创建 Session

```ts
interface SessionCreateRequest {
  cwd: string;
}

interface SessionCreateResponse {
  sessionId: SessionId;
}
```

HTTP：

```http
POST /api/session.create
```

### 发送消息

```ts
interface SessionPromptRequest {
  sessionId: SessionId;
  text: string;
}

interface SessionPromptResponse {
  accepted: true;
}
```

HTTP：

```http
POST /api/session.prompt
```

### 实时事件

保留真实 `SessionEvent`，不要重新创造一套只有字符串的模型：

```ts
interface SessionEventFrame {
  type: "session/event";
  sessionId: SessionId;
  event: SessionEvent;
}
```

WebSocket：

```text
ws://127.0.0.1:3080/api/events.mux
```

最小客户端只处理：

```text
user/message
assistant/chunk
assistant/message
turn/start
turn/end
```

成功标准：协议 Schema 能拒绝空文本、无效 Session ID 和非法 JSON。

## 2. 最小 `dsh-host-webserver`

仍然把 Node Server做成 Cordis Service：

```ts
class WebServer extends Service {
  constructor(ctx: Context, config: Config) {
    super(ctx, "webServer");
  }

  register(route: WebRoute): () => void;
  registerUpgrade(route: WebUpgradeRoute): () => void;
}
```

最小内部状态：

```ts
private routes = new Map<string, WebRoute>()
private upgrades = new Map<string, WebUpgradeRoute>()
```

启动：

```ts
async [Service.init]() {
  this.server = createServer(this.handle)
  await listen(this.server, host, port)
}
```

保留：

- `register()`
- `registerUpgrade()`
- 重复路由报错
- disposer
- Cordis关闭时释放端口

删除：

- prefix最长匹配可以先不做，只用 exact。
- index tap。
- fallback seat。
- 多级路由。
- HMR通道。

如果静态资源插件需要 fallback，再保留一个：

```ts
registerFallback(handler);
```

成功标准：

- `/health` 返回200。
- 插件卸载后路由消失。
- Cordis关闭后端口可重新监听。

## 3. 最小 `dsh-host-apiproxy`

提供：

```ts
interface MinimalApiProxy {
  createSession(request): Promise<Result>;
  prompt(request): Promise<Result>;
  subscribe(listener): () => void;
}
```

注册：

```ts
ctx.provide("apiProxy", apiProxy);
```

### 创建 Agent

```ts
const handle = await ctx.agents.create({
  sessionId: SessionId(randomUUID()),
  meta: {
    cwd: request.cwd,
  },
  agentOptions: {
    provider: "deepseek-official",
    model: "deepseek-v4-flash",
  },
});
```

保存：

```ts
const handles = new Map<SessionId, AgentHandle>();
```

### 发送消息

```ts
const handle = handles.get(sessionId);

handle.agent.followup(
  createUserMessage({
    content: [
      {
        type: "text",
        text,
      },
    ],
    source: {
      kind: "user",
    },
  }),
);
```

### 发布事件

只监听一次全局事件：

```ts
ctx.on("session/event", (session, event) => {
  publish({
    type: "session/event",
    sessionId: session.id,
    event,
  });
});
```

成功标准：

- `session.create` 返回新的 Agent/Session ID。
- `session.prompt` 调用真实 `agent.followup()`。
- LLM输出产生 `assistant/chunk`。
- 插件卸载时所有 `AgentHandle` 被 dispose。

## 4. 最小 `dsh-client-connection`

这个包仍然是双面包。

### Node half

依赖：

```ts
export const inject = ["webServer", "apiProxy"];
```

注册两个 HTTP接口：

```text
POST /api/session.create
POST /api/session.prompt
```

注册一个 WebSocket：

```text
GET Upgrade /api/events.mux
```

职责：

- 读取有限大小的 JSON body。
- 校验 Content-Type。
- 用 apiproxy Schema 验证。
- 调用 `ctx.apiProxy`。
- 把事件写入 WebSocket。
- 不允许浏览器通过 WebSocket发送消息。

### Browser half

提供：

```ts
interface Connection {
  createSession(cwd: string): Promise<SessionId>;
  prompt(sessionId: SessionId, text: string): Promise<void>;
  subscribe(listener: (frame: SessionEventFrame) => void): () => void;
}
```

注册：

```ts
ctx.provide("connection", connection);
```

内部使用：

```ts
fetch("/api/session.create");
fetch("/api/session.prompt");
new WebSocket("/api/events.mux");
```

MVP可以不自动重连。Socket关闭时将状态设为：

```ts
"disconnected";
```

成功标准：浏览器测试环境能收到一条模拟 `assistant/chunk`。

## 5. 最小 `dsh-client-runtime`

只管理一个会话：

```ts
interface ChatState {
  sessionId?: SessionId;
  status: "starting" | "ready" | "running" | "error";
  userText: string;
  assistantText: string;
  error?: string;
}
```

服务：

```ts
interface Sessions {
  getSnapshot(): ChatState;
  subscribe(listener: () => void): () => void;
  start(cwd: string): Promise<void>;
  send(text: string): Promise<void>;
}
```

初始化过程：

```text
ctx.connection订阅事件
  ↓
connection.createSession()
  ↓
记录sessionId
```

发送：

```ts
async send(text) {
  state.assistantText = ''
  state.status = 'running'

  await ctx.connection.prompt(
    state.sessionId,
    text,
  )
}
```

事件折叠：

```ts
if (
  frame.sessionId === state.sessionId &&
  frame.event.type === "assistant/chunk" &&
  frame.event.data.chunk.type === "text-delta"
) {
  state.assistantText += frame.event.data.chunk.text;
}

if (frame.event.type === "turn/end") {
  state.status = "ready";
}
```

这里不要实现完整 `ConversationSnapshot`，只保留输入、回答、状态。

成功标准：给定一组 SessionEvent，最终得到正确的 `assistantText`。

## 6. 最小 `dsh-client-ui-slots`

只实现内置：

```ts
interface SlotMap {
  root: {
    kind: "single";
    scope: "root";
  };
}
```

最小 API：

```ts
interface SlotRegistry {
  registerRoot(component: React.ComponentType): () => void;

  getRoot(): React.ComponentType | undefined;

  subscribe(listener: () => void): () => void;
}
```

仍然遵守 Cordis生命周期：

```ts
ctx.effect(() => ctx.slots.registerRoot(App));
```

不实现：

- `list`
- `keyed`
- `chain`
- session scope
- children declaration
- store
- priority
- locale
- owner/inject props组合

成功标准：

- 注册后能渲染。
- 第二个 root 注册明确报错。
- 插件卸载后 root 清空。

## 7. 最小 `dsh-client-modules`

如果仍要保留动态客户端插件，则只维护固定 Manifest：

```ts
interface BootEntry {
  id: string;
  url: string;
}
```

Node注入：

```html
<script>
  window.__DSH_BOOT__ = {
    entries: [
      {
        id: "@deepseek-ai/dsh-client-connection",
        url: "/plugins/connection.js",
      },
      {
        id: "@deepseek-ai/dsh-client-runtime",
        url: "/plugins/runtime.js",
      },
      {
        id: "@deepseek-ai/dsh-client-ui-minimal-chat",
        url: "/plugins/chat.js",
      },
    ],
  };
</script>
```

Browser Loader可以直接使用 ESM：

```ts
for (const entry of manifest.entries) {
  const plugin = await import(entry.url);
  await ctx.plugin(plugin);
}
```

这比现有 lazy-CJS factory table简单很多。

不实现：

- 扫描 Host Loader entries。
- `package.json#dsh.client`。
- bundle hash/revision。
- prefetch tier。
- module factory table。
- HMR invalidation。
- CSS ownership。

成功标准：三个固定插件按依赖关系全部进入 active。

## 8. 最小 `dsh-client-web`

Vite固定打包的 Shell只做：

```tsx
const root = createRoot(document.getElementById("root")!);

const ctx = new Context();

root.render(<Loading />);

await ctx.plugin(MinimalSlots);
await loadClientPlugins(ctx, window.__DSH_BOOT__);

root.render(<RootOutlet slots={ctx.slots} />);
```

`RootOutlet`：

```tsx
function RootOutlet({ slots }: Props) {
  const Component = useSyncExternalStore(slots.subscribe, slots.getRoot);

  return Component === undefined ? (
    <div>No root UI registered</div>
  ) : (
    <Component />
  );
}
```

保留：

- `createRoot`
- 浏览器 Cordis Context
- Loading
- 插件加载
- root渲染

删除：

- 完整 Fiber状态展示。
- platform seed table。-复杂 ClientModuleSystem。
- app-shell伪插件。
- SessionProvider。
- Slot renderer host。

## 9. 最小聊天 UI 插件

新增：

```text
@deepseek-ai/dsh-client-ui-minimal-chat
```

浏览器入口：

```ts
export const inject = ["slots", "sessions"];
```

注册：

```tsx
export function apply(ctx: ClientContext): void {
  ctx.effect(() =>
    ctx.slots.registerRoot(() => <ChatApp sessions={ctx.sessions} />),
  );
}
```

组件只有：

```tsx
<textarea />
<button>发送</button>
<pre>{assistantText}</pre>
```

状态通过：

```ts
useSyncExternalStore(ctx.sessions.subscribe, ctx.sessions.getSnapshot);
```

## 10. 静态资源插件

如果保持 `host-webserver` 的单一职责，还需新增：

```text
@deepseek-ai/dsh-host-frontend-static-minimal
```

职责：

```text
GET /assets/* → dist/assets/*
GET /*        → dist/index.html
```

不要把文件读取塞入 `host-webserver`，否则 WebServer又会同时负责 transport和某个具体应用。

## 最小依赖关系

```text
Host：

agent-spine
├── agents
├── sessions
├── agentLoop
└── llm

host-apiproxy
└── inject: [agentLoop]

host-webserver

client-connection (Node)
└── inject: [webServer, apiProxy]

client-modules (Node)
└── inject: [webServer]

frontend-static-minimal
└── inject: [webServer]


Browser：

client-connection
└── provide: connection

client-runtime
└── inject: [connection]
    └── provide: sessions

client-ui-slots
└── provide: slots

client-ui-minimal-chat
└── inject: [slots, sessions]

client-web
└── 加载以上插件并渲染root
```

## 推荐实施顺序

1. 定义最小API和事件类型  
   验证：Schema非法测试通过。

2. 实现 `host-apiproxy` 的 Agent桥接  
   验证：无网络条件下能驱动确定性测试 LLM。

3. 实现 `host-webserver` 和 connection Node half  
   验证：curl可以创建 Session、发送消息。

4. 实现 WebSocket事件下行  
   验证：能收到 `assistant/chunk` 和 `turn/end`。

5. 实现 connection Browser half  
   验证：浏览器API测试能发送请求和接收事件。

6. 实现最小 runtime fold  
   验证：SessionEvent序列折叠为回答文本。

7. 实现 root-only slots 和聊天插件  
   验证：组件能显示 runtime状态。

8. 实现 client-modules 和 client-web启动  
   验证：生产 `dist` 页面能动态加载三个插件。

9. 组装最小 Web profile  
   验证：真实浏览器中输入文字，看到真实 LLM流式回答。

10. 替换 `dsh web`  
    验证：全新 `DSH_HOME` 与已有 profile升级路径都正确。

11. 将固定客户端清单插件化  
    每个浏览器插件在自己的 `package.json` 中声明客户端入口，例如：

    ```json
    {
      "dsh": {
        "client": {
          "entry": "./src/index.tsx"
        }
      }
    }
    ```

    构建阶段扫描已安装插件的声明，自动生成 Vite/Rollup 多入口，输出独立的
    `/plugins/*.js`；`client-modules` 使用同一份扫描结果生成
    `window.__DSH_BOOT__`，不再手工维护第二份 URL清单。`client-web` 只负责校验
    Manifest、按依赖关系加载 ESM并交给 Cordis激活，不感知具体插件名称。

    保留以下约束：

    - Host明确决定哪些插件可以进入浏览器，不允许页面任意导入 npm包。
    - 构建时检查重复插件 ID、缺失入口和无效依赖。
    - Cordis和 React只能有一个共享运行时实例，插件包不能各自打包副本。
    - 插件卸载仍通过 Cordis Fiber释放 Slot、订阅和其他 effect。

    验证：新增第四个客户端插件时，只需安装该插件并声明 `dsh.client.entry`，无需
    修改 `client-web/vite.config.ts` 或 `client-modules/manifest.ts`，构建产物和
    `__DSH_BOOT__` 会自动出现对应条目，浏览器能够按 `inject` 依赖激活并在卸载时
    完整清理。

这个版本仍然保留了原架构最重要的边界：

```text
HTTP监听
≠ Agent API
≠ Browser Transport
≠ Client State
≠ React组合
≠ Browser Boot
```

只是把每个包缩到完成单输入框、单回答流所需的最小功能。
