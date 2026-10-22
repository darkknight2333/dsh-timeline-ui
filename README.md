# dsh-timeline-ui · 对话时间线与导航增强

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面的一个客户端插件，做两件事，各自带开关：

| 功能 | 效果 |
|---|---|
| **对话时间线** | 侧边栏的会话列表按本地日历日期分组（今天 / 昨天 / 10月20日 / 2025年12月20日），新到旧排序、整列表编号、搜索、筛选已归档、查看全部 |
| **对话导航条左置 + 鱼眼** | 把对话区右侧的逐轮导航条移到左侧边缘；鼠标经过时按“横线中心到指针的距离”做高斯衰减，形成平滑波峰，离开后回到统一短线 |

两个功能都可以在 **设置 → 通用** 里单独关掉，关掉即恢复原生界面。

> English summary: [README.en.md](README.en.md)

---

## 安装

要求：DeepSeek Harness Web 版（桌面版同样适用，它加载的就是同一套 Web 客户端），插件以 bundle 形式安装到 **profile**。

### 方式一：Release 附件（推荐）

从 [Releases](../../releases) 下载 `dsh-timeline-ui-0.1.0.tgz`，然后让 Harness 里的 Agent 安装这个包，或在你的 profile 目录里执行：

```bash
# profile 目录：桌面版/Web 版都是 <DSH_HOME>/profiles/<profile>/
cd "$DSH_HOME/profiles/desktop"
pnpm add /path/to/dsh-timeline-ui-0.1.0.tgz
```

然后在 profile 的 `package.json` 的 `dsh.profile.bundles` 里加上 `dsh-timeline-ui`，重启 Harness。

### 方式二：直接从 GitHub

```bash
cd "$DSH_HOME/profiles/desktop"
pnpm add github:<owner>/dsh-timeline-ui
```

`lib/` 是构建产物且已入库，因此从 git 安装也能直接运行（不会触发本仓库的构建脚本）。

### 桌面版与 Web 版如何选择 profile

两者用的是同一套客户端与同一份 profile 数据，区别只在启动方式：

- **桌面版**：`%APPDATA%\@deepseek-ai\dsh-desktop\` 里的应用加载 `<DSH_HOME>/profiles/<名字>`；默认 profile 名通常是 `desktop`。
- **Web 版**（`dsh web`）：由进程的环境变量 `DSH_PROFILE` 决定 profile 名，未设置时用默认 profile。

安装前先确认要改哪一个：`echo $env:DSH_PROFILE`（PowerShell）或看 profile 目录里已有的 `package.json`。**不要**在安装目录（`DeepSeek Harness` 的程序目录）里放插件——升级会覆盖掉。

### 安装后

设置 → 通用 里会多出两行开关，默认都打开。侧边栏底部会多一个「全部对话」图标，点开是完整列表。

---

## 设置

| 行 | 默认 | 关掉之后 |
|---|---|---|
| 对话列表按日期分组 | 开 | 侧边栏恢复 Harness 原生的工作区/会话列表 |
| 对话导航条左置 + 鱼眼 | 开 | 导航条回到右侧、恢复原生长短 |

开关保存在该浏览器的 localStorage（`dsh-timeline-ui/prefs@1`），不会写进会话或 profile 设置。

## 使用

- **分组**：以**本地日历零点**为界，不用“相差 24 小时”判断，跨零点、跨年、夏令时切换当天都正确。
- **编号与快捷键**：所有条目连续编号；`Ctrl+1…9`（macOS `⌘+1…9`）跳转到前 9 条。焦点在输入框时不触发。
- **菜单**：行尾 `…` 提供「复制会话 ID」「归档」。
- **筛选**：顶部 ≡ 图标切换「显示已归档」。
- **导航条**：点击横线跳转到该轮；悬停显示该轮预览；当前阅读位置保持深色。

---

## 兼容性与验证

**已测试**：DeepSeek Harness `0.2.1-rc.2`（Windows 桌面版）。

| 项目 | 状态 |
|---|---|
| 构建、单元/离线测试（56 项） | ✅ 自动通过 |
| 插件安装、启用、设置行注册 | ✅ 自动通过 |
| 停用/卸载后恢复原生界面 | ✅ 代码路径已测（清理样式、监听器、观察器） |
| 真实界面截图、鱼眼观感、缩放/折叠 | ⚠️ **需人工确认**，见 [docs/VERIFICATION.md](docs/VERIFICATION.md) |

导航条功能依赖 Harness 内部结构（它不是一个 slot）。插件**不写死 CSS 哈希**：运行时探测“带 `_frame` 类名的 `<nav>` + 子级 `button[data-index]` + 父级 `_slot`”这一结构并据此生成样式。如果新版本把结构改掉，该功能会**自动停用**，并在设置行里显示「未在当前 DSH 版本中找到对话导航条」，不会误伤其他组件。

## 已知限制

- 导航条探测失败时只停用导航条，侧边栏分组不受影响。
- 侧边栏列表通过槽位优先级接管原生浏览器，因此**不提供**工作区的新增/重命名/删除界面；会话重命名、分支需要回到原生列表（临时关掉开关即可）。
- 分组按浏览器本地时区计算；同一账号在不同时区看到的日期分组可能不同。
- 只支持 Web 客户端（桌面版即基于它），不支持 headless / CLI。

## 停用与卸载

- **只停用**：设置 → 插件 → 关闭「对话时间线与导航增强」，或把两个开关关掉（更轻）。
- **卸载**：设置 → 插件 → 卸载；或 `cd <profile> && pnpm remove dsh-timeline-ui`，并从 `dsh.profile.bundles` 里删掉该名字。
- 卸载不会删除任何会话、归档状态或 Harness 设置。若要一并清掉开关记录，可在浏览器控制台执行 `localStorage.removeItem('dsh-timeline-ui/prefs@1')`。

## 从旧版本地插件迁移

早期版本是两个独立目录（`@local/dsh-session-timeline`、`@local/dsh-rail-left`）。迁移步骤：

1. 安装本插件并确认生效；
2. 停用/卸载那两个旧 bundle；
3. 刷新页面。

本插件启动时会检测旧 bundle 的样式标记，若仍存在会在控制台给出提示（不自动改动你的其他插件）。

## 开发

```bash
npm run build     # src/client.js → lib/client.js（包装成 ModuleLoader 工厂）+ 可移植性检查
npm test          # 56 项离线测试：分组、筛选、编号、导航条探测、开关、清理
npm run verify    # build + test
```

仓库结构：

```
src/client.js        唯一源码（工厂函数体，末尾 return { inject, apply }）
scripts/build.mjs    包装 + 失败即报错的构建（无第三方依赖，输出可复现）
lib/                 构建产物（已入库，安装时直接用）
test/run.mjs         离线测试（伪 DOM + 伪 React）
locale/              插件元数据（中/英）
docs/                验证记录、截图说明
```

## 许可与素材

- 代码：MIT（见 [LICENSE](LICENSE)）。
- 图标：本仓库原创 SVG，随 MIT 一同发布。
- 未包含任何第三方截图、Harness 源码或素材；不依赖 Harness 的任何私有包。

## 致谢

界面结构与交互参考了 Claude / Codex 的会话列表形态；实现完全基于 Harness 公开的槽位与标准 props。
