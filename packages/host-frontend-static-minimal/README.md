# @minimal-web/host-frontend-static-minimal

最小前端静态资源 Host 插件。它占用 `host-webserver` 的唯一 fallback：

- `/assets/*` 和 `/plugins/*` 返回 Vite 构建文件。
- 其他 GET 路径返回 `index.html`。
- 找不到的静态资源返回 404，不回退到 HTML。

插件只负责文件映射和 Content-Type；监听端口、精确 API 路由和 WebSocket Upgrade 仍由 `host-webserver` 管理。
