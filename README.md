# Minimal Web

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
