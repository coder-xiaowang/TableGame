export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const MATCH_ROUNDS = 5;
export const SECRET_SECONDS = 30;
export const ROUND_SECONDS = 8 * 60;
export const VOTE_SECONDS = 30;
export const NOMINATION_SECONDS = 20;

export const ROLE = Object.freeze({ SPY: "spy", OPERATIVE: "operative" });

const location = (id, name, roles) => Object.freeze({ id, name, roles: Object.freeze(roles) });

export const LOCATIONS = Object.freeze([
  location("airplane", "飞机", ["头等舱乘客","空乘人员","副驾驶","机长","机械师","经济舱乘客","空警"]),
  location("bank", "银行", ["押运员","经理","顾客","劫匪","柜员","保安","理财顾问"]),
  location("beach", "海滩", ["救生员","游客","冲浪者","摄影师","冰饮摊主","潜水员","渔夫"]),
  location("cathedral", "大教堂", ["神父","游客","唱诗班员","修复师","信徒","钟楼管理员","摄影师"]),
  location("casino", "赌场", ["荷官","保安","赌客","酒保","经理","魔术师","服务生"]),
  location("circus", "马戏团", ["驯兽师","小丑","杂技演员","观众","魔术师","售票员","场务"]),
  location("corporate_party", "公司聚会", ["总经理","实习生","秘书","会计","来宾","服务生","人事主管"]),
  location("crusader_army", "十字军军营", ["骑士","侍从","弓箭手","修士","厨子","俘虏","军需官"]),
  location("day_spa", "水疗中心", ["按摩师","顾客","美容师","接待员","清洁工","经理","理疗师"]),
  location("embassy", "大使馆", ["大使","外交官","警卫","访客","翻译","秘书","记者"]),
  location("hospital", "医院", ["医生","护士","病人","外科医生","护工","访客","药剂师"]),
  location("hotel", "酒店", ["前台","住客","行李员","经理","清洁员","厨师","门童"]),
  location("military_base", "军事基地", ["指挥官","士兵","军医","工程师","通讯员","厨师","哨兵"]),
  location("movie_studio", "电影制片厂", ["导演","演员","摄影师","编剧","化妆师","制片人","场务"]),
  location("ocean_liner", "远洋客轮", ["船长","水手","乘客","厨师","机械师","服务生","领航员"]),
  location("passenger_train", "客运列车", ["列车长","乘客","餐车服务员","检票员","司机","乘警","机械师"]),
  location("pirate_ship", "海盗船", ["船长","水手","俘虏","炮手","厨子","舵手","瞭望员"]),
  location("polar_station", "极地科考站", ["气象学家","医生","探险家","厨师","无线电员","生物学家","机械师"]),
  location("police_station", "警察局", ["警长","警探","嫌疑人","律师","记者","值班警员","法医"]),
  location("restaurant", "餐厅", ["主厨","服务生","顾客","经理","洗碗工","乐手","美食评论家"]),
  location("school", "学校", ["校长","教师","学生","校医","保安","清洁工","家长"]),
  location("service_station", "汽车维修站", ["修理工","司机","收银员","经理","拖车司机","学徒","顾客"]),
  location("space_station", "空间站", ["指挥官","宇航员","科学家","工程师","医生","游客","通讯员"]),
  location("submarine", "潜水艇", ["舰长","声呐员","机械师","水兵","厨师","鱼雷手","领航员"]),
  location("supermarket", "超级市场", ["收银员","顾客","保安","理货员","经理","试吃员","清洁工"]),
  location("theater", "剧院", ["演员","导演","观众","提词员","灯光师","检票员","舞台监督"]),
  location("university", "大学", ["教授","学生","院长","研究员","保安","图书管理员","助教"]),
  location("amusement_park", "游乐园", ["游客","检票员","设施操作员","吉祥物演员","保安","维修员","小吃摊主"]),
  location("art_museum", "美术馆", ["馆长","游客","保安","讲解员","修复师","画家","摄影师"]),
  location("zoo", "动物园", ["饲养员","游客","兽医","售票员","保安","摄影师","研究员"])
]);

export const LOCATION_IDS = Object.freeze(LOCATIONS.map((item) => item.id));

export function assertCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < MIN_PLAYERS || capacity > MAX_PLAYERS) {
    throw new RangeError(`人数必须为${MIN_PLAYERS}至${MAX_PLAYERS}人。`);
  }
  return capacity;
}

function randomIndex(length, random = Math.random) {
  return Math.min(length - 1, Math.max(0, Math.floor(Number(random()) * length)));
}

export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, random);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function chooseLocation(recentIds = [], random = Math.random) {
  const recent = new Set(recentIds);
  const candidates = LOCATIONS.filter((item) => !recent.has(item.id));
  const pool = candidates.length ? candidates : LOCATIONS;
  return pool[randomIndex(pool.length, random)];
}

export function dealRound(playerIds, locationData, random = Math.random) {
  if (!Array.isArray(playerIds) || playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new RangeError(`身份分配需要${MIN_PLAYERS}至${MAX_PLAYERS}名玩家。`);
  }
  const order = shuffle(playerIds, random);
  const roles = shuffle(locationData.roles, random);
  return new Map(order.map((id, index) => [id, index === 0
    ? { role: ROLE.SPY, locationRole: null }
    : { role: ROLE.OPERATIVE, locationRole: roles[index - 1] }
  ]));
}

export function findLocation(id) {
  return LOCATIONS.find((item) => item.id === String(id)) || null;
}
