# game15：拉密服务器权威联机版

这是经典版拉密的2～4人服务器权威实现。比赛使用106张牌、每人14张牌、30分首次开牌、90秒回合、固定多局轮换先手，以及可回滚的私密牌桌草稿。

game15 已完成旁观模式代码迁移，是否开放由服务器环境变量控制。旁观者使用独立公共视图，只能看到玩家名单与牌架数量、已确认的公共牌桌、当前行动者、草稿编辑状态、确认后的变化高亮、公共日志和结算；任何玩家牌架、摸牌结果、浏览器草稿、撤销记录和未提交布局都不会发送给旁观者。

## 权威边界

- Node.js 保存完整牌池、全部私密牌架、公共牌桌、开牌资格、当前行动者、累计比分和截止时间。
- 浏览器只获得自己的牌架和公共牌桌；其他玩家只能看到手牌数量以及当前行动者是否正在整理草稿。
- 玩家提交最终布局后，服务器重新验证牌的唯一ID、106张牌守恒、全部牌组、首次30分、桌面旧牌去向和手牌来源。
- 草稿未确认前不会修改正式牌桌；成功提交后，服务器生成统一的变更牌ID并向所有玩家显示8秒高亮。
- SQLite在广播前保存完整房间快照，进程重启后恢复房间身份、私密牌架、倒计时、草稿罚牌状态和操作去重记录。
- 旁观者不计入开局人数、回合、计分或固定比赛局数，不能提交摸牌、编辑、确认或声明无牌可出操作。
- 玩家席和旁观席只可在准备大厅切换；房主不能离开玩家席。
- 满房或已经开局后加入会自动进入旁观席；房主可以关闭后续旁观加入或移出旁观者。

## 操作方式

- 桌面端可以拖放牌块，也可以点选牌块后点击目标牌或牌组末尾。
- 移动端使用点选牌块与目标位置，不依赖拖拽。
- 提供撤销、重置本回合、按颜色/数字整理手牌、确认提交和摸牌结束回合。
- 行动、倒计时和牌架合并为吸附控制台；移动端非本人回合自动折叠牌架以减少遮挡。

## 本地启动

需要支持 `node:sqlite` 的 Node.js 版本。在仓库根目录运行：

```text
node game15/signal-server.js
```

默认访问地址：

```text
http://127.0.0.1:8801/
```

可通过环境变量覆盖端口和数据库位置：

```text
PORT=8801
GAME15_DB_PATH=/var/lib/tablegame/game15/game15.sqlite
SPECTATORS_ENABLED=1
```

正式服务器应把数据库放在Git仓库之外，并确保运行服务的 `tablegame` 用户对 `/var/lib/tablegame/game15` 具有读写权限。

## 文件结构

- `rules.mjs`：经典牌库、牌组合法性、两张百搭赋值与手牌计分。
- `server/game-engine.mjs`：房间游戏状态、固定多局、行动校验、超时、计分和逐玩家视图。
- `app.js`：私密草稿编辑器、拖放/点选交互、撤销与页面渲染。
- `signal-server.js`：协议v3权威服务器和SQLite入口，默认端口8801。
- `RULES.md`：本项目采用的完整规则口径。
- `*.test.*`：纯规则、引擎、HTTP隐藏边界和SQLite恢复测试。

## 测试

```text
node --test game15/rules.test.mjs game15/game-engine.test.mjs game15/authoritative-server.test.cjs game15/persistence.test.cjs game15/spectator-mode.test.cjs
```

## 服务器实例参数

建议为现有systemd模板创建 `/etc/tablegame/game15.env`：

```ini
PORT=8801
GAME15_DB_PATH=/var/lib/tablegame/game15/game15.sqlite
NODE_ENV=production
SPECTATORS_ENABLED=1
```

并为数据库创建独立目录：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game15
```

首次开放旁观前应备份game15数据库，并在重启后检查 `/api/config` 返回 `spectatorsSupported: true` 与 `spectatorsEnabled: true`。如果真实联机发现旁观异常，将 `SPECTATORS_ENABLED` 改回 `0` 并只重启game15即可关闭旁观入口，不影响原有玩家模式。
