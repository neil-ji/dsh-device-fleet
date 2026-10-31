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

按目录链接安装时 pnpm 不会装这个包的依赖，面板会读不到 schema。在插件目录补一次即可：

```bash
cd dsh-device-fleet && pnpm install
```

插件页图标由 `exports["./icon"]` 指向 `icon.png`；同目录还留一份 `icon.svg`，给按文件名读 `icon.svg` 的旧客户端兜底，两份画的是同一幅图案。

## 面板

左侧栏「插件 → 设备舰队」展示微缩舰队船坞（`client.js`，端点 `/api/device-fleet`）：

- **设备编队**：指挥舰代表本机指挥节点，执行舰代表工作设备；在线、离线、延迟与待回报任务分别显示，点击舰船筛选任务。
- **任务航程**：全部 / 等待回报 / 已回报；显示真实会话标题，缺失时回退为会话短编号。详情可复制完整会话编号，供指挥 Agent 查询原会话。
- **回报接收站**：展示尚待 Agent 接收的通知，不消费通知、不冒充人工验收状态。
- **发现设备**：扫描入口常驻；显示本次发现结果。未配对设备由指挥 Agent 通过既有舰队连接流程配对。
- **舰队设置**：从顶部工具栏就地展开，不跳到页底；角色、监听地址、端口与密钥保存即生效，密钥只写不读。自动刷新不覆盖未保存草稿，保存失败保留输入。
- **状态可信度**：没有完成通知时只显示「等待回报」；超过 30 分钟提示「长时间未回报」，不直接判定运行或失败。读取失败保留旧快照并标明过期。后台页面暂停轮询。
- **可滚动面板**：插件根节点是独立滚动容器；Host 使用固定高度时，滚轮、触控板和键盘都能滚到完整任务与设置，不依赖外层页面。

### 视觉与交互

界面以“桌面微缩舰队”为主题：深海军蓝底、奶油白舰体、橙色结构件和薄荷色连接状态。舰船插画承担角色识别和氛围，状态、按钮、编号与焦点仍由文字和 CSS 表达；在线灯光只是美术装饰，不冒充实时遥测。

- 宽屏为“船坞 + 任务日志”双层结构；任务列表与详情合并为一块指挥台，而不是彼此分离的 SaaS 卡片。
- 窄屏把舰船卡改为横向泊位，保留舰船识别，同时避免过长的纵向滚动。
- 设备筛选、任务筛选、详情切换、复制会话编号和设置草稿都可键盘操作；焦点环、状态文字和减少动态效果设置齐备。
- 操作反馈使用底部轻提示，不再用插入页面顶部的成功横幅推动布局；复制编号在按钮上原位确认。
- 首批六件透明 PNG 的 Web 版本位于 `assets/miniatures/`，均为 768×512，按 320px 以内的实际展示尺寸保留约 2× 余量。它们由 1536×1024 原图下采样而来；原始生成提示词随源码保存，不通过面板端点公开。新增文件名需要同时加入 `lib/panel.js` 的 `ASSETS`。
- 面板会只读查询已配对设备的 `/fleet/dispatches` 与 `/fleet/sessions`，补齐任务标题；标题获取失败不会阻断设备状态。历史日志缺少设备名时，仅在单一设备明确报告同一会话时恢复归属。

## 配置（默认零配置）

两端装上即可用，不需要手工填任何值：

| 值 | 自动来源 |
| --- | --- |
| `token` | worker 首次激活自动生成并持久化（`~/.dsh/device-fleet.json`）；controller 首连通过 TOFU（`/fleet/hello`）自动配对 |
| worker 名字 | 本机 hostname |
| worker LAN 地址 | 网卡枚举（announce 携带真实内网 IP） |
| controller 的 worker 名单 | 组播自动发现（`239.255.77.79:48792`，首次 `fleet_list_workers` 时扫描并缓存） |

仅当需要覆盖时才在**用户 patch 层**设置：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `role` | `worker+controller` | `worker` / `controller` / 两者 |
| `host` / `port` | `0.0.0.0` / `48791` | worker 监听地址与端口 |
| `token` | （空 → 自动） | 显式共享密钥，设置后两端必须一致 |
| `workers` | `[]` | 静态 worker 名单，绕过自动发现 |

## 安全模型

- 只面向家庭局域网；独立端口、独立 Bearer 鉴权，不复用不削弱 GUI 鉴权。
- 无命令执行面：worker 只暴露工作区/会话级别的 GUI 等价操作。
- 所有会话操作与 PC 本人在 GUI 里的操作同权同限，PC 侧随时可围观接管。
- **无任何第三方依赖**：不读取、不依赖 spark-link 或其它外部应用的状态；密钥与配对状态全部存在插件自有文件 `~/.dsh/device-fleet.json`（0600，原子写）。

## 零重启更新（v0.4.0）

插件代码分为**稳定壳**（socket 闸门、工具 schema，`lib/server.js` / `lib/tools.js`）与**热交换实现**（`lib/worker-impl.js` / `lib/controller-impl.js`）。壳在每次请求/调用时检测实现文件的 mtime 签名，变化即通过 cache-busting 动态 import 加载新一代代码。

因此自更新流程缩减为一条指令：controller 派发 `git pull` 任务 → pull 落地 → 下一个请求/工具调用即是新代码，**两端都不需要重启 DSH**。

### 源码热重载（推荐，无需重启）

DSH 自带 HMR，但基础 bundle 里的 `hmr` 行默认 `root: []`——**只监听显式配置，不监听源码**。把插件检出目录加进监听根即可（本机 `~/.dsh/profiles/desktop/cordis.patch.yml`）：

```yaml
- id: hmr
  config:
    root:
      - /Users/neilji/AIGC/dsh-device-fleet
```

实测（本仓库）：改壳文件后 12 秒内新代码即生效——加一个响应头探针，`curl` 立刻能读到，**无需重启应用**。注意 HMR 需要 CJS/ESM 模块缓存可替换（DSH Desktop 满足）；源码若在 profile 的 `node_modules` 之外且未被 `root` 覆盖，则只会随 profile 重组时才替换。

### 什么时候还需要重启（只由人决定）

热交换覆盖的是**实现**（`worker-impl.js` / `controller-impl.js`）。只有改动**壳**（`lib/server.js`、`lib/tools.js`、`index.js`——socket 闸门、工具 schema 注册）才需要重载一次应用；因此壳里不放任何逻辑，只做注册与 delegate。

**硬规则：agent 不得自行重启 DSH。** 自助重载在本项目里被实际踩过两次坑：`nohup` 子进程随应用被回收导致应用再也起不来；改用 `launchctl submit` 后任务又被反复拉起，把正在进行的会话连续中断。壳改动只汇报「需要一次重载」，由人挑时机。

供人使用（若你确实想用脚本）`scripts/restart-mac.sh`，但它只解决「退出后能自动回来」，不解决「什么时候该退出」。

## 实战用法（已端到端验证）

一次跨机任务的完整闭环，全部走真实工具调用：

```text
fleet_list_workers                       # 谁在线（冷启动会自动扫一次）
fleet_list_workspaces  { worker }        # 已注册工作区 → 决定复用还是新建
fleet_list_sessions    { worker }        # 已有会话（标题/running/排队数/cwd）
fleet_dispatch         { worker, workspaceId|cwd|sessionId, prompt }
fleet_status           { worker, sessionId }     # running / queuedTurns
fleet_recent           { worker, sessionId }     # 读回结论（单条上限 12000 字符）
fleet_stop             { worker, sessionId }     # 跑偏时停掉，会话保留可续
```

### 委派出去的任务可以反过来问你问题

worker 侧 agent 在需要人拍板时调用 **`fleet_ask_human`**（不是 `ask_user_question`）：问题经同一通道转发到发起任务的会话，controller 用 `ctx.userQuestions.ask({ questions, agent })` 在你这边弹卡片，你作答后答案原路回到 worker，agent 继续。

设计要点：

- **卡片必须挂在发起会话的 agent 上**。插件上下文直接 ask 会得到一张"无主"卡片，平台无处记录结果（实测：作答时 Host 重启）。
- 发起会话不在线时**拒绝提问**，而不是造一张没人认领的卡片。
- worker 拿不到回答时返回 `unavailable` 并明确要求"不要猜"，由模型决定停下还是稍后重试。
- 为什么不拦截平台自带的 `ask_user_question`：`user-questions/request` 走 Agent 作用域 waterfall，插件在 `agent.ctx` 上注册的监听器实测**不会触发**。

### 任务完成是"推"给你的，不是你去问的

派发之后不需要轮询：worker 记住"这个会话是谁派的"，当 Host 发布该会话的空闲状态时，worker 主动 POST 到派发方的 `/fleet/callback`，controller 再用公开的 `sessionController.prompt()` 唤醒发起会话——于是你在对话里直接收到一条 `[设备舰队] … 已空闲`，照着里面的 sessionId 读结论即可。

- 鉴权方向：worker 永远不知道 controller 监听器的 token，所以回调**用 worker 自己的 token**，controller 拿配对时 pin 下的 peer token 比对；
- **每次派发只通知一次**（一个任务可能跨多轮空闲），重新派发才会重置；
- `GET /fleet/dispatches`（只读）列出已登记的回调目标与最近一次回调结果（含 HTTP 状态与错误体）——跨机静默失败靠它定位。

`fleet_dispatch` 支持 `wait: true`（可配 `waitTimeoutMs`，默认 5 分钟）：派发后阻塞到对端会话空闲，直接带回 `transcript`，省掉手写轮询。`fleet_recent` 支持 `finalOnly: true`：只要最后一条 assistant 结论，跳过过程中的推理消息。

派发出去的 `prompt` 必须是**自包含**的：对端 agent 看不到本端上下文。实践里效果最好的写法是「目标 + 验收标准 + 输出格式 + 字数上限 + 不允许做什么」，并且要求它**自证**（贴真实命令输出，而不是复述设计）。

## 静默唤醒：任务完成后 agent 自己续跑

实测（一次性会话对照实验 + 真实会话验证）：

- `agent.inject()` + `agent.wakeDriver()` 能开一轮，且**不产生 `user/message`**——人的对话里不会出现"机器冒充的人话"
- 但注入的 payload **送不到模型**：`source.kind === 'runtime-context'` 的消息被并入运行时上下文而不追加（平台 loop 的硬编码分支），所以那一轮对模型来说是空的
- 结论：**"送达内容"和"不可见"互斥**。舰队选择不可见，唤醒不带 payload，由 agent 自己调 `fleet_notices` 取

`wake` 三档：

| 值 | 行为 |
|---|---|
| `silent`（默认） | 静默唤醒；agent 被唤醒时必须先调 `fleet_notices`，否则它看不到任何内容 |
| `thread` | 写一条 user 消息（可见、会插入、会打断） |
| `off` | 只存通知，等下次有人说话 |

**给被唤醒的 agent 的契约**：如果你发现自己在没有用户消息的情况下开始了一轮，那是静默唤醒——第一步调 `fleet_notices`，再 `fleet_recent` 读结论，然后继续或汇报。

## 机器事件不进对话（权限而非美观）

worker 的完成通知**默认不写入聊天**（`notify: panel`）。原因有两条，都在实测里踩到：

1. `sessionController.prompt()` 产生的是 `user/message` 事件，`source.kind = "user-rpc"` —— 与人在输入框打字**完全同一种事件**。GUI 无法区分，模型也无法区分；之前唯一的"标记"是文本前缀 `[设备舰队]`，那只是文案，不是结构。一个被攻陷的 worker 因此可以把任意内容以"指挥官"的权限塞进对话。
2. 它还会**抢占轮次边界**：人正在对话时，一条机器事件会把这一轮切开，把人的 flow 打断。

所以：完成事件写入通知存储，由 `fleet_notices` 按需读取；需要人决策时用问题卡片（平台原生、视觉与语义都不同）；`notify: chat` 只作为显式退回旧行为的开关。

## 热更新时代的两个硬约束（都踩过）

1. **共享状态必须挂在 `globalThis`**。`lib/registry.js` 同时被入口 `index.js` 和热加载的 `*-impl.js` 引用；HMR 换掉该模块后，两边会各持一份模块级 `Map`——worker 把派发记录写进 A，工具从 B 读，于是明明是舰队派发的会话却被判成"不是舰队派发"。`globalThis.__fleetState` 是唯一可靠的中转点，`test/registry.test.mjs` 用两个模块实例覆盖了这条。
2. **改了共享模块之后，还要让实现模块换代**。我们的热加载只按 `lib/*-impl.js` 的 mtime 换代；如果只改了 `registry.js`，已经加载的 impl 仍握着旧实例（新代码要等下一世代才生效）。改共享模块后顺手 `touch lib/worker-impl.js`（或等自然重启）再验证，否则会误判"修复没生效"。

另外：`/fleet/hello` 的 `commit` 字段来自 `version.js` 的 `git rev-parse`，它**不随 HMR 重新求值**，所以**不能**用来判断壳有没有重载。可靠判据是给 `lib/server.js` 加一个响应头探针，看新代码是否出现在响应里。

## 已知限制

- **首次调用**：Host 每次重启后缓存为空，旧版会报 `unknown worker`；现已自动扫一次（`discovered after a fresh scan: ...`），但若 LAN 上确实没人应答，仍会明确失败。
- **bash 子进程可能到不了 worker**：macOS 局域网权限会让 `fetch` 报 `EHOSTUNREACH`，而插件进程本身正常。判断通道是否可用请用 `fleet_list_workers`，不要用 `curl`/`node` 自测代替。
- **长任务靠轮询**：`fleet_status` 不会阻塞等待；跨机等待请自己控节奏（例如隔 30–60 秒查一次），不要紧循环。
- **单条消息 12000 字符上限**：超长报告需分段，或在 `prompt` 里直接要求「不超过 N 字」。

## 路线

- [x] v0.1：worker 路由 + controller 工具（list/dispatch/steer/stop/status）
- [x] v0.2：零配置化——组播自动发现、名字/地址自动取值
- [x] v0.3：完全去第三方依赖——TOFU 配对（`/fleet/hello` 首用披露 token，首个 controller claim 后封闭）、插件自有持久化（`~/.dsh/device-fleet.json`）、pinned peers 单播兜底发现
- [x] v0.4：零重启更新（壳/实现分离 + 热交换）、冷启动自动扫描
- [ ] ask question 跨机转发（PC 会话提问 → Mac agent 应答）
- [ ] `fleet_dispatch` 阻塞模式（派发后直接等到空闲并返回最终结论，减少轮询）
- [ ] 会话事件流跟随（follow）与任务面板观测 UI
