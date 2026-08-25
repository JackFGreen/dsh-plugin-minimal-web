# @minimal-web/client-runtime

最小浏览器会话状态服务。它依赖 `ctx.connection` 创建一个 Session、发送文本，并把当前 Session 的实时事件折叠为适合聊天页面读取的状态。

本包维护 `sessionId`、运行状态、有序过程时间线和错误信息。时间线包含用户消息、轮次、步骤、思考、模型回答以及按 `callId` 配对的工具调用与结果。不负责 React 渲染、历史恢复、多会话、重连或完整 Conversation Snapshot。

## API

- `start(cwd)`：创建 Session，成功后进入 `ready`。
- `send(text)`：将用户消息追加到时间线并调用 `connection.prompt()`，保留之前的轮次。
- `getSnapshot()`：返回稳定的当前状态快照。
- `subscribe(listener)`：订阅状态变化。

`reasoning-delta` 和 `text-delta` 按轮次、步骤及块索引增量合并；`tool/call` 创建工具节点，`tool/result` 按 `callId` 更新结果或错误；`step/start`、`step/end`、`turn/start` 和 `turn/end` 更新过程边界。收到 `turn/end` 后状态回到 `ready`。
