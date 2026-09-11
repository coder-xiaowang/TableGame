export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;

export const ROLE = Object.freeze({ MASTER: "master", INSIDER: "insider", COMMON: "common" });
export const MASTER_ANSWERS = Object.freeze(["yes", "no", "unknown"]);

export const SECRET_SECONDS = 30;
export const QUESTION_SECONDS = 300;
export const VOTE_SECONDS = 30;
export const TIE_BREAK_SECONDS = 20;

const WORD_GROUPS = Object.freeze({
  动物: ["熊猫","长颈鹿","企鹅","海豚","松鼠","刺猬","孔雀","袋鼠","斑马","骆驼","河马","犀牛","狐狸","浣熊","树懒","水獭","章鱼","海星","螃蟹","蝴蝶","蜻蜓","蜜蜂","蚂蚁","蜗牛","青蛙","乌龟","鹦鹉","猫头鹰","啄木鸟","天鹅"],
  食物: ["饺子","火锅","披萨","汉堡","寿司","面包","蛋糕","冰淇淋","巧克力","爆米花","棉花糖","薯条","三明治","方便面","豆腐","汤圆","粽子","月饼","烤鸭","玉米","西瓜","草莓","葡萄","菠萝","柠檬","椰子","蘑菇","蜂蜜","奶酪","酸奶"],
  物品: ["雨伞","钥匙","镜子","闹钟","剪刀","蜡烛","枕头","毛巾","牙刷","梳子","背包","钱包","眼镜","手套","围巾","扇子","杯子","筷子","勺子","盘子","扫帚","拖把","锤子","螺丝刀","放大镜","指南针","望远镜","温度计","订书机","回形针"],
  地点: ["图书馆","博物馆","电影院","游乐园","动物园","水族馆","体育馆","火车站","飞机场","地铁站","医院","学校","超市","餐厅","咖啡馆","邮局","银行","公园","海滩","沙漠","森林","草原","瀑布","山洞","灯塔","城堡","寺庙","农场","厨房","阳台"],
  职业: ["医生","护士","教师","警察","消防员","厨师","记者","律师","法官","司机","飞行员","画家","作家","演员","导演","歌手","摄影师","建筑师","工程师","科学家","宇航员","运动员","裁缝","理发师","邮递员","导游","魔术师","侦探","园丁","渔夫"],
  自然: ["太阳","月亮","星星","彩虹","闪电","雷声","云朵","雾气","露珠","雪花","冰川","火山","地震","台风","龙卷风","海浪","潮汐","河流","湖泊","岛屿","山峰","峡谷","岩石","泥土","沙子","树叶","花朵","种子","影子","回声"],
  交通: ["自行车","摩托车","公交车","出租车","救护车","消防车","火车","地铁","轮船","帆船","潜水艇","飞机","直升机","热气球","火箭","滑板","雪橇","缆车","电梯","扶梯","红绿灯","斑马线","隧道","桥梁","车站","码头","方向盘","安全带","轮胎","船锚"],
  娱乐: ["足球","篮球","排球","羽毛球","乒乓球","网球","游泳","滑雪","跑步","跳绳","象棋","围棋","扑克牌","骰子","拼图","风筝","秋千","跷跷板","滑梯","积木","漫画","小说","电影","音乐会","舞台剧","马戏团","烟花","电子游戏","桌游","捉迷藏"],
  科技: ["电脑","手机","键盘","鼠标","屏幕","耳机","音箱","相机","打印机","机器人","无人机","卫星","雷达","电池","充电器","遥控器","二维码","密码","网站","电子邮件","网络","芯片","显微镜","计算器","空调","冰箱","洗衣机","微波炉","吸尘器","电风扇"],
  概念: ["时间","记忆","梦想","秘密","谎言","勇气","运气","友谊","规则","比赛","生日","假期","春天","夏天","秋天","冬天","早晨","黄昏","昨天","明天","方向","速度","声音","颜色","形状","温度","距离","重量","数字","名字"]
});

export const WORD_BANK = Object.freeze(Object.entries(WORD_GROUPS).flatMap(([category, words]) =>
  words.map((text, index) => Object.freeze({ id: `${category}_${index + 1}`, category, text }))
));

export function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new RangeError(`人数必须为${MIN_PLAYERS}至${MAX_PLAYERS}人。`);
  }
  return capacity;
}

function randomIndex(length, random) {
  return Math.min(length - 1, Math.max(0, Math.floor(Number(random()) * length)));
}

export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function assignRoles(playerIds, random = Math.random) {
  if (!Array.isArray(playerIds) || playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new RangeError(`身份分配需要${MIN_PLAYERS}至${MAX_PLAYERS}名玩家。`);
  }
  const order = shuffle(playerIds, random);
  return new Map(order.map((id, index) => [id, index === 0 ? ROLE.MASTER : index === 1 ? ROLE.INSIDER : ROLE.COMMON]));
}

export function chooseWord(recentWordIds = [], random = Math.random) {
  const blocked = new Set(recentWordIds);
  const candidates = WORD_BANK.filter((word) => !blocked.has(word.id));
  const pool = candidates.length ? candidates : WORD_BANK;
  return pool[randomIndex(pool.length, random)];
}
