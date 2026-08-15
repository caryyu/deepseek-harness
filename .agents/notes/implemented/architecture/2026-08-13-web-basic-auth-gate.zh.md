# Agent Note：Web Basic auth gate 以 webserver 可选席位落地

状态：已实现

[English](2026-08-13-web-basic-auth-gate.md) | 中文

## 问题

Web GUI 需要部署级认证层，而浏览器施加了一条硬约束：`new WebSocket()` 不能带自定义 header，且各浏览器不保证在 upgrade 握手时复用已缓存的 Basic 凭据。因此纯 `Authorization: Basic` 校验会认证所有 HTTP 调用，却会悄悄杀死两条事件下行。现有 `/api` 浏览器信任栅栏明确不是认证——它自己的文档把真正的认证层列为延期工作——而逐 route 检查必须在每个注册点重复（HTTP route、两条 upgrade route、`/plugins`、静态 fallback），必然留下漏洞。

## 决策

`dsh-host-webserver` 新增唯一可选认证席位 `registerAuth(check)`，在每次 HTTP 分发与每次 upgrade 分发之前执行，因此一次注册即可同时保护具名 route、静态 fallback 与 404 应答。服务器只拥有拒绝协议：返回 false 时 HTTP 侧以 401 加 `WWW-Authenticate: Basic realm="dsh"` 应答、upgrade 侧销毁 socket；gate 抛错则落入既有的逐请求 400 兜底。gate 语义放在 `dsh-client-connection`（`src/basic-auth.ts`），即拥有信任栅栏的同一个包，由新的可选 `basicAuth` 配置值（`user:pass`）驱动。

gate 接受两个通道，因为浏览器无法把同一份凭据带到所有地方：有效的 Basic header 放行并签发派生会话 cookie（`dsh-auth`，即凭据的 SHA-256，`HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`），此后有效 cookie 直接放行。同源 WebSocket 会带 cookie，这正是两条下行得以工作的原因。没有会话表，除改凭据外没有吊销手段；凭据与 cookie 的比较均为恒定时间，格式非法的 `basicAuth` 值会在配置边界让插件加载明确报错。

CLI 以 `--basic-auth <user:pass>` 发布该值，回退到 `DSH_BASIC_AUTH` 环境变量（flag 优先；环境变量形式让密码不进 `ps` 与 shell history）。web-app patch 把它注入 connection 行。未提供该值时 gate 不注册，一切请求照旧分发。

浏览器侧保持最小：首次未认证导航时 401 挑战唤起原生登录框，随后 `fetch` 自动复用缓存凭据，而 `web-api-client.ts` 会在每个被拒会话上导航一次（以 sessionStorage 标记防循环），使过期会话重新弹窗而不是静默失败。成功响应清除标记。PWA manifest（`GET /manifest.webmanifest`）绕过 gate：Chromium 以 credentials 'omit' 拉取它（早于页面认证状态存在），其内容只是公开的 PWA 元数据。

gate 同时充当信任栅栏所延期的真正认证层：经其验证的请求携带 `AUTHENTICATED` 戳记（模块 symbol），HTTP bridge 把它交给 fetch 形态的 handler，而特权方法回环钉扎（settings/credentials 配置面、原生对话框、agent-preset 创作面）会放行任何受信任权威上的已戳记请求。戳记之所以必要，是因为 manifest 绕过不是认证。这对 DNS rebinding 是安全的，因为浏览器无法把 gate 的凭据（cookie 仅同站，Basic 凭据是秘密）带到被重绑的页面。

## 备选方案

- **在 connection 内逐 route 检查**：否决——HTTP route handler 与 upgrade handler 两条分发路径，加上每个其他 route 所有者，都要各自加检查，且静态壳会保持公开。
- **登录表单加服务端会话表**：否决——原生弹窗流程完全不需要 UI，派生 cookie 不需要状态；若部署确有逐会话吊销需求，可以之后再补。
- **在前方用反向代理加 Basic auth**：仍是 TLS 与 LAN 部署受支持的路径，但它不是产品功能，也不随 `dsh web` 一起走。

## 后果

信任栅栏叠加在 gate 之上作为纵深防御。特权方法回环钉扎现在开了一扇门：经 gate 认证的请求可以从任何受信任权威触达特权配置面，而匿名调用者仍只限回环——钉扎保住了原意（匿名 LAN 调用者到不了配置面），gate 则提供了钉扎所延期的认证。这是访问控制，不是机密保护：明文 HTTP 下两个通道都可被嗅探，因此非回环部署仍应置于 TLS 之后。修改凭据会一次性吊销所有已签发 cookie。Chromium 的同源 WebSocket cookie 行为是已验证的浏览器契约；Firefox 行为由组装后的 Web 回放覆盖。
