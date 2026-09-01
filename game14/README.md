# game14：脏小猪服务器权威联机版

这是 Drecksau 的服务器权威实现，支持2～6名玩家。2～4人保持KOSMOS基础版54张行动牌，5～6人采用北美版增加3张猪舍的57张配置。

game14 已完成旁观模式代码迁移，是否开放由服务器环境变量控制。旁观者使用独立公共视图，只能看到玩家名单、手牌数量、农场与小猪状态、当前行动者、牌库/弃牌公开信息、公共日志，以及服务器已经确认成功的三张不可用牌公开换牌；任何玩家当前手牌和新换入的牌都不会发送给旁观者。

## 权威边界

- 浏览器只保存服务器发给当前玩家的私密视图并提交操作意图。
- Node 保存完整手牌、牌库、弃牌堆、猪舍附件、回合、deadline 和胜负。
- `buildView(state, viewerId)` 只向每名玩家发送自己的手牌，其他玩家只公开手牌数量。
- SQLite 在广播新视图前保存完整房间快照。
- 服务重启后恢复房间身份、私密手牌、回合、deadline 和行动去重记录。
- 旁观者不计入人数、回合和胜负，不能提交出牌、弃牌或换牌操作。
- 玩家席和旁观席只可在准备大厅切换；房主不能离开玩家席。
- 满房或已经开局后加入会自动进入旁观席；房主可以关闭后续旁观加入或移出旁观者。

## 文件结构

- `rules.mjs`：基础版与5～6人动态牌数、玩家配置、洗牌等纯规则。
- `server/game-engine.mjs`：完整状态、行动验证、目标判断、回合、超时、胜负和逐玩家视图。
- `signal-server.js`：接入共享协议v3服务器与SQLite。
- `app.js`：接收私密视图、渲染页面并提交意图。
- `assets/farm-table.jpg`：为牌桌生成并压缩的美式农场背景插画。
- `RULES.md`：本项目采用的完整规则口径。
- `*.test.*`：规则、引擎、HTTP权威边界和SQLite恢复测试。

## 本地启动

需要支持 `node:sqlite` 的 Node.js 版本（服务器当前使用 Node 24）。在仓库根目录执行：

```text
node game14/signal-server.js
```

默认访问地址：

```text
http://127.0.0.1:8800/
```

可通过环境变量覆盖端口和数据库文件：

```text
PORT=8800
GAME14_DB_PATH=/var/lib/tablegame/game14/game14.sqlite
SPECTATORS_ENABLED=1
```

正式服务器应把数据库放在仓库外，并确保运行服务的 `tablegame` 用户对目录具有读写权限。

## 测试

在仓库根目录执行：

```text
node --test game14/rules.test.mjs game14/game-engine.test.mjs game14/authoritative-server.test.cjs game14/persistence.test.cjs game14/spectator-mode.test.cjs
```

测试覆盖：

- 原版54张行动牌、5～6人57张行动牌和人数配置；
- 七种牌的效果与猪舍保护链；
- 任意单牌无效果弃置；
- 仅三张全部不可用时公开换牌；
- 玩家手牌隔离；
- 服务端回合和越权校验；
- 服务端超时；
- SQLite重启恢复和行动去重。
- 旁观者手牌隔离、伪造行动拦截、准备阶段换席、并发抢座与SQLite旁观身份恢复。

当前游戏状态版本为2。若曾使用早期开发版生成过 `.data/game14.sqlite`，其中的旧房间快照不会兼容新牌库配置；开发阶段可以删除旧测试数据库后重新创建房间。正式部署后每次改变状态结构都应同步规划迁移或清理策略。

## 服务器部署参数

- 协议版本：3
- 默认内部端口：8800
- 推荐数据库：`/var/lib/tablegame/game14/game14.sqlite`
- 推荐环境变量：`GAME14_DB_PATH`
- 旁观灰度开关：`SPECTATORS_ENABLED=1`

部署时还需为 game14 建立 systemd override、创建数据库目录并配置 Nginx 入口；不要让 Nginx 直接提供本目录的 `index.html`，游戏页面、API和SSE应统一反向代理到 game14 的 Node 进程。首次开放前应备份数据库；若真实联机发现旁观异常，将 `SPECTATORS_ENABLED` 改回 `0` 并只重启 game14 即可关闭旁观入口，不影响原有玩家模式。
