# game16 · 政变（COUP）

经典基础版、3～6 人、服务器权威联机实现。浏览器只提交行动意图；身份、牌库、质疑、阻挡、影响力损失、倒计时和胜负均由 Node 服务端判定。

## 本地启动

```bash
SPECTATORS_ENABLED=1 PORT=8802 GAME16_DB_PATH=./game16/.data/game16.sqlite node game16/signal-server.js
```

打开 `http://127.0.0.1:8802/`。SQLite 父目录必须允许运行服务的账户写入。

## 服务器环境变量

```ini
PORT=8802
GAME16_DB_PATH=/var/lib/tablegame/game16/game16.sqlite
SPECTATORS_ENABLED=1
SPECTATOR_LIMIT=10
```

游戏只支持经典五角色基础规则；两人变体和扩展角色暂未加入。
