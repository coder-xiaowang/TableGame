# 局内人 INSIDER · 服务器权威状态机

## 阶段图

```text
lobby
  → secretReveal
  → questioning
  → discussion
  → firstVote
      ├→ roundEnd
      └→ secondVote
            ├→ roundEnd
            └→ tieBreak → roundEnd
```

## 权威状态

服务器保存：玩家、连接状态、真实身份、答案、最近题目、轮数、阶段、绝对截止时间、猜中者、猜词耗时、准备状态、秘密投票、平票候选人、结算、统计与公共日志。

浏览器只提交操作意图，不提交“谁获胜”“谁是局内人”“票数是多少”等结果。

## 主要动作

```js
{ type: "setCapacity", capacity }
{ type: "start" }
{ type: "acknowledgeSecret" }
{ type: "showMasterAnswer", answer: "yes" | "no" | "unknown" }
{ type: "markCorrectGuesser", playerId }
{ type: "readyToVote" }
{ type: "submitFirstVote", accuse: true | false }
{ type: "submitSecondVote", targetId }
{ type: "resolveTie", targetId }
{ type: "nextRound" }
{ type: "end" }
```

每次动作重新检查行动者、阶段、资格、目标、是否重复提交以及当前状态版本。阶段推进、随机和超时全部发生在服务器。

## 私密视图

- 主持人：看到自己的主持人身份和答案，看不到局内人身份；
- 局内人：看到自己的局内人身份和答案；
- 普通人：只看到自己的普通人身份；
- 旁观者：进行中只看到公共阶段；
- 投票中：本人只看到自己的选择，所有人只看到提交名单；
- 结算后：答案、身份和已经完成的投票统一公开。

真实身份和答案不得通过日志、候选数组、错误信息或稳定秘密ID泄露。

## 超时

状态保存绝对 `deadline`。`handleTimeout` 根据阶段执行唯一合法兜底：自动确认、全员失败、进入投票、按已有票结算，或在平票候选人中服务器随机裁决。所有阶段和待处理信息均可序列化并从SQLite恢复。

