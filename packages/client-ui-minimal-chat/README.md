# @minimal-web/client-ui-minimal-chat

最小 React 聊天页面插件。页面包含文本输入框、发送按钮、错误提示和有序Agent过程时间线，可显示用户消息、轮次、步骤、思考、工具调用参数、工具结果以及模型回答。

组件通过 `useSyncExternalStore` 订阅 `ctx.sessions`，不持有服务端会话状态。插件激活时向 `ctx.slots` 注册根组件，卸载时由 Cordis effect 自动移除。
