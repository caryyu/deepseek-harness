# Agent Note: Web 表面认证席位

Status: implemented

[English](2026-10-02-webserver-auth-seat.md) | 中文

## 问题

`@deepseek-ai/dsh-host-webserver` 拥有进程唯一的 HTTP 监听器，对外提供具名路由、upgrade 路由与唯一回退席位。Connection 插件认证 Host API 与 index，但静态资产按设计保持公开；因此需要在整个表面（index、静态资产、`/api` 与 mux upgrade）前置同一凭据的部署，没有任何单一执行点。

## 决策

`registerAuth(check, challenge)` 占用唯一的请求门禁。检查在 `handle()` 内、路由匹配之前运行，因此具名路由、回退 handler 与 404 应答同样受控；它在每次 upgrade 分发之前运行。门禁拥有凭据语义，服务端拥有拒绝协议：对 HTTP 返回 401 与注册的 `WWW-Authenticate` 挑战，对 upgrade 销毁 socket，门禁抛错时按拒绝处理并记录。同一时刻只允许一个门禁，disposer 释放席位。HTTP 调用会收到响应对象，门禁可在放行前写入 cookie；upgrade 调用没有响应对象，因此只有已携带 cookie 的握手才能通过。这是 fork 本地扩展：上游 0.2.0-rc.2 与 0.2.1-rc.3 均无等价席位，且静态资产保持公开。

## 考虑过的替代方案

**在服务器之前放置反向代理。** 拒绝：对单机 LAN 部署而言，它引入第二个常驻进程与第二处传输策略归属。

**逐个补丁消费方插件。** 拒绝：Connection 拥有 `/api` 认证，frontend-static 插件拥有 index 认证；要覆盖整个表面需要两处补丁，且 404 应答仍不受控。

**把门禁放进回退 handler。** 拒绝：回退只应答未命中路径，`/api` 流量与 upgrade 握手都会绕过它。

## 影响

该席位是 `packages/` 下唯一的 fork 本地改动；凭据检查本身作为普通插件由 profile 挂载。升级的全部成本是重放这一个文件，而一旦上游提供等价能力，部署即可删除它。由于门禁无法读取请求体，需要请求体的凭据方案必须放在 route 而非席位中。注册门禁的组合现在会要求静态资产也携带该凭据，这正是席位的目的。
