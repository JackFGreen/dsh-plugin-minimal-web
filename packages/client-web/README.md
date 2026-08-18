# @minimal-web/client-web

最小浏览器 Shell。它创建 React Root 和浏览器 Cordis Context，先安装内置 Root Slots，再读取 `/boot.js` 注入的固定清单，依次加载 Connection、Runtime、Chat，最后创建 Session 并渲染 Root Slot。

Vite 只负责把 Shell 和三个浏览器插件编译成生产静态资源；运行时 HTTP、WebSocket 和静态文件均由 Node WebServer 提供。
