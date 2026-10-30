# dsh-device-fleet

让 Mac 侧 DSH agent 把重任务（虚拟机、视频渲染、动画生成、大构建）委派给局域网内高性能 PC 侧的 DSH 执行——**controller 像人操作 GUI 一样操作 worker**，而人只和 controller 对话。

```
你 ⇄ Mac DSH agent ⇄ controller 工具 ⇄ LAN HTTP ⇄ worker 路由 ⇄ PC 侧真实 DSH 会话
```

## 设计原则

- **零任务执行逻辑**。worker 插件只是把 Web GUI 正在用的 Host 远程面（`workspaceRegistry` + `sessionController`）原样暴露到局域网。建工作区、建/续会话、发消息、排队、插队（steer）、停止（cancel）——语义与 PC 上手点 GUI 完全一致。
- **决策归 agent**。`fleet_list_workspaces` / `fleet_list_sessions` 返回事实（路径、标题、running、排队数），由 controller agent 结合任务上下文决定复用还是新建。
- **PC 侧是真会话**。委派出去的任务在 PC 的 DSH GUI 里可见、可围观、可插话、可接管；agent 中途的提问卡片照常出现在 PC GUI。
- **人在环上的位置**：人只对 Mac agent 说话。PC 会话跑偏时，Mac agent 用 `fleet_dispatch({steer: true})` 纠偏，或 `fleet_stop` 停掉再重新派发。这些操作不需要人在 PC 前。

## 工具面（controller 侧）

| 工具 | 作用 |
| --- | --- |
| `fleet_list_workers` | 列出已配置的 worker 及在线状态 |
| `fleet_list_workspaces` | 列 worker 侧工作区 → 决策复用/新建 |
| `fleet_list_sessions` | 列 worker 侧会话（标题/running/排队数/cwd） → 决策续用/新建 |
| `fleet_dispatch` | 下发任务：续用会话，或在工作区/目录里新建会话；`steer: true` 为插队纠偏 |
| `fleet_status` | 查进度（单个会话或全部） |
| `fleet_stop` | 停掉当前响应；会话保留、可继续 |

## Worker HTTP API

监听独立于 DSH Web 服务器（GUI 可能只绑 loopback），自带 Bearer 鉴权：

| 路由 | 方法 | 语义 |
| --- | --- | --- |
| `/fleet/ping` | GET | 存活探测（返回设备名） |
| `/fleet/workspaces` | GET | `workspaceRegistry.list()` |
| `/fleet/sessions` | GET | `sessionController.list()`（含 title/running/queuedTurns） |
| `/fleet/create` | POST | `{workspaceId \| cwd, agentPreset?}` → `{sessionId}` |
| `/fleet/prompt` | POST | `{sessionId, text, mode: "queue"\|"steer"}` → GUI 同款 prompt |
| `/fleet/queue` | POST | `{sessionId, itemId, action}` → 排队消息编辑/移除/插队 |
| `/fleet/cancel` | POST | `{sessionId}` → 停止当前响应 |
| `/fleet/status` | GET | `?sessionId=` 查单个，缺省列全部 |

## 安装（两端相同）

```bash
git clone https://github.com/neil-ji/dsh-device-fleet.git
```

在 DSH 插件页选择该目录，或用 `plugin_manager install_bundle`（target 传绝对路径）。

按目录链接安装时 pnpm 不会装这个包的依赖，设置页表单会为空。在插件目录补一次即可：

```bash
cd dsh-device-fleet && pnpm install
```

## 配置（默认零配置）

两端装上即可用，不需要手工填任何值：

| 值 | 自动来源 |
| --- | --- |
| `token` | 借用 spark-link 配对密钥材料（两端 `~/.spark-link/state.json` 同源） |
| worker 名字 | 本机 hostname |
| worker LAN 地址 | 网卡枚举（announce 携带真实内网 IP） |
| controller 的 worker 名单 | 组播自动发现（`239.255.77.79:48792`，首次 `fleet_list_workers` 时扫描并缓存） |

仅当需要覆盖时才在**用户 patch 层**设置：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `role` | `worker+controller` | `worker` / `controller` / 两者 |
| `host` / `port` | `0.0.0.0` / `48791` | worker 监听；勿与 spark-link 8766 冲突 |
| `token` | （空 → 自动） | 显式共享密钥，设置后两端必须一致 |
| `workers` | `[]` | 静态 worker 名单，绕过自动发现 |

## 安全模型

- 只面向家庭局域网；独立端口、独立 Bearer 鉴权，不复用不削弱 GUI 鉴权。
- 无命令执行面：worker 只暴露工作区/会话级别的 GUI 等价操作。
- 所有会话操作与 PC 本人在 GUI 里的操作同权同限，PC 侧随时可围观接管。

## 路线

- [x] v0.1：worker 路由 + controller 工具（list/dispatch/steer/stop/status）
- [x] v0.2：零配置化——token 自动借取 spark-link 配对材料、组播自动发现 worker、名字/地址自动取值
- [ ] ask question 跨机转发（PC 会话提问 → Mac agent 应答）
- [ ] 会话事件流跟随（follow）与任务面板观测 UI
