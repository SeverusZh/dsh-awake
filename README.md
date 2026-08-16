# dsh-awake · 守夜人（防休眠插件）

> DeepSeek Harness 插件：在 **agent 任务执行期间阻止操作系统休眠**，任务结束
> （含出错、中断、取消）后恢复允许休眠。跨平台：**Windows / Linux / macOS**。

电脑在 dsh 执行任务时自动休眠，会导致任务中断、重启后服务报错、会话数据损坏。
`dsh-awake` 像守夜人一样盯住任务：任务开始 → 点亮「防休眠」，任务结束 → 熄灭。

---

## 安装

```sh
# 1. 安装到目标 profile（例如 web）
dsh plugin --profile web add dsh-awake

# 2. 把仓库根目录的 cordis.patch.yml 里的 `- insert:` 段追加到
#    $DSH_HOME/profiles/web/cordis.patch.yml
```

> 运行中的 DSH 会**热监视** profile 的 `cordis.patch.yml`：追加配置后立即生效，
> 无需重启。

也可以手动 `pnpm add dsh-awake` 并自行维护补丁条目：

```yaml
- insert:
    - id: dsh-awake
      name: 'dsh-awake'
      config:
        enabled: true
        shellWakeLock: true
        powerCfgWakeLock: false
        webWakeLock: true
        why: 'dsh 任务执行中'
```

## 配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时全部方案不生效 |
| `shellWakeLock` | `true` | 方案B：系统 shell 命令防休眠（推荐） |
| `powerCfgWakeLock` | `false` | 方案C：电源设置兜底（默认关；结束时会恢复原值） |
| `webWakeLock` | `true` | 方案A：浏览器 Wake Lock |
| `why` | `'dsh 任务执行中'` | `systemd-inhibit` 的 `--why` 参数（Linux） |

三个方案可自由组合，全部开启时按 **A+B+C** 同时生效，互不干扰。

### 在哪里改配置：web 的「插件」设置页

插件注册了 `dsh-awake` 设置命名空间，web 端**「设置 → 插件 → 插件配置」**
里会出现「守夜人（防休眠）」卡片，可随时开关：

- **总开关**、**方案B · 系统命令**、**方案C · 电源设置**、**方案A · 浏览器
  Wake Lock** 四个开关 + `--why` 参数；
- 修改点「保存」即写入 `$DSH_HOME/settings.yaml` 并**热生效**（任务进行中
  也会立即重新对账）；点「恢复默认」可撤销单字段覆盖；
- 未在设置页修改过时，行为由 `cordis.patch.yml` 里的 `config` 决定
  （设置页里字段不显示「已覆盖」徽标）。

> 命令行方式等价：编辑 `$DSH_HOME/settings.yaml`，追加
> `dsh-awake: { webWakeLock: false }` 之类的用户层覆盖即可，同样热生效。

---

## 方案说明

### 方案A：浏览器 Wake Lock（仅 web 界面生效，无页面 UI）

- 在支持 [Screen Wake Lock API](https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API)
  的浏览器（Chromium 系、Edge 等）中，任务运行期间申请
  `navigator.wakeLock.request('screen')`，任务结束释放。
- 页面切到后台时**浏览器会自动释放锁**；插件监听 `visibilitychange`，
  切回前台后若任务仍在运行则**自动重取**。
- **插件不向页面注入任何可见元素**：方案A 在后台静默运行，开关统一走
  web 的「插件」设置页（见下节）。
- 注意：Wake Lock 要求**安全上下文**（https，或本机 `localhost` / `127.0.0.1`）。
  本机 web GUI 满足条件。

### 方案B：系统 shell 命令（后台子进程，任务结束 kill 掉）

| 平台 | 命令 | 说明 |
| --- | --- | --- |
| Linux | `systemd-inhibit --what=sleep:idle --who=dsh-awake --why="<why>" sleep infinity` | 需要 systemd；用 `systemd-inhibit --list` 可验证 |
| macOS | `caffeinate -dimsu` | 系统自带 |
| Windows | PowerShell 常驻进程循环调用 `kernel32.SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` | 无需管理员权限；进程结束即恢复 |

- 真实命令通过一个极小的**看门狗**中间进程运行：任务结束时 dsh 主动杀掉看门狗；
  若 dsh 进程意外崩溃，管道断裂产生 EOF，看门狗会自动终止其子进程并退出——
  **不会留下孤儿进程把系统永久锁在不休眠状态**。
- 平台不支持（如非 systemd 的 Linux）时插件自动降级并打印日志，不影响其余方案。

### 方案C：电源设置兜底（默认关闭）

> 方案C 修改的是**系统级电源策略**，影响面更大，默认关闭；需要时自行开启。

| 平台 | 修改 | 恢复 |
| --- | --- | --- |
| Windows | `powercfg /change standby-timeout-ac\|-dc 0` | 按读取到的原值（秒）恢复 |
| Linux | `gsettings set … sleep-inactive-ac-type 'nothing'`（GNOME） | 恢复原字符串 |
| macOS | `pmset -a sleep 0` | 恢复 AC / Battery / UPS 各来源原值 |

- **先读取原值、再修改、结束时恢复**，全部 best-effort：命令缺失或失败只打日志，
  绝不中断 agent 任务。
- 部分修改需要管理员/root 权限（如 `powercfg /change`、部分 `pmset`），
  失败时同样只降级提示。

---

## 生命周期绑定

- 监听 `session/event` 的 `turn/start`（任务开始）与 `turn/end`（任务结束，
  覆盖 `completed` / `error` / `max-tokens` / `aborted` / `interrupted` /
  `blocked` 等全部结束原因），跨会话按「打开中的 turn 总数」引用计数，
  0→1 拿锁、1→0 放锁——子代理（subagent）任务嵌套时不会提前放锁。
- 插件卸载（热重载 / 退出）时无条件放锁。

## 验证（Linux）

```sh
# 任务执行期间：
systemd-inhibit --list   # 应能看到 dsh-awake 的 inhibit 记录
# 任务结束后：
systemd-inhibit --list   # 记录消失；ps 中不再有 systemd-inhibit / sleep 子进程
```

web 端：任务运行期间系统不会休眠；把页面切到后台再切回，Wake Lock 会自动重取
（可在设置页关闭方案A 验证）。插件不注入任何页面 UI。

## 常见问题

- **`systemd-inhibit --list` 看不到记录？** 确认系统是 systemd、方案B 已开启、
  且当前确实有任务在运行（`turn/start` 已触发）。
- **方案A 不生效？** 浏览器不支持 Wake Lock（Firefox 桌面版等），或页面不是
  https / localhost。改用方案B。
- **方案C 打开后设置没变？** 检查当前桌面是否为 GNOME（Linux），
  以及是否有管理员/root 权限（Windows / macOS）。

## 许可

MIT License
