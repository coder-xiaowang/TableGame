# BANG! · 服务器权威状态机设计

## 1. 设计目标

状态机必须在SQLite快照中完整表达当前阶段、待处理效果、响应目标、角色触发和后续去向。恢复时不得依赖浏览器状态、未落库的定时器回调或闭包。

核心要求：

- 所有随机、距离、牌效、伤害、奖励和胜负由服务器处理；
- 一张牌完全结算前禁止无关动作；
- 每个响应窗口有唯一编号，旧请求不能被新阶段重新解释；
- 多目标牌按确定顺序逐人结算；
- 任意关键阶段可序列化、重启恢复并继续；
- 80张游戏牌始终守恒且ID唯一。

## 2. 顶层状态

```js
state = {
  stateVersion: 1,
  phase: "lobby",
  capacity: 4,
  players: [],
  currentIndex: 0,
  sheriffId: null,
  drawPile: [],
  discardPile: [],
  turn: null,
  pending: null,
  pendingTriggers: [],
  effectSequence: 0,
  deadline: 0,
  winner: null,
  moments: [],
  momentSequence: 0,
  logs: [],
  logSequence: 0
};
```

玩家状态：

```js
player = {
  id,
  name,
  isHost,
  connected,
  seat,
  role,          // 按视图裁剪
  character,     // 公开
  health,
  maxHealth,
  hand: [],      // 仅本人可见
  equipment: [], // 公开
  eliminated: false
};
```

游戏牌状态：

```js
card = {
  id,
  type,
  suit,
  rank
};
```

回合状态：

```js
turn = {
  number,
  playerId,
  bangPlayed: 0,
  startedAt
};
```

## 3. 顶层阶段图

```text
lobby
  └─ start
      └─ turnStart
          ├─ dynamiteCheck
          ├─ jailCheck
          ├─ drawChoice / draw
          └─ play
               ├─ response
               ├─ judgmentChoice
               ├─ generalStoreChoice
               ├─ dying
               ├─ eliminationDiscard
               ├─ discardExcess
               └─ nextTurn → turnStart

任意淘汰结算点
  └─ winCheck → ended
```

`phase`只表达当前唯一允许的交互类型。目标、响应次数、候选牌与后续去向放入`pending`，不用大量互相组合的布尔字段。

## 4. 待处理效果与并发防护

```js
pending = {
  id: "effect_42",
  kind: "bangDefense",
  sourcePlayerId,
  cardId,
  targetIds: [],
  cursor: 0,
  currentTargetId,
  requiredResponses: 1,
  receivedResponses: 0,
  damage: 1,
  options: [],
  data: {},
  continuation: { type: "resumePlay", playerId }
};
```

响应动作必须携带：

```js
{
  type: "respondMissed",
  effectId: "effect_42",
  effectKind: "bangDefense"
}
```

服务端先校验房间`expectedVersion`，再校验`effectId`和`effectKind`。不匹配时返回`stale_effect`，绝不能按当前`phase`重新解释旧操作。

每次打开新的目标响应、木桶选择、决斗轮次或濒死救援，都生成新的效果编号或明确的子步骤编号。客户端按钮捕获渲染时的房间版本和效果编号，点击后立即禁用，等待新视图。

### 4.1 当前代码中的落地映射

设计图里的`kind`在引擎中落实为`pending.type`，每次新窗口由`newPending()`生成`effect_N`。浏览器的`submit()`会自动把当前`pending.id`放入动作的`effectId`；共享权威服务器同时附带房间`expectedVersion`与全局唯一`actionId`。

因此一次响应同时受到三层保护：

1. `actionId`防止网络重试导致同一动作重复执行；
2. `expectedVersion`防止两个并发动作都按旧房间版本成功；
3. `effectId`防止旧按钮被错误解释成新响应窗口的动作。

实际动作名采用通用入口，例如`respond`、`takeHit`、`chooseJudgment`，再由当前`pending.type`决定所需牌型和结算含义；它们与下文示意名`respondMissed`表达的是同一状态转换。

## 5. 可序列化延续

`continuation`只能保存数据，不能保存函数：

```js
{ type: "resumePlay", playerId }
{ type: "continueTargetQueue", rootEffectId }
{ type: "continueDuel", nextPlayerId, otherPlayerId }
{ type: "afterDamage", sourcePlayerId, targetPlayerId }
{ type: "finishElimination", playerId, killerId }
{ type: "beginDiscardExcess", playerId }
{ type: "beginNextTurn" }
```

统一通过`continueFrom(state, continuation, context)`推进，避免每种卡牌各自复制下一回合、胜负和恢复逻辑。

## 6. 开局

`start`动作按以下顺序执行：

1. 校验玩家数等于容量且所有玩家在线；
2. 根据4～7人配置生成并洗匀身份；
3. 记录警长并公开其身份；
4. 从16名角色中随机分配不重复角色；
5. 设置生命上限，警长额外+1；
6. 生成并洗匀80张带花色点数的游戏牌；
7. 按生命值发初始手牌；
8. 当前玩家设为警长；
9. 进入`turnStart`。

## 7. 回合开始流水线

### `turnStart`

- 跳过淘汰玩家并初始化`turn`；
- 有Dynamite则进入`dynamiteCheck`；
- 之后有Jail则进入`jailCheck`；
- 否则进入抽牌流水线。

### `dynamiteCheck`

- 普通角色翻1张；Lucky Duke翻2张并进入秘密选择；
- 黑桃2～9：Dynamite先弃置，再产生3点无来源伤害；
- 其他结果：传给左侧下一名存活玩家；
- 当前玩家被炸死时跳过后续回合阶段，否则继续监狱检查。

### `jailCheck`

- 普通角色翻1张；Lucky Duke翻2张并选择；
- 红桃继续抽牌，否则跳过本回合；
- Jail无论结果都弃置；
- 被关押玩家在其他玩家回合仍可正常响应与濒死自救。

## 8. 抽牌流水线

- 普通角色自动抽2张；
- Black Jack公开第二张，红桃或方块时额外抽1张；
- Jesse Jones选择第一张来自牌库或另一玩家随机手牌，第二张来自牌库；
- Kit Carlson仅本人查看顶3张并选择2张，另1张留在牌库顶；
- Pedro Ramirez可选择第一张取弃牌堆顶，第二张来自牌库；
- 抽牌与所有触发完成后才进入`play`。

## 9. 出牌阶段

服务端必须重新校验：

- 当前玩家、阶段和手牌归属；
- 目标存活、距离与射程；
- 本回合BANG!次数及Volcanic/Willy例外；
- 同名蓝牌与单武器限制；
- 当前不存在尚未结束的其他效果。

客户端可显示每张牌是否可用及原因，但不能成为唯一校验来源。

玩家手动结束出牌：手牌不超生命值则进入下一回合；否则进入`discardExcess`并弃置精确数量。

## 10. BANG!响应链

```text
打出BANG!
→ 创建bangDefense
→ 可选角色/实体Barrel判定
→ 累计Missed!效果
→ 可选手牌Missed!/Calamity转换
→ 满足防御：恢复出牌阶段
→ 防御不足：造成1点伤害
→ 濒死、角色触发、淘汰、胜负
→ 恢复出牌阶段
```

- 普通BANG!需要1次防御，Slab需要2次；
- Jourdonnais与实体Barrel可提供两次独立机会；
- 每个步骤都绑定当前效果编号；
- 目标是唯一有权响应者。

## 11. 多目标牌

Gatling和Indians!生成以出牌者左侧开始的存活目标队列：

```js
{
  kind: "targetQueue",
  cardType: "gatling",
  sourcePlayerId,
  targetIds,
  cursor,
  currentTargetId
}
```

- Gatling为当前目标打开一次普通防御，但忽略Slab加成；
- Indians!要求当前目标弃BANG!，Calamity可用Missed!代替；
- 当前目标的伤害、救援、淘汰和奖励完全结束后才推进；
- 淘汰后立即检查胜负，并从剩余队列跳过已淘汰玩家。

## 12. Duel

```js
{
  kind: "duel",
  sourcePlayerId,
  opponentId,
  currentResponderId: opponentId,
  otherPlayerId: sourcePlayerId,
  continuation: { type: "resumePlay", playerId: sourcePlayerId }
}
```

当前响应者弃合法BANG!后交换两名响应者。无法、不愿或超时弃牌者受到1点来源为发起者的伤害，随后结束Duel。Calamity可提交Missed!作为BANG!。

## 13. General Store

```js
{
  kind: "generalStore",
  sourcePlayerId,
  revealedCards: [],
  chooserIds: [],
  cursor: 0,
  picks: []
}
```

候选牌与选择结果公开。只有`chooserIds[cursor]`可以选择；超时由服务器随机分配。最后一张分配完才恢复原行动者的`play`。

## 14. Panic!与Cat Balou

行动者先选目标，再选区域：

- 隐藏手牌区只提交区域意图，由服务器随机牌ID；
- 公开装备提交具体牌ID；
- Panic!校验距离1并转移给行动者；
- Cat Balou不校验距离并移入弃牌堆；
- 移动完成后进入统一角色触发检查。

## 15. 伤害与濒死

```js
{
  kind: "dying",
  playerId,
  healthDeficit,
  sourcePlayerId,
  cause,
  continuation
}
```

- 先扣除完整伤害，允许生命暂时为0或负数；
- 需要恢复`1 - health`点才能存活；
- 可逐张使用有效Beer，Sid可弃2张恢复1；
- 只剩2名存活者时Beer无治疗效果，不能救援；
- 放弃或超时进入淘汰；
- Bart与El Gringo按实际失去生命结算，但死亡玩家不能先靠伤害触发抽牌寻找Beer。

## 16. 淘汰流水线

```text
救援失败
→ 公开身份
→ 选择牌的处理顺序
→ Vulture取得或进入弃牌堆
→ 歹徒奖励 / 警长误杀惩罚
→ 更新距离和目标队列
→ 检查胜负
→ 原效果后续或ended
```

- Vulture存活时取得淘汰者手牌和装备；
- 警长兼Vulture误杀副警长时先取得其牌，再弃掉自己的全部牌；
- 淘汰歹徒奖励抽3张；
- Dynamite的`sourcePlayerId`为`null`，不产生击杀奖惩。

## 17. 角色触发队列

原子牌移动或伤害完成后生成可序列化触发，不在移动函数内递归执行：

```js
pendingTriggers = [
  { type: "suzyEmptyHand", playerId },
  { type: "bartDamaged", playerId, amount },
  { type: "elGringoDamaged", playerId, sourcePlayerId, amount },
  { type: "vultureElimination", playerId, eliminatedPlayerId }
];
```

触发逐个执行并落库，避免Suzy抽牌、El Gringo取牌、Vulture转移和警长惩罚发生顺序冲突。

## 18. 牌库与守恒

统一实现`drawCards`、`drawJudgment`、`discardCards`和`reshuffleIfNeeded`。80张牌必须且只能位于：

- 牌库；
- 弃牌堆；
- 玩家手牌；
- 玩家公开装备；
- General Store候选区；
- Kit Carlson候选区；
- 判定暂存区；
- 当前待结算牌区。

正在结算的牌不能提前进入重洗集合。`validateState()`检查总数、位置和唯一ID。

## 19. 超时映射

`handleTimeout()`按`phase + pending.kind`选择默认动作：

- `play`：结束出牌；
- `barrelChoice`：跳过Barrel；
- `bangDefense`：放弃剩余防御；
- `duel/indians`：不弃BANG!；
- `generalStore`：随机取得一张；
- `dying`：放弃救援；
- `discardExcess`：随机弃到上限；
- `drawChoice/judgmentChoice`：选择合法默认项；
- `eliminationDiscard`：生成确定顺序。

超时与玩家操作必须调用同一规则函数，不能复制一套简化结算。

## 20. 视图裁剪

`buildView(state, viewerId)`：

- 本人看到自己的身份、手牌和私人选择；
- 所有人看到警长、淘汰身份、公开角色、生命、装备、手牌数、判定和公共候选；
- 随机抽取手牌时不向无关玩家暴露真实牌ID；
- 淘汰玩家权限关闭，但不会获得额外秘密。

`buildSpectatorView(state)`：

- `selfId = null`；
- 不包含未公开身份、手牌、秘密候选和私人合法选项；
- 规则动作权限恒为`false`。

## 21. 页面映射

- 宽屏按座位圆桌排列并显示相对距离；
- 手机切换紧凑玩家列表，清除桌面绝对坐标；
- 主桌面包含牌库、弃牌堆、公开装备和中央事件；
- 房间工具进入标题栏；规则默认折叠；记录位于旁观席之前；
- 当前行动、倒计时、响应与私人手牌进入同一操作坞；
- 玩家模式移动端吸附，旁观模式取消吸附；
- 点击手牌后高亮合法目标，触屏不依赖拖拽；
- 动画由服务器公共事件驱动，不从日志文本反推状态。

## 22. 最低测试矩阵

### 规则与状态机

- 80张牌的数量、唯一ID、花色和点数；
- 4～7人身份配置、16名角色生命与能力；
- 双向距离、淘汰压缩、距离修正和射程；
- Dynamite先于Jail，普通与Lucky Duke判定；
- 普通、Slab、Jourdonnais双Barrel防御；
- Gatling、Indians!、Duel逐步响应；
- General Store逐人选择；
- 多点濒死、多Beer和两人Beer失效；
- 歹徒奖励、警长误杀副警长及Vulture顺序；
- 每个角色至少一个能力测试；
- 每种超时分支。

### 并发、恢复与隐私

- 重复响应只执行一次；旧`effectId`不能应用到下一目标；
- 多目标、General Store、Duel、濒死和淘汰阶段重启后继续；
- 任意关键阶段80张牌守恒；
- 玩家、对手和旁观者的完整视图隐私对比；
- 满房旁观、主动旁观、断线恢复和旁观者禁止行动。

### UI

- 标题栏、折叠规则、记录、旁观席和操作坞符合开发指导；
- 320/360/390/430px无重叠、裁切和横向滚动；
- 手机不维持圆桌；玩家与旁观者采用不同吸附策略。
