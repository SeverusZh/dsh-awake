# dsh-awake · 守夜人（防休眠插件）v0.2.1

> DeepSeek Harness 插件：在 **agent 任务执行期间阻止操作系统休眠**，任务结束
> （含出错、中断、取消）后恢复允许休眠。跨平台：**Windows / Linux / macOS**。

电脑在 dsh 执行任务时自动休眠，会导致任务中断、重启后服务报错、会话数据损坏。
`dsh-awake` 像守夜人一样盯住任务：任务开始 → 点亮「防休眠」，任务结束 → 熄灭。

**v0.2.0 是破坏性重构**：方式子系统（平台优先、实现级粒度）、动态配置 schema、
单通道数据面（设置页不再碰官方 settings wire）、浏览器 Wake Lock 独立为
每浏览器状态（localStorage）、一键更新/重启。0.1.x 旧配置在首次加载时自动迁移。

**v0.2.1 修正 DSH 0.1.5-rc 兼容性**：数据面从 `connection.rpc` 专用通道改为
`POST /api/dsh-awake` 精确路由——旧写法在新版 DSH 上启动即报
`cannot get property "webServer" without inject`（整棵树加载失败），详见「数据面」
一节；同时插件不再声明任何必需服务（headless / tui 档位也能加载）。

---

## 安装

```sh
# 1. 安装到目标 profile（例如 web）
dsh plugin --profile web add dsh-awake

# 2. 把仓库根目录的 cordis.patch.yml 里的 `- insert:` 段追加到
#    $DSH_HOME/profiles/web/cordis.patch.yml
```

> 运行中的 DSH 会**热监视** profile 的 `cordis.patch.yml`：追加配置后立即生效，
> 无需重启。本地开发可用 `pnpm add dsh-awake@link:...` 直接链接源码目录。

---

## 配置格式（v0.2.0）

配置在设置页「防休眠」里热改（`$DSH_HOME/settings.yaml` 持久化）。形状：

```yaml
dsh-awake:
  version: 2          # 配置文件版本：2；有老配置（0.1.x）自动转换
  platform: linux     # 锚点：上次写入配置的平台（复制 .dsh 到其他系统时识别）
  mode: systemd       # 当前平台选中的方式（= 实现文件名）；'off' = 关闭服务端
  config:             # 该方式的配置；字段由方式自己声明（动态表单），多为空 {}
    why: 'dsh 任务执行中'
```

- **宽松 schema**：`config` 是任意对象，键由方式声明、校验在 host 侧——加实现不动 schema。
- **常开防休眠（页面底部开关）**：一键开启后服务端**无论是否有任务运行都持续
  值守**（不等 turn/start）。它是**纯内存状态——不写配置文件，宿主重启即失效**，
  每次需要时再开。模式为 `off`（服务端不值守）时无法开启，开关禁用并提示先选择方式。
- **跨平台复制**：配置的 `platform` 与当前系统不一致时，运行时自动用当前平台默认
  方式，设置页黄色提示「配置来自 Windows，当前为 Linux…」，**不覆盖文件**；
  下次保存时 `platform` 更新为当前平台。
- **`mode: 'off'`**：服务端不值守，状态行显示「未启用」，无红色提示（用户主动选择）。
- 插件升级后配置的方式被删除 → 同样兜底到默认方式并提示。

### 方式清单（platform → order → default）

| 平台 | 方式（实现文件） | 默认 | 原理 |
|---|---|---|---|
| Linux | `systemd`（systemd-inhibit）、`gnome-gsettings` | `systemd` | 看门狗进程持锁 / 临时改 GNOME 电源设置 |
| macOS | `caffeinate`、`pmset` | `caffeinate` | 看门狗进程持锁 / 临时改电源设置 |
| Windows | `powershell`（SetThreadExecutionState）、`powercfg` | `powershell` | 看门狗进程持锁 / 临时改电源方案 |

拿锁回退链：首选 = 配置的方式；失败则按平台 order 依次尝试；全部失败 →
服务端未值守，设置页红色列出每个原因。

### 浏览器 Wake Lock（2.3）

「为当前浏览器开启页面防休眠」是**每浏览器**状态，走
`localStorage['dsh-awake.webWakeLock']`（默认开），**不进配置文件**；与服务端
方式完全独立。有任务在运行且页面可见时持有 `navigator.wakeLock`，页面切后台
自动重取。

---

## 设置页

打开 dsh web → 设置 → **防休眠**：

```
[● 后端已连接] [● 值守中 · systemd]                 [🔄 刷新]
⚠ 配置来自 Windows，当前为 Linux，已使用默认方式 systemd   ← stale（黄）
❌ 防休眠未能生效：systemd-inhibit 未找到；…                ← 全失败（红）
📦 新版本 v0.3.0（当前 v0.2.1）                  [一键更新]   ← 仅新版时渲染
为当前浏览器开启页面防休眠                        [开/关]      ← localStorage
插件运行模式
[systemd-inhibit ▾]（不可用项 disabled + 原因）
说明：通过 systemd-inhibit 阻止系统休眠，需要 systemd 环境…
阻止原因 [dsh 任务执行中                ]                     ← 动态表单
🛡 常开防休眠（无论是否有任务都持续值守）        [开/关]      ← 页面底部一键开关
```

- 状态行每 5s 轮询；刷新按钮 = 重新探测方式可用性。
- **常开防休眠**：页面底部开关，开启后服务端立即值守（无需任务）；**仅本次运行
  生效，不写配置文件，宿主重启后恢复关闭**；模式为「关闭（off）」时开关禁用并
  提示先选择方式。
- 更新卡片：npm registry 比对版本，一键更新（`dsh plugin update`）+ 自动重启生效；
  DSH Desktop 环境不渲染（更新由桌面版管理）。

---

## 开发

```sh
pnpm install
pnpm typecheck   # tsc 双半
pnpm test        # vitest（单测 + 看门狗进程测试 + systemd-inhibit 集成测试）
pnpm build       # host → lib/index.js（ESM）；client → lib/client.js（ModuleLoader 壳）
```

工程化对齐 dsh-win-mgr：`tsconfig.{base,host,client}.json` + `tsdown.{host,client}.config.ts`
+ vitest；host 打 ESM 单文件，client 打 `window.__ModuleLoader__.load` CJS 工厂壳
（react 系列走页面模块表 external）。

### 加一个实现 / 平台

- **加实现**：`src/modes/<platform>/<name>.ts` 导出 `WakeMode`（fields 声明动态
  配置字段），在 `<platform>/index.ts` 的 `order`/`modes` 注册一行。
- **加平台**：`src/modes/<platform>/` 目录 + `src/modes/index.ts` 静态 import 聚合。

### 数据面

所有设置页数据走 `POST /api/dsh-awake`（单通道，绕开官方 settings wire 白名单），
请求体 `{ method, payload }`、响应体 `RpcResult`；端点：`awake.status` /
`awake.refresh` / `awake.select` / `awake.alwaysOn` / `awake.version` /
`awake.update` / `awake.restart`；错误形状对齐 `rpcErrorSchema`
（`{ ok: false, error: { code, message, details } }`）。

host 半用 `connection.fetch.register` 注册这条 /api 共享通道的**精确路由**
（官方 file-upload / deliverables / session-log-export 同款扩展点），因此自动
沿用 Connection 的 Host/Origin + 浏览器登录栅栏（未登录 = 401）。

> **为什么不用 `connection.rpc.handle`（0.2.1 起改）**
> DSH 0.1.5-rc 的 `dsh-client-connection` 在注册专用通道时会执行
> `owner.effect(() => owner.webServer.register(route))`，而 `owner` 是「提供方
> fiber 的影子上下文」——`webServer` 于是沿 **webserver 条目的 fiber 祖先链**解析。
> 第三方插件的条目与 webserver 条目是**兄弟**（profile 补丁把每个 bundle 的
> insert 行平铺在同一层），祖先链上没有 webServer，于是启动即抛
> `cannot get property "webServer" without inject` 并整棵树加载失败
> （dsh-pocket 1.16.x 同源问题）。`connection.fetch` 只碰消费方自己的 fiber，
> 没有这个限制。

---

## 迁移（0.1.x → 0.2.0）

旧配置 `{ enabled, shellWakeLock, powerCfgWakeLock, webWakeLock, why }` 在 host
首次加载时识别并自动转换（写回一次，不循环）：

- `webWakeLock` → 浏览器 localStorage（默认开），settings 旧字段删除；
- `shellWakeLock / powerCfgWakeLock` → `mode`：只开 powerCfg → 该平台电源类实现
  （gnome-gsettings / pmset / powercfg），否则 → 平台默认实现；
- `why` → `config.why`。

## License

MIT
