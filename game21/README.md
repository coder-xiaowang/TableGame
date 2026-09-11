# game21 间谍危机（Spyfall）

服务器权威、SQLite持久化并原生支持旁观的3～8人语音推理桌游。

本地启动：

```bash
node game21/signal-server.js
```

默认端口为 `8807`，可通过 `PORT` 修改。数据库默认位于 `game21/.data/game21.sqlite`，正式服务器建议设置：

```ini
GAME21_DB_PATH=/var/lib/tablegame/game21/game21.sqlite
```

详细规则和数字化裁定见 `RULES.md`。
