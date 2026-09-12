# game18 · 犯人在跳舞

第三版基础规则的服务器权威数字版，支持3～8人、5/10分比赛、SQLite恢复和旁观模式。

## 本地启动

```bash
node game18/signal-server.js
```

默认访问 `http://127.0.0.1:8804/`。

## 服务器环境变量

```ini
PORT=8804
GAME18_DB_PATH=/var/lib/tablegame/game18/game18.sqlite
SPECTATORS_ENABLED=1
SPECTATOR_LIMIT=10
```

正式环境由 Nginx 通过 `https://criminal.zillionx.xyz/` 反向代理到 `http://127.0.0.1:8804`。前端只使用同源 `/api/` 路径。

## 测试

```bash
node --test game18/*.test.mjs game18/*.test.cjs
```

## 桌面互动演出

game18 已接入共享演出事件层，用方向轨迹、玩家高亮、物件提示和中央案情播报表现公开出牌、指认、目击、搜查、交易、秘密传牌及结算。动画不参与规则推进，公开与私人事件由服务端分别裁剪。

具体迁移目标、隐私边界和验收标准见 [PRESENTATION_MIGRATION.md](PRESENTATION_MIGRATION.md)。
