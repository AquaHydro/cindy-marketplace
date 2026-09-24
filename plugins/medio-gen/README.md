# Medio Gen

Cindy 插件：通过用户自备的 **HTTPS** 网关做生图 / 改图，Grok 通道还可做视频。

本插件不是 OpenAI 或 xAI 的官方产品，也不代表它们背书。设置页通道图标分别来自 OpenAI 公开品牌路径（六瓣结）与 Lobe Icons 的 xAI 路径（MIT）；商标仍归各自权利人，MIT 许可不包含商标权。

源码位于本市场仓库的 `plugins/medio-gen/`。不要把 `.cindy` 提交进 Git。

## 支持的协议（需网关实际实现）

| 通道 | 能力 | 请求 |
| --- | --- | --- |
| Grok | 文生图 / 改图 | 一次 `POST /v1/images/generations`（改图把参考图放进 body，失败不改写重提） |
| Grok | 文生视频 / 图生视频 | 一次 `POST /v1/videos/generations`，再 `GET /v1/videos/{id}` 轮询。图生视频使用 `image` / `last_frame` |
| OpenAI | 文生图 | 一次 `POST /v1/images/generations` |
| OpenAI | 改图 | 一次 `POST /v1/images/edits` |
| OpenAI | 视频 | 不支持 |

OpenAI 通道额外支持 `size`（任意 `宽x高`）、`quality`、`background`、`output_format`，原样透传给网关。gpt-image-2 系列的 `size` 会先在本地按官方规则校验（宽高是 16 的倍数、最长边 ≤3840、长短边比 ≤3:1、总像素 655,360–8,294,400），不合规就不发付费请求。

`GET /v1/models` 只展示名称像图片/视频的模型，**不会**补全未出现在列表里的型号。

## 安全边界

- 网关必须是 `https://`。
- 付费 `POST` 不自动重试（避免重复扣费）。`GET` 列表 / 轮询 / 下载可重试。
- 下载结果 URL 时，只有与网关 **同源** 才带 `Authorization`。跨域 CDN 不携带网关 Key。主机名黑名单不能覆盖所有私网/DNS 解析到内网的情况，不要把它当成完整 SSRF 防护。

## 开发

```bash
node --check node/worker.cjs
node --check node/net-policy.cjs
node --check node/openai-size.cjs
node --check main.js
node --test tests/*.test.cjs
```

在 Cindy 中用 `ghost_forge_pack` / `ghost_forge_install` 打包。源码 `assets/icon.png` 必须是最终图标，不要依赖打包时临时 `icon_source`。
