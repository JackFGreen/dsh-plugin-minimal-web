# 最小客户端连接

`@minimal-web/client-connection` 将浏览器传输接入 `ctx.apiProxy`。Node 入口依赖 `ctx.webServer` 和 `ctx.apiProxy`，浏览器入口提供 `ctx.connection`；两端都不创建 Agent，也不处理 React 状态。

## HTTP 上行

插件注册两个精确路径接口：

- `POST /api/session.create`
- `POST /api/session.prompt`

请求必须使用 `application/json`，请求体最大为 64 KiB，并使用 `host-apiproxy` 提供的 Schema 校验。方法错误返回 405，媒体类型错误返回 415，请求体过大返回 413，无效 JSON 或字段返回 400，API 执行失败返回 500。

## WebSocket 下行

`/api/events.mux` 接受 WebSocket Upgrade。插件订阅 `ctx.apiProxy` 的事件，并将每个 `SessionEventFrame` 序列化为 JSON 后发送给所有已连接的浏览器。

该通道只允许服务端下发数据。浏览器发送消息时，连接以策略错误关闭。首版不支持身份认证、事件筛选、断线重连或消息补发。

插件卸载时会注销所有路由、取消 API 订阅并终止仍然打开的 WebSocket。

## 浏览器端

`@minimal-web/client-connection/client` 使用 `fetch()` 调用两个 HTTP 接口，并在激活期间建立 `/api/events.mux` WebSocket。`createSession()` 返回经过 Schema 校验的 `SessionId`，`prompt()` 只在服务端返回 `{ accepted: true }` 后完成。

浏览器端只向订阅者发布通过 `SessionEventFrame` Schema 校验的文本消息。非法 JSON、非法事件字段或二进制消息会被记录，并使 WebSocket 以无效载荷状态关闭。单个订阅者抛出的异常不会阻止其他订阅者。

连接状态为 `connecting`、`connected` 或 `disconnected`。首次激活会等待 WebSocket 建立，关闭后不会自动重连；插件卸载会清空订阅者并关闭连接。
