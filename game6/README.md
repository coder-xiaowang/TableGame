# 牛头王联机版

game6 已升级为协议 v3 的可持久化服务端权威模式。牌堆、所有玩家手牌、秘密选牌、从小到大的落牌结算、收列罚分、倒计时与胜负判定全部由 Node.js 服务端执行；浏览器只提交操作，并接收服务器为当前玩家单独生成的脱敏视图。

## 启动

```text
node game6/signal-server.js
```

默认访问地址为 `http://localhost:8792`。页面依赖 `/shared/` 下的协议 v3 客户端模块，不能直接双击 `index.html` 游玩。

本地数据库默认为 `game6/.data/game6.sqlite`，该目录已被 Git 忽略。生产环境建议把数据库放在仓库之外：

```text
GAME6_DB_PATH=/var/lib/tablegame/game6/game6.sqlite PORT=8792 node game6/signal-server.js
```

服务使用 Node.js 内置 SQLite，推荐 Node.js 24。可以先检查：

```text
node -e "require('node:sqlite'); console.log('SQLite ready')"
```

## 权威边界

- 浏览器只能看到自己的真实手牌；其他玩家只显示相同数量的背面占位。
- 某人锁定的牌在全员选定前只有本人可见，其他人只能看到“已选牌”。
- 全员选定后，服务器删除对应手牌、按数字升序落牌，并计算收牌和牛头罚分。
- 全员选定后先进入公开阶段；每张牌的出牌者、数字、处理顺序和状态会显示在桌面上方。
- 服务器为普通放牌、收列放牌和轮末停顿分别发布带绝对起止时间的可恢复动画描述。
- 牌小于所有牌列末张时，服务器只允许当前出牌者选择牌列；超时或断线由服务器随机选择。
- 选牌阶段超时或断线时，服务器从该玩家真实手牌中随机代打。
- 每个可操作及演示阶段的绝对截止时间、待处理队列、当前动画与完整私密状态都写入 SQLite；服务重启后可恢复并继续计时。
- 房主只有开始下一局、结束游戏、调整大厅人数和移出玩家的管理权限，不会收到额外的秘密牌面。

游戏进行中移出玩家会取消当前对局并让剩余玩家返回大厅，这是为了避免改变人数后继续使用已经发出的牌造成规则不一致。

## 回合演示时间线

```text
selecting → revealing → placing → [choosingRow → placing] → turnEnding → selecting
```

- `revealing`：全部出牌公开展示约 2.6 秒。
- `placing`：服务器指定当前牌、目标列和动画编号；普通放牌约 1.2 秒，收列约 1.8 秒。
- `choosingRow`：牌小于所有牌列末张时暂停，当前玩家有 15 秒选择。
- `turnEnding`：全部放置后停顿约 0.9 秒，再开始下一回合。

动画开始时牌列仍是提交前状态，只有服务器计时结束后才会正式修改牌列和分数。因此客户端刷新、网络延迟或 Node.js 重启都不会造成重复结算。页面支持系统的“减少动态效果”偏好；8～10 人时公开牌区域使用横向滚动，避免压缩牌面。

## 测试

```text
node --test game6/rules.test.mjs game6/game-engine.test.mjs game6/authoritative-server.test.cjs game6/persistence.test.cjs
```

完整仓库回归：

```text
node --test
```

## 首次部署

旧版房间只存在房主浏览器内，无法迁移到新服务。部署协议 v3 前应确认没有正在进行的 game6 房间。假设 systemd 服务用户为 `tablegame`：

```text
sudo install -d -o tablegame -g tablegame -m 700 /var/lib/tablegame/game6
sudo systemctl edit tablegame@game6
```

加入环境变量：

```ini
[Service]
Environment=GAME6_DB_PATH=/var/lib/tablegame/game6/game6.sqlite
Environment=PORT=8792
```

更新并验证：

```text
cd /srv/tablegame
git pull --ff-only origin main
node --test game6/rules.test.mjs game6/game-engine.test.mjs game6/authoritative-server.test.cjs game6/persistence.test.cjs
sudo systemctl daemon-reload
sudo systemctl restart tablegame@game6
sudo systemctl status tablegame@game6 --no-pager
curl http://127.0.0.1:8792/api/ready
curl http://127.0.0.1:8792/api/config
```

接口应显示 `persistence: "sqlite"`、`durable: true`、`authorityMode: "server"` 和 `protocolVersion: 3`。
