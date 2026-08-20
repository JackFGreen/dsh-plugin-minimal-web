# Minimal Web

## 项目简介

Minimal Web 是一个面向 DeepSeek Harness（DSH）的独立最小Web插件，用于演示如何绕过内置Web体系，只复用DSH的Agent、Session、LLM、设置和凭据能力，构建自己的Node HTTP服务与React页面。

项目提供完整的最小对话链路：浏览器创建Session并通过HTTP发送消息，Node端调用Agent，处理过程和模型回答通过WebSocket实时返回。前端仅包含文本输入、发送状态和模型内容回显，便于理解和验证Host插件、浏览器插件及Cordis服务之间的协作方式。

项目最终只打包和发布一个 `dsh-plugin-minimal-web` 包；内部 `@minimal-web/*` workspace包仅用于源码组织。运行时直接复用 `~/.dsh` 中的Provider、默认模型和凭据配置。

## Clone源码后使用

进入插件仓库根目录，然后按以下步骤操作。

### 1. 打包

```sh
pnpm install
pnpm pack --pack-destination release
```

`pnpm pack` 会自动执行测试和完整构建，并生成：

```text
release/dsh-plugin-minimal-web-0.1.0.tgz
```

### 2. 安装

```sh
pnpm dlx @deepseek-ai/dsh \
  plugin --profile minimal-web add -w \
  "./release/dsh-plugin-minimal-web-0.1.0.tgz"
```

该命令会自动创建 `minimal-web` Profile，并加载 `@deepseek-ai/dsh-base` 和 `dsh-plugin-minimal-web`，不需要手写Profile配置。

### 3. 启动

```sh
pnpm dlx @deepseek-ai/dsh --profile minimal-web
```

插件直接复用默认DSH目录中的Provider、默认模型和凭据配置。

启动成功后会输出访问地址：

```text
minimal web: http://127.0.0.1:3080
```
