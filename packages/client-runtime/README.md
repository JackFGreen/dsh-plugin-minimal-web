# @minimal-web/client-runtime

最小浏览器会话状态服务。它依赖 `ctx.connection` 创建一个 Session、发送文本，并把当前 Session 的实时事件折叠为适合聊天页面读取的状态。

本包只维护 `sessionId`、运行状态、用户输入、模型文本和错误信息。不负责 React 渲染、历史恢复、多会话、重连或完整 Conversation Snapshot。

## API

- `start(cwd)`：创建 Session，成功后进入 `ready`。
- `send(text)`：清空上一条回答并调用 `connection.prompt()`。
- `getSnapshot()`：返回稳定的当前状态快照。
- `subscribe(listener)`：订阅状态变化。

收到当前 Session 的 `assistant/chunk` 且 chunk 类型为 `text-delta` 时，文本会追加到 `assistantText`；收到 `turn/end` 后状态回到 `ready`。
