# Fork 本地补丁

本检出是上游 `deepseek-ai/deepseek-harness` 的发布标签 `dsh-v0.2.0-rc.2`，外加下列改动面。它们用于恢复上游未提供的部署行为;其余全部为未改动的上游代码,因此升级方式是"替换整棵树,再重放这五处补丁"。

## 改动面

| 路径 | 行为 | 何时删除 |
|---|---|---|
| `packages/host/webserver/src/index.ts` | `registerAuth(check, challenge)` 门禁席位:单所有者;在 HTTP 路由匹配之前、upgrade 分发之前运行;拒绝时返回 401 与注册的 `WWW-Authenticate` 值,或关闭 upgrade socket;门禁抛错按拒绝处理并记录 | 上游出现等价的整站门禁 |
| `packages/client/ui-layout` | 窄屏侧边栏抽屉:浮动居中的开合箭头、零宽隐藏列、`layout` 语言命名空间 | 上游提供抽屉式开合 |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css` | `.trailing { flex: 0 1 auto }`,让右侧组收缩、模型触发器省略号生效而不是换行 | 随附 composer 已能收缩 |
| `packages/client/ui-model-selection/src/client/ModelSelect.module.css` | `@container (max-width: 460px)` 在触发器带 effort 段时隐藏模型名 | 上游自行折叠该 chip |
| `packages/session-query/session-log-export` | 带文案的导出胶囊,在 480px 以下折叠为省略号菜单（对标题行的容器查询） | 上游恢复带文案形式 |

后四处为纯 UI 改动,按规范无需 Agent Note;门禁席位有
`.agents/notes/implemented/architecture/2026-10-02-webserver-auth-seat.md`。

## Basic 认证

门禁逻辑是仓库外的插件:`~/dsh-plugins/dsh-basic-auth`(独立 git 仓库、纯 ESM、无构建步骤,`node --test test.js`)。它接受 `Authorization: Basic` 或自己铸出的 `dsh-auth` cookie(`sha256(user:pass)`,`HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`),放行 `GET /manifest.webmanifest`,并用 `appendHeader` **追加** cookie —— Connection 的 token 重定向通过 `writeHead` 写自己的会话 cookie,若这里是替换就会把它丢掉。

用 `dsh plugin --profile web add ~/dsh-plugins/dsh-basic-auth` 装入 profile,然后在
`~/.dsh/profiles/web/cordis.patch.yml` 挂载:

```yaml
- insert:
    - id: basic-auth
      name: dsh-basic-auth
      disabled: !!js '!process.env.DSH_BASIC_AUTH'
      config:
        credential: !!js process.env.DSH_BASIC_AUTH
```

表达式必须加引号:未加引号的前导 `!` 是 YAML 标签语法,会让 overlay 解析失败。命中已存在 id 的行是补丁;新增行必须放进 `insert` 列表,否则该层会告警 `entry "basic-auth" not found` 并跳过。

## 部署接线

- `~/.dsh/dsh.web-lan.patch.yml` 绑定 `webserver.host: 0.0.0.0` 与 `port: 3080`。
- 启动前导出 `DSH_BASIC_AUTH=user:pass`:
  `pnpm dsh web --patch ~/.dsh/dsh.web-lan.patch.yml --trusted-host dsh-macos.t.caryyu.top`。
- 未设置该变量时该行 disabled,行为与没有门禁一致。
- 上游的浏览器会话仍守护 Host API 与 index:新设备先过 Basic 提示,再访问启动日志里的 `?token=` URL 一次;两个 cookie 都是 30 天。

## 验证清单

1. `curl -si http://127.0.0.1:3080/` → `401`,带 `www-authenticate: Basic realm="dsh"`。
2. `curl -si -u user:pass "http://127.0.0.1:3080/?token=<启动日志 token>"` → `303`。
3. `curl -u user:pass -c jar -b jar <资源 URL>` 铸出 `dsh-auth`;`curl -b jar /` → `200`。
4. `curl -si http://127.0.0.1:3080/manifest.webmanifest` → `200`,无需凭据。
5. 错误密码 → `401`。
6. LAN 浏览器:Basic 提示 → token URL → 界面可用;`remote.mux` WebSocket 保持连接。
7. 窄窗口(< 1024px):侧栏隐藏、浮动箭头可开合;导出胶囊在 480px 以下变为省略号菜单;模型 chip 只保留 effort 级别。

## 升级流程

1. 把 `master` 切到目标 tag,再重放五处改动面(`git diff dsh-v0.2.0-rc.2 HEAD -- <path>`，前提是 fork 提交已存在)。
2. 遵循目标版本的工具链锁定(`0.2.1` 起为 pnpm 11.28.5 与 Node ≥ 24.9)。
3. 用 `pnpm run build --profile official` 重建(保留 `DSH_CLIENT_BUILD_PROFILE=official` 与
   `DSH_CLIENT_TITLE=DeepSeek Harness`,官方 wordmark 与标题才会生效)。
4. 跑验证清单,再跑 `pnpm run test:gui`、`pnpm run typecheck`、`pnpm run test:docs`。
5. 阅读目标的 `docs/upgrade-guide/`:自 `0.2.1` 起 `web-listener-trust-config` 拒绝 `host: 0.0.0.0`,LAN overlay 必须绑定具体网卡地址。

除非目标版本的客户端布局变化,插件与 UI 补丁在升级间无需改动。
