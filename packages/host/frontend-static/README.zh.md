# `@deepseek-ai/dsh-host-frontend-static`

[English](README.md) | 中文

Web 壳的 SPA dist 服务器：一个函数插件（配置为 `{distIndex}`），占据 [webserver](../webserver/README.md) 的唯一回退席位，并按壳层锁定的语义服务已构建的前端目录——越出 dist 根目录的遍历返回 403，任何未命中项都以 HTTP 200 回退到 `index.html`（SPA 路由），未知扩展名按 `application/octet-stream` 提供，GET／HEAD 之外的方法在没有匹配的具名路由时返回 405。每个 index 响应都会经过 webserver 已注册的 index 转换器（`applyIndexTaps`），启动 manifest（元数据清单）就是经这条路径送达页面的。`distIndex` 是组合应用的组装事实：[`dsh-web-app`](../../bundle/web-app/README.md) 通过前端包的 exports 解析它并挂载本插件；部署绝不硬编码它。

Cache-control 按资产类别区分：vite 内容哈希文件（`name-<hash>.<ext>`，以连字符哈希名称加已知扩展名识别）以 `public, max-age=31536000, immutable` 提供，因为重建会重命名文件，被钉住的 URL 不会再被请求；index 响应、`public/` 原样拷贝（PWA manifest、favicon）与未知扩展名则以 `no-cache` 提供。文本响应体（HTML、JS、CSS、SVG、JSON、sourcemap、manifest）在客户端的 `Accept-Encoding` 允许时经 [webserver](../webserver/README.md) 的 `gzipIfAccepted` 做 gzip 压缩；字体与未知二进制原样提供；每个响应都声明 `Vary: accept-encoding`。

回退席位只有单一所有者（第二次占据会抛错），并受 effect 作用域约束：dispose（资源释放）插件的 fiber 会释放席位，此后无人占据的 webserver 回答 404。

## 模型体验

无。该包只服务浏览器资产；其中没有任何内容会进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

- **初始 MIME 表很精简**：它覆盖 Vite 输出的资产集合及实际交付的 PWA manifest；其他扩展名在相应资产类别实际发布前都会回退到 `application/octet-stream`。
- **不可变钉扎依赖文件名模式**：若 `public/` 的某个拷贝恰好长得像内容哈希文件（`-<hash>.<ext>`），它会被永久钉扎；当前交付的 dist 不产生此类文件名。
