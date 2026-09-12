# game17：股海纵横

服务器权威的《Stockpile》基础版数字化实现，支持 2～5 名玩家、旁观、断线重连、SQLite 恢复和移动端点击操作。

## 本地启动

```bash
node game17/signal-server.js
```

默认端口为 `8803`，也可通过 `PORT` 覆盖。SQLite 默认写入 `game17/.data/game17.sqlite`，服务器推荐配置：

```ini
PORT=8803
GAME17_DB_PATH=/var/lib/tablegame/game17/game17.sqlite
SPECTATORS_ENABLED=1
SPECTATOR_LIMIT=10
```

## 演出层

供给入场、公开竞价、股票堆交割、行动牌、行情揭晓、涨跌/拆股/破产、卖出和分红都由服务端生成公开演出事件。暗牌内容、私人内幕和具体持仓不会写入事件。客户端按服务器场景分组播放并在快速结算时自动压缩队列，刷新或重连不会补播历史。详细设计与验收边界见 [PRESENTATION_MIGRATION.md](PRESENTATION_MIGRATION.md)。

## 测试

```bash
node --test game17/*.test.mjs game17/*.test.cjs
```

## 部署提示

先为 systemd 运行用户创建可写目录 `/var/lib/tablegame/game17`，再启动服务。不要手工创建 SQLite 的 `-wal` 和 `-shm` 文件。
