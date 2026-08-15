# Agent Note：Web 响应交付以 gzip 压缩并钉扎内容寻址响应

状态：已实现

[English](2026-08-14-web-static-gzip-immutable-cache.md) | 中文

## 问题

公网（反向代理）访问 Web GUI 时启动很慢，因为每次页面加载都会完整重新下载整个客户端。bundle route 以 `no-cache` 且不带验证器提供 `/plugins/*/client.js`，dist 服务器完全不发送缓存头，也没有任何压缩：约 38 个插件 bundle 共 3 MB，加上外壳 dist（合计约 4.3 MB、40+ 个请求），每次启动都必须穿越公网，并以 HTTP/1.1 突发流量触发部署层的限流器。本地访问掩盖了这一点，因为回环传输成本为零。

## 决策

文件由两个持有者提供，webserver 保持纯载体，因此只增加共用的协商辅助函数。`dsh-host-webserver` 导出 `gzipIfAccepted(acceptEncoding, body)`：当客户端允许时（显式 `gzip` 标记且 `q` 不为 0，或裸 `*` 通配符；解析宽松，不做完整的 q-value 优先级处理），它对完整缓冲的响应体做 gzip 压缩，否则原样返回。两个文件服务消费方与 `/api` JSON-RPC 桥都调用它并声明 `Vary: accept-encoding`；SSE 等流式响应与二进制下载不在其契约范围内。

`dsh-client-connection` 的 HTTP 桥对完整缓冲的 JSON-RPC 响应做 gzip 压缩——例如 `session.history` 分页这类 unary 载荷，在大会话上可达数 MB（实测：11.4 MB 日志的 50 条消息尾部页约 5.9 MB，gzip 后约缩减 4 倍）。SSE 流（`text/event-stream`）与二进制下载（会话日志 zip）原样透传。

`dsh-client-modules` 的 bundle route 以 `public, max-age=31536000, immutable` 提供 `/plugins/<id>/client.js?rev=<hash>`：rev 查询参数对响应体做内容寻址，因此重建会改变 URL，被钉扎的响应不会再被请求。sourcemap（`/plugins/<id>/client.js.map`）不带 rev，保持 `no-cache`，使重建能到达 DevTools。

`dsh-host-frontend-static` 按文件名决定 cache-control：vite 内容哈希名称（已知扩展名集合上的 `name-<hash>.<ext>`）为 immutable；index 响应（携带含当前 rev 的启动 manifest）、`public/` 原样拷贝（PWA manifest、favicon）与未知扩展名均为 `no-cache`。文本响应体（HTML、JS、CSS、SVG、JSON、sourcemap、manifest）以 gzip 压缩；字体与未知二进制原样提供。

## 备选方案

- **以 brotli 代替 gzip**：暂缓——压缩率更高但 CPU 开销更大；gzip 只需一个协商分支，已覆盖当前部署。
- **在 webserver 中做透明压缩中间件**：否决——载体不知道内容类型与流式意图；文件服务与 RPC 的持有者才知道。
- **仅按扩展名做 immutable**：否决——`public/` 原样拷贝（favicon、manifest）不带哈希，会被永久钉扎；连字符哈希名称检查将它们排除在外。

## 后果

首次加载之后，启动只剩 index.html（rev manifest，`no-cache`）加缓存命中，公网刷新从 40+ 个请求变为一次往返；重建只重新获取 rev 发生变化的 bundle。反向代理现在可以有效地缓存（新鲜度加 `Vary`）。历史读取与其他 JSON-RPC 调用按未压缩字节数的约四分之一传输。gzip 只在缓存未命中与每个缓冲的 RPC 响应上消耗 CPU。唯一残余风险是某个未哈希文件名恰好长得像内容哈希——已作为 Known Limitation 记录；当前交付的 dist 不产生此类文件名。
