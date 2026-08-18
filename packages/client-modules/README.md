# @minimal-web/client-modules

最小客户端模块清单插件。

Node 入口向 `host-webserver` 注册 `/boot.js`，把固定的浏览器插件列表和启动工作目录写入 `globalThis.__DSH_BOOT__`。浏览器入口 `./client` 校验清单，并按顺序使用原生 ESM `import()` 激活 Connection、Runtime 和 Chat 插件。

本包不扫描 Host Loader、不生成 revision、不实现预取、HMR 或模块工厂表。
