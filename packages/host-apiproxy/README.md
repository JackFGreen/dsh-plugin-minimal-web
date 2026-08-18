# 最小宿主 API 代理

`@minimal-web/host-apiproxy` 定义最小浏览器客户端与宿主之间交换的 JSON 消息，并提供与传输方式无关的 `ctx.apiProxy` 服务。HTTP 路由注册仍由独立的客户端连接包负责。

## 协议

本包定义 `session.create` 和 `session.prompt` 的请求与响应字段，以及通过 `events.mux` 发送的 `SessionEventFrame`。`SessionId` 和 `SessionEvent` 来自 `@deepseek-ai/dsh-session`；最小 Web 实现不会另建一套会话标识或事件模型。

`parseWireJson()` 先解析 JSON，再应用传入的 Schema。无效 JSON 抛出 `SyntaxError`，字段不符合 Schema 时抛出 `ZodError`。提示文本必须包含至少一个非空白字符，校验通过后仍保留原始空白。

会话事件 Schema 校验固定的事件外层字段，并允许 `data` 包含扩展字段，因为插件可以扩展 `SessionEventMap`。后续的客户端运行时只会明确折叠它支持的事件类型。

## 服务

该 Cordis 服务依赖 `agents` 和 `agentLoop`。`provider` 与 `model` 配置决定每个浏览器所创建 Agent 使用的模型路由。`createSession()` 创建并持有一个 `AgentHandle`，`prompt()` 通过 `Agent.followup()` 提交带身份来源的用户消息，`subscribe()` 只接收由本服务持有的 Session 所产生的持久化事件。

订阅者抛出的异常会被记录和隔离，不会阻止其他订阅者接收事件。卸载时，服务停止发送事件，等待正在创建的 Agent 完成，并在清理结束前等待所有已持有的 `AgentHandle.dispose()` 完成。

## 已知限制与后续工作

本包不注册 HTTP 或 WebSocket 路由。最小 API 暂不支持历史记录、会话恢复、工具展示、审批、设置和自动重连。
