# rc.5 → rc.8 升级记录

本文件记录从 fork 的 rc.5 时代状态(`47f943859b` 基座)升级到 dsh `0.1.0-rc.8` 的完整过程,包括收尾提交整理、仓库状态变更、内容完整性核对与编译机升级步骤,供后续排障与复盘使用。

## 1. 升级摘要

- **目标版本**:dsh `0.1.0-rc.8`(tag `dsh-v0.1.0-rc.8` → `d15cbe479a`)
- **fork master**:`d15cbe479a`
- **升级方式**:fork master 整体替换(force-update),旧状态由备份分支完整保留

## 2. 收尾提交:3 个提交整理进 rc.8

rc.8 发布合并(`141eb6fef8`)之后,master 上又落了 3 个提交。因不改变发布版本号(仍是 `0.1.0-rc.8`),采用**前移轻量 tag** 的方式把这 3 个提交纳入 rc.8:

| 提交 | 内容 |
|---|---|
| `8f77ae0344` | fix(web): mint ids without `crypto.randomUUID` for insecure origins |
| `63d9f56ccf` | feat(web): basic-auth gate, gzip/cache delivery, and narrow-viewport UI |
| `d15cbe479a` | fix(client): restore official brand wordmark and product title |

其中 `d15cbe479a` 是本次升级时的 logo 恢复提交:侧边栏品牌 fallback 从 "DSH Local Build" 文字标签改回官方 `BrandWordmark` 图样,浏览器标题默认值恢复为 "DeepSeek Harness";部署时仍可用 `DSH_CLIENT_TITLE` 构建期覆盖,slot 机制不变。

## 3. 仓库状态变更

| ref | 变更 | 说明 |
|---|---|---|
| `refs/heads/master` | `e19cedd222` → `d15cbe479a`(force-update) | fork master 整体替换 |
| `refs/tags/dsh-v0.1.0-rc.8` | `141eb6fef8` → `d15cbe479a` | 轻量 tag 前移,含 3 个收尾提交 |
| `refs/heads/backup/rc5-fork-20260820-144814` | 新增,指向 `e19cedd222` | 旧 fork 完整状态,双保险 |

- 版本号未改动,所有包仍是 `0.1.0-rc.8`
- **upstream(deepseek-ai)未做任何变更**(不需要);其上的旧 rc.8 tag(`141eb6fef8`)仍指向发布合并提交
- 部署产物(`apps/web/dist` 与各 client bundle)均从 `d15cbe479a` 构建,与移动后的 tag 内容一致

## 4. 内容完整性核对(无丢失)

force-push 前逐项核对过旧 fork master 的内容去向:

- 旧 fork master 独有的提交**恰好 2 个**,均为新 master 已有提交的同内容拷贝:
  - `5520dbd3a9` ↔ `8f77ae0344`:crypto.randomUUID 修复,补丁内容逐行一致(仅行号偏移)
  - `e19cedd222` ↔ `63d9f56ccf`:basic-auth + gzip/cache 修复,改动文件清单完全一致
- 其余旧 fork 历史(rc.5 基座 `47f943859b` 及更早)全部存在于新 master 历史中
- 即使有遗漏,`backup/rc5-fork-20260820-144814` 可随时恢复旧状态

## 5. 编译机升级步骤

其他仍停留在 rc.5 状态、从 fork 编译的机器,按以下步骤升级:

```sh
git fetch origin
git reset --hard origin/master      # 或对齐 release: git checkout dsh-v0.1.0-rc.8
corepack enable                     # 激活仓库固定的 pnpm 11.7.0
pnpm --version                      # 必须输出 11.7.0
rm -rf node_modules                 # 清掉 rc.5 残留的旧依赖结构
pnpm i
pnpm run build
```

升级后验证:

```sh
git log --oneline -1                # 应为 d15cbe479a(或 tag 版本)
pnpm --version                      # 11.7.0
pnpm run build                      # 编译通过
```

## 6. 注意事项与踩坑

- **不能直接 `git pull`**:fork master 被 force-push 重写,旧 rc.5 状态不是新 master 的祖先,直接 pull 会报 diverged 或产生大量冲突;编译机应使用 `reset --hard` 或重新 clone
- **pnpm 版本必须为 11.7.0**(`packageManager` 固定):用 pnpm 9.x 跑 install 会重写 `pnpm-lock.yaml`,丢掉 `overrides`(vendored cosmokit/schemastery 链接)与 `patchedDependencies`(node-pty patch),导致构建失败;若 lockfile 被误重写,执行 `git restore pnpm-lock.yaml`
- **不要在 `apps/cli` 目录下单独执行 `pnpm install`**:会生成嵌套的 `apps/cli/pnpm-lock.yaml` 与 `apps/cli/.pnpm/` 垃圾产物
- **Node 版本要求**:`^22.19 || >=24`
- **GUI 访问**:升级后的 GUI 带有 basic-auth 保护(基础认证),首次访问会弹出登录框,属预期行为

## 7. 相关提交

```
d15cbe479a fix(client): restore official brand wordmark and product title
63d9f56ccf feat(web): basic-auth gate, gzip/cache delivery, and narrow-viewport UI
8f77ae0344 fix(web): mint ids without crypto.randomUUID for insecure origins
141eb6fef8 Merge pull request #2783 from deepseek-harness/release/dsh-0.1.0-rc.8
f1f7dc36fa release(dsh): 0.1.0-rc.8
```
