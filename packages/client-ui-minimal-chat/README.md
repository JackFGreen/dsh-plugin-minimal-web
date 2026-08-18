# @minimal-web/client-ui-minimal-chat

最小 React 聊天页面插件。页面只有文本输入框、发送按钮、错误提示和模型回答区域。

组件通过 `useSyncExternalStore` 订阅 `ctx.sessions`，不持有服务端会话状态。插件激活时向 `ctx.slots` 注册根组件，卸载时由 Cordis effect 自动移除。
