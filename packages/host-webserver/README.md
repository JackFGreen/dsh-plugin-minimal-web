# 最小宿主 Web 服务器

`@minimal-web/host-webserver` 提供 `ctx.webServer`，作为重写 Web 技术栈的轻量 Node HTTP 承载服务。它持有监听端口，并管理精确路径的 HTTP 路由和 Upgrade 路由，但不解析 API 请求体，也不提供前端文件。

内置的 `GET /health` 接口返回 `200 ok`。`register()` 和 `registerUpgrade()` 会拒绝重复路径，并返回幂等的注销函数。查询字符串不参与路径匹配。

服务支持绑定到 `127.0.0.1` 或 `0.0.0.0`。端口配置为零时由操作系统分配端口；服务激活后可通过 `ctx.webServer.port` 获取实际端口。

Cordis 清理完成前会关闭普通 HTTP 连接和已升级的 Socket，并释放监听端口。前缀路由、静态资源 fallback、首页转换、HMR、TLS 和身份认证不属于本包的职责。
