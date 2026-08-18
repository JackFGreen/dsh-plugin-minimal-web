# @minimal-web/client-ui-slots

最小浏览器 Root Slot 服务，只允许注册一个 React 根组件。

- `registerRoot(component)`：注册根组件并返回幂等卸载函数。
- `getRoot()`：读取当前根组件。
- `subscribe(listener)`：订阅根组件变化。

第二次注册会明确报错。注册方应通过 `ctx.effect()` 持有卸载函数，使插件卸载时自动清空 Root Slot。
