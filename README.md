# TableGame

原生 HTML/CSS/JavaScript 桌游集合。各游戏通过独立 Node 服务提供页面和房间；共享客户端、服务器与界面能力位于 `shared/`。Just One（`game12`）是未完成的遗留项目，暂不纳入本轮改造。

使用 Node.js 24 或更新版本。在项目根目录启动，例如：

```powershell
node game19/signal-server.js
```

端口与数据库路径参见对应游戏的 `signal-server.js`；用 `PORT` 和各游戏的 `GAMEN_DB_PATH` 配置运行环境，运行数据应放在静态发布目录之外。

验证命令：

```powershell
npm run test:shared
npm run test:layout
npm run test:layout:remaining
npm run test:interaction
```

`test:layout` 使用本机 Chrome、临时浏览器配置和内存房间，检查满员对局的座位裁切、重叠、横向溢出，以及独立操作区和座位点击可达性。截图与测量结果写入 `audit/layout-after/`，原审查结果不会被覆盖。默认检查九款游戏；可用 `LAYOUT_GAMES=game18,game19` 缩小范围，使用 `CHROME_PATH` 指定 Chrome 可执行文件。Windows 隔离测试运行器使用 `--no-sandbox`，仅访问自己启动的本地服务；其他平台默认保留浏览器沙箱。

首批布局改造覆盖 `game13`、`game18`、`game19`、`game21`。BANG 和犯人在跳舞通过 `shared/styles/table-layout.css` 共用可用宽高、座位栏和独立操作区；窄屏/短屏使用紧凑座位，内容较多时在桌面内部滚动。美术主题仍由各游戏管理。

其余多人项目已按玩法调整布局。`shared/styles/play-layout.css` 提供通过 `data-play-*` 属性启用的视口外壳：公共桌面独立滚动，操作区在文档流中占位，资料区可展开。各游戏的 `table-layout.css` 保留围桌座次、市场、农场、牌组和地图的不同排布；No Thanks 与截码战采用局部调整。修改布局时应保持玩家 ID、座次规则和服务器的私密视图边界。

`test:layout:remaining` 检查剩余 18 个多人项目的桌面、平板、手机和横屏尺寸；对使用新外壳的项目额外检查展开资料、旁观模式和滚动后的按钮命中情况。结果写入 `audit/play-layout-checks/`。默认速速破译使用 8 人词库局；设置 `GAME1_PLAYERS=32` 时使用玩家出词模式检查 32 人场景，避免内置词库容量限制。PowerShell 可用 `$env:LAYOUT_GAMES='game,game16'` 选择项目。此脚本检查布局与访问性，不替代每款游戏完整流程的联机验收。

速速破译在大厅显示去重后的词库容量，人数不足、离线或词库容量不足时禁用开局；房主可以在大厅切换词库或玩家出词模式。前端与服务端使用同一校验，服务端在任何开局状态变更前执行校验。

`shared/client/mobile-viewport.js` 在新布局项目及截码战中处理文字输入时的可视窗口变化。键盘缩小可用高度时，桌面外壳跟随可视高度，保留操作区滚动；键盘关闭后恢复布局，不禁用页面缩放。新布局包含屏幕安全区边距和触屏输入字号。拉密支持先点选牌、再点目标、新建牌组、取消选牌或放回牌架，桌面鼠标拖放仍保留。

`test:interaction` 使用内存房间、确定性牌面、真实服务器操作和 SSE，以及 Chrome 触摸事件检查：速速破译 32 人开局配置；四款文字输入游戏的草稿与模拟键盘；UNO 长手牌、选色取消与质疑；拉密触屏组牌、撤销、退回和提交；政变证明角色与阻挡；阿瓦隆从组队到任务、刺杀和结算。每个桌面阶段同时检查手机竖屏与短横屏。结果保存在 `audit/play-interactions/`，可用 `$env:INTERACTION_GAMES='game5,game15'` 筛选。操作系统键盘由可视窗口缩小模拟，仍需在真实 Android/iOS 上复核键盘、刘海安全区和触摸手感；这不是所有游戏分支的完整覆盖。

布局样式维护时，由 `shared/styles/play-layout.css` 负责视口高度、滚动和操作区占位，各游戏 `table-layout.css` 负责桌面座位与牌组排布，原主题样式负责颜色、材质和卡牌外观。本轮已清理德州扑克、拉密、政变、局内人中被新布局替代的固定高度、吸底和定位声明；后续新增布局规则应放入对应布局文件。
