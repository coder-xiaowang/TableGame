# CABO（game13）

基于 CABO 2019 Second Edition 规则的服务器权威联机实现，支持 2～4 人。

## 本地启动

```bash
node game13/signal-server.js
```

默认访问地址为 `http://localhost:8799`，SQLite 数据保存在 `game13/.data/game13.sqlite`。可通过 `PORT` 和 `GAME13_DB_PATH` 环境变量覆盖。

## 架构约束

- 浏览器只提交动作，洗牌、牌值、计时和计分均由 Node 服务端裁决。
- 每名玩家收到单独生成的视图；背面牌、牌库顺序和他人的私密查看结果不会发往客户端。
- Spy 与 Swap 会向目标玩家发送仅含被操作牌位的专属提示，牌值仍按原有隐藏信息规则隔离。
- 完整房间状态写入 SQLite，进程重启后可恢复牌库、阶段、截止时间和私密待处理动作。
- 协议版本为 v3，使用 `shared/server/start-authoritative-game-server.js` 和共享客户端。

## 演出层

牌库抽牌、弃牌、换牌、匹配、能力、CABO 宣告和结算均由服务端生成演出事件。公共事件不携带隐藏牌值；初始记忆、PEEK/SPY 精确牌位通过逐玩家私有事件发送。快速操作会按场景合并并压缩队列，刷新或重连不会重播历史。详细事件和验收边界见 [PRESENTATION_MIGRATION.md](PRESENTATION_MIGRATION.md)。

## 测试

```bash
node --test game13/*.test.*
```
