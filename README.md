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
```

`test:layout` 使用本机 Chrome、临时浏览器配置和内存房间，检查满员对局的座位裁切、重叠、横向溢出，以及独立操作区和座位点击可达性。截图与测量结果写入 `audit/layout-after/`，原审查结果不会被覆盖。默认检查九款游戏；可用 `LAYOUT_GAMES=game18,game19` 缩小范围，使用 `CHROME_PATH` 指定 Chrome 可执行文件。Windows 隔离测试运行器使用 `--no-sandbox`，仅访问自己启动的本地服务；其他平台默认保留浏览器沙箱。

首批布局改造覆盖 `game13`、`game18`、`game19`、`game21`。BANG 和犯人在跳舞通过 `shared/styles/table-layout.css` 共用可用宽高、座位栏和独立操作区；窄屏/短屏使用紧凑座位，内容较多时在桌面内部滚动。美术主题仍由各游戏管理。

其余多人项目已按玩法调整布局。`shared/styles/play-layout.css` 提供通过 `data-play-*` 属性启用的视口外壳：公共桌面独立滚动，操作区在文档流中占位，资料区可展开。各游戏的 `table-layout.css` 保留围桌座次、市场、农场、牌组和地图的不同排布；No Thanks 与截码战采用局部调整。修改布局时应保持玩家 ID、座次规则和服务器的私密视图边界。

`test:layout:remaining` 检查剩余 18 个多人项目的桌面、平板、手机和横屏尺寸；对使用新外壳的项目额外检查展开资料、旁观模式和滚动后的按钮命中情况。结果写入 `audit/play-layout-checks/`。默认速速破译使用 8 人词库局；设置 `GAME1_PLAYERS=32` 时使用玩家出词模式检查 32 人场景，避免内置词库容量限制。PowerShell 可用 `$env:LAYOUT_GAMES='game,game16'` 选择项目。此脚本检查布局与访问性，不替代每款游戏完整流程的联机验收。
