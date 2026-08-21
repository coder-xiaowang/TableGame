# 璀璨宝石 · 宝可梦版

## 启动

```text
node game8/signal-server.js
```

默认访问地址为 `http://localhost:8794`。页面和联机客户端依赖 `/shared/`，因此不要直接双击 `index.html`。

## 测试

```text
node game8/test/rules.test.cjs
node --test game8/test/cards.test.cjs
node --test shared/test/shared-client.test.js
```

## 结构

- `data/cards.json`：100 张基础卡牌的唯一数据源。
- `assets/cards/`：与基础牌库一一对应的 100 张卡面。
- `rules.js`：无 DOM 的独立规则引擎，同时支持浏览器和 Node。
- `app.js`：界面、房间座位映射和按玩家裁剪后的视图渲染。
- `signal-server.js`：使用项目公共联机服务和协议版本 2。

卡牌数据与卡面经原作者授权，用于非商业学习交流。
