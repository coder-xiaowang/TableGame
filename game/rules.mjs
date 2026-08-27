export const TOPICS = Object.freeze({
  水果蔬菜: Object.freeze(["西瓜","香蕉","草莓","菠萝","葡萄","芒果","椰子","柠檬","火龙果","猕猴桃","榴莲","桃子","土豆","胡萝卜","西红柿","玉米","南瓜","蘑菇"]),
  食物: Object.freeze(["火锅","汉堡","寿司","披萨","螺蛳粉","臭豆腐","冰淇淋","烤鸭","麻辣烫","蛋炒饭","泡面","粽子","月饼","糖葫芦","榴莲","爆米花","奶茶","薯条"]),
  动物: Object.freeze(["猫","狗","兔子","熊猫","老虎","狮子","长颈鹿","大象","猴子","海豚","企鹅","袋鼠","章鱼","鳄鱼","孔雀","树懒","骆驼","啄木鸟","变色龙","刺猬","河马","猫头鹰","海马","鸭嘴兽"]),
  交通工具: Object.freeze(["自行车","公交车","地铁","出租车","火车","飞机","轮船","摩托车","电动车","高铁","救护车","热气球","滑板","缆车","潜水艇","直升机"]),
  地点场所: Object.freeze(["医院","学校","电影院","游乐园","动物园","图书馆","超市","机场","火车站","健身房","理发店","银行","派出所","网吧","厨房","沙漠","海底","月球"]),
  体育运动: Object.freeze(["篮球","足球","乒乓球","羽毛球","游泳","跑步","跳绳","滑雪","拳击","射箭","举重","体操","跳水","台球","排球","骑马","冲浪","拔河"]),
  职业: Object.freeze(["医生","老师","厨师","司机","律师","警察","画家","歌手","记者","程序员","消防员","宇航员","魔术师","摄影师","理发师","快递员","导游","裁判","侦探","飞行员","主播","保安"]),
  日用品: Object.freeze(["牙刷","水杯","雨伞","钥匙","书包","手机","眼镜","毛巾","台灯","拖鞋","吹风机","遥控器","充电宝","垃圾桶","剪刀","镜子","枕头","闹钟","手电筒","钥匙","行李箱","保温杯","订书机","体重秤"]),
  影视动漫角色: Object.freeze(["孙悟空","猪八戒","哪吒","葫芦娃","黑猫警长","柯南","哆啦A梦","蜡笔小新","奥特曼","蜘蛛侠","钢铁侠","蝙蝠侠","灭霸","哈利·波特","白雪公主","灰太狼","海绵宝宝","唐老鸭","范德彪","马大帅"])
});

export function normalizeWord(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toLocaleLowerCase();
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function createDerangement(size, random = Math.random) {
  if (!Number.isInteger(size) || size < 2) throw new TypeError("derangement requires at least two entries");
  const order = Array.from({ length:size }, (_, index) => index);
  for (let index = size - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.max(0, Math.min(0.999999999, random())) * index);
    [order[index], order[target]] = [order[target], order[index]];
  }
  return order;
}

export function uniqueTopicWords(topic) {
  return [...new Set((TOPICS[topic] || []).map((word) => String(word).trim()).filter(Boolean))];
}

export function normalizeSubmission({ word, trapWord, extra }, { playerWordMode, wordExtraMode }) {
  const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max + 1);
  const result = {
    word: clean(word, 30),
    trapWord: playerWordMode === "trap" ? clean(trapWord, 30) : "",
    extra: wordExtraMode === "none" ? "" : clean(extra, 100)
  };
  if (!result.word || result.word.length > 30) throw new TypeError("答案必须为 1–30 个字符。");
  if (playerWordMode === "trap") {
    if (!result.trapWord || result.trapWord.length > 30) throw new TypeError("陷阱词必须为 1–30 个字符。");
    if (normalizeWord(result.word) === normalizeWord(result.trapWord)) throw new TypeError("答案和陷阱词不能相同。");
  }
  if (wordExtraMode !== "none" && (!result.extra || result.extra.length > 100)) {
    throw new TypeError("附加信息必须为 1–100 个字符。");
  }
  return result;
}
