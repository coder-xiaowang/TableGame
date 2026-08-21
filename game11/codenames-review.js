"use strict";

// 基准：公开整理的 Codenames 基础版英文 400 词。
// 中文为面向《截码战》的编辑译法，并非官方中文译名。
export const REVIEW_SOURCE = "https://github.com/Gullesnuffs/Codenames/blob/master/wordlist-eng.txt";
const PAIR_TEXT = `
AFRICA:非洲
AGENT:特工
AIR:空气
ALIEN:外星人
ALPS:阿尔卑斯山
AMAZON:亚马孙
AMBULANCE:救护车
AMERICA:美国
ANGEL:天使
ANTARCTICA:南极
APPLE:苹果
ARM:手臂
ATLANTIS:亚特兰蒂斯
AUSTRALIA:澳大利亚
AZTEC:阿兹特克
BACK:后背
BALL:球
BAND:乐队
BANK:银行
BAR:酒吧
BARK:树皮
BAT:蝙蝠
BATTERY:电池
BEACH:海滩
BEAR:熊
BEAT:节拍
BED:床铺
BEIJING:北京
BELL:铃铛
BELT:腰带
BERLIN:柏林
BERMUDA:百慕大
BERRY:浆果
BILL:账单
BLOCK:街区
BOARD:木板
BOLT:螺栓
BOMB:炸弹
BOND:纽带
BOOM:爆炸
BOOT:靴子
BOTTLE:瓶子
BOW:弓
BOX:盒子
BRIDGE:桥梁
BRUSH:刷子
BUCK:雄鹿
BUFFALO:水牛
BUG:虫子
BUGLE:军号
BUTTON:纽扣
CALF:小牛
CANADA:加拿大
CAP:便帽
CAPITAL:首都
CAR:汽车
CARD:卡片
CARROT:胡萝卜
CASINO:赌场
CAST:石膏
CAT:猫
CELL:细胞
CENTAUR:半人马
CENTER:中心
CHAIR:椅子
CHANGE:零钱
CHARGE:充电
CHECK:支票
CHEST:胸膛
CHICK:小鸡
CHINA:中国
CHOCOLATE:巧克力
CHURCH:教堂
CIRCLE:圆圈
CLIFF:悬崖
CLOAK:披风
CLUB:俱乐部
CODE:密码
COLD:寒冷
COMIC:漫画
COMPOUND:化合物
CONCERT:音乐会
CONDUCTOR:指挥家
CONTRACT:合同
COOK:厨师
COPPER:铜
COTTON:棉花
COURT:法庭
COVER:封面
CRANE:起重机
CRASH:碰撞
CRICKET:蟋蟀
CROSS:十字架
CROWN:皇冠
CYCLE:周期
CZECH:捷克
DANCE:舞蹈
DATE:约会
DAY:白天
DEATH:死亡
DECK:甲板
DEGREE:学位
DIAMOND:钻石
DICE:骰子
DINOSAUR:恐龙
DISEASE:疾病
DOCTOR:医生
DOG:狗
DRAFT:草稿
DRAGON:龙
DRESS:连衣裙
DRILL:钻头
DROP:水滴
DUCK:鸭子
DWARF:侏儒
EAGLE:鹰
EGYPT:埃及
EMBASSY:大使馆
ENGINE:发动机
ENGLAND:英格兰
EUROPE:欧洲
EYE:眼睛
FACE:脸庞
FAIR:集市
FALL:坠落
FAN:风扇
FENCE:篱笆
FIELD:田野
FIGHTER:战斗机
FIGURE:雕像
FILE:文件
FILM:电影
FIRE:火焰
FISH:鱼
FLUTE:长笛
FLY:苍蝇
FOOT:脚掌
FORCE:力量
FOREST:森林
FORK:叉子
FRANCE:法国
GAME:游戏
GAS:气体
GENIUS:天才
GERMANY:德国
GHOST:幽灵
GIANT:巨人
GLASS:玻璃
GLOVE:手套
GOLD:黄金
GRACE:优雅
GRASS:草地
GREECE:希腊
GREEN:绿色
GROUND:地面
HAM:火腿
HAND:手掌
HAWK:猎鹰
HEAD:头部
HEART:心脏
HELICOPTER:直升机
HIMALAYAS:喜马拉雅山
HOLE:洞穴
HOLLYWOOD:好莱坞
HONEY:蜂蜜
HOOD:兜帽
HOOK:钩子
HORN:号角
HORSE:马
HORSESHOE:马蹄铁
HOSPITAL:医院
HOTEL:酒店
ICE:冰块
ICE CREAM:冰淇淋
INDIA:印度
IRON:铁
IVORY:象牙
JACK:千斤顶
JAM:果酱
JET:喷气机
JUPITER:木星
KANGAROO:袋鼠
KETCHUP:番茄酱
KEY:钥匙
KID:孩子
KING:国王
KIWI:猕猴桃
KNIFE:刀
KNIGHT:骑士
LAB:实验室
LAP:膝头
LASER:激光
LAWYER:律师
LEAD:铅
LEMON:柠檬
LEPRECHAUN:爱尔兰精灵
LIFE:生命
LIGHT:光线
LIMOUSINE:豪华轿车
LINE:线条
LINK:链接
LION:狮子
LITTER:垃圾
LOCH NESS:尼斯湖
LOCK:锁头
LOG:原木
LONDON:伦敦
LUCK:运气
MAIL:邮件
MAMMOTH:猛犸象
MAPLE:枫树
MARBLE:大理石
MARCH:游行
MASS:质量
MATCH:火柴
MERCURY:水星
MEXICO:墨西哥
MICROSCOPE:显微镜
MILLIONAIRE:百万富翁
MINE:矿井
MINT:薄荷
MISSILE:导弹
MODEL:模型
MOLE:鼹鼠
MOON:月亮
MOSCOW:莫斯科
MOUNT:坐骑
MOUSE:鼠标
MOUTH:嘴巴
MUG:马克杯
NAIL:钉子
NEEDLE:针
NET:网
NEW YORK:纽约
NIGHT:夜晚
NINJA:忍者
NOTE:笔记
NOVEL:小说
NURSE:护士
NUT:坚果
OCTOPUS:章鱼
OIL:石油
OLIVE:橄榄
OLYMPUS:奥林匹斯山
OPERA:歌剧
ORANGE:橙子
ORGAN:器官
PALM:棕榈树
PAN:平底锅
PANTS:裤子
PAPER:纸张
PARACHUTE:降落伞
PARK:公园
PART:零件
PASS:通行证
PASTE:浆糊
PENGUIN:企鹅
PHOENIX:凤凰
PIANO:钢琴
PIE:馅饼
PILOT:飞行员
PIN:别针
PIPE:管道
PIRATE:海盗
PISTOL:手枪
PIT:深坑
PITCH:音高
PLANE:飞机
PLASTIC:塑料
PLATE:盘子
PLATYPUS:鸭嘴兽
PLAY:剧本
PLOT:情节
POINT:点
POISON:毒药
POLE:杆子
POLICE:警察
POOL:水池
PORT:港口
POST:邮局
POUND:英镑
PRESS:出版社
PRINCESS:公主
PUMPKIN:南瓜
PUPIL:学生
PYRAMID:金字塔
QUEEN:皇后
RABBIT:兔子
RACKET:球拍
RAY:光束
REVOLUTION:革命
RING:戒指
ROBIN:知更鸟
ROBOT:机器人
ROCK:岩石
ROME:罗马
ROOT:根部
ROSE:玫瑰
ROULETTE:轮盘
ROUND:回合
ROW:一排
RULER:尺子
SATELLITE:卫星
SATURN:土星
SCALE:天平
SCHOOL:学校
SCIENTIST:科学家
SCORPION:蝎子
SCREEN:屏幕
SCUBA DIVER:潜水员
SEAL:海豹
SERVER:服务器
SHADOW:影子
SHAKESPEARE:莎士比亚
SHARK:鲨鱼
SHIP:轮船
SHOE:鞋子
SHOP:商店
SHOT:射击
SINK:水槽
SKYSCRAPER:摩天大楼
SLIP:滑倒
SLUG:蛞蝓
SMUGGLER:走私者
SNOW:雪花
SNOWMAN:雪人
SOCK:袜子
SOLDIER:士兵
SOUL:灵魂
SOUND:声音
SPACE:太空
SPELL:咒语
SPIDER:蜘蛛
SPIKE:尖刺
SPINE:脊柱
SPOT:斑点
SPRING:泉水
SPY:间谍
SQUARE:广场
STADIUM:体育馆
STAFF:权杖
STAR:星星
STATE:州
STICK:棍子
STOCK:股票
STRAW:吸管
STREAM:溪流
STRIKE:罢工
STRING:细绳
SUB:潜艇
SUIT:西装
SUPERHERO:超级英雄
SWING:秋千
SWITCH:开关
TABLE:桌子
TABLET:平板电脑
TAG:标签
TAIL:尾巴
TAP:水龙头
TEACHER:老师
TELESCOPE:望远镜
TEMPLE:寺庙
THEATER:剧院
THIEF:小偷
THUMB:拇指
TICK:蜱虫
TIE:领带
TIME:时间
TOKYO:东京
TOOTH:牙齿
TORCH:火炬
TOWER:塔楼
TRACK:轨道
TRAIN:火车
TRIANGLE:三角形
TRIP:旅行
TRUNK:树干
TUBE:软管
TURKEY:火鸡
UNDERTAKER:殡葬师
UNICORN:独角兽
VACUUM:真空
VAN:面包车
VET:兽医
WAKE:尾流
WALL:围墙
WAR:战争
WASHER:洗衣机
WASHINGTON:华盛顿
WATCH:手表
WATER:水
WAVE:浪潮
WEB:蛛网
WELL:水井
WHALE:鲸鱼
WHIP:鞭子
WIND:风
WITCH:女巫
WORM:蠕虫
YARD:院子`;

const EXCLUSIONS = Object.freeze({
  AZTEC:"地域文化门槛较高", BARK:"英文双义在中文中无法保留", BAT:"英文双义在中文中无法保留",
  BILL:"英文多义依赖语境", BOND:"英文多义依赖语境", BOW:"英文多义依赖语境", BUCK:"英文多义且地域性强",
  CAST:"英文多义依赖语境", CELL:"英文多义差异过大", CHANGE:"中文义项联想深度不足", CHARGE:"英文多义差异过大",
  CHECK:"英文多义依赖语境", CLUB:"英文多义差异过大", COMPOUND:"译法专业性偏强", CONDUCTOR:"英文多义无法同时保留",
  COURT:"英文多义依赖语境", COVER:"英文多义依赖语境", CRANE:"英文双义无法同时保留", CRICKET:"英美语境义项分裂",
  CZECH:"地域性较强", DATE:"英文多义无法同时保留", DECK:"英文多义依赖语境", DEGREE:"英文多义依赖语境",
  DRAFT:"英文多义依赖语境", FAIR:"英文多义依赖语境", FALL:"英文多义依赖语境", FAN:"英文双义无法同时保留",
  FIGURE:"英文多义依赖语境", FLY:"英文双义无法同时保留", GRACE:"抽象译法边界模糊", GREEN:"单纯颜色提示空间有限",
  GROUND:"英文多义依赖语境", HAM:"提示方向较窄", HOOD:"地域服饰义项较强", JACK:"英文专名与多义依赖语境",
  JAM:"英文多义无法同时保留", LAP:"英文多义且中文不自然", LEAD:"英文读音与多义无法保留", LEPRECHAUN:"地域文化门槛较高",
  LIGHT:"英文多义无法同时保留", LINE:"英文多义过多", LINK:"中文译法偏技术化", LITTER:"英文多义依赖语境",
  LOCH_NESS:"地域文化门槛较高", MARCH:"英文月份双义无法保留", MASS:"英文多义且译法偏专业", MATCH:"英文多义无法同时保留",
  MERCURY:"英文多义无法同时保留", MINE:"英文双义无法同时保留", MINT:"英文多义无法同时保留", MOUNT:"译法不够自然",
  OLYMPUS:"地域神话门槛较高", PART:"含义过宽", PASS:"英文多义依赖语境", PITCH:"英文多义无法同时保留",
  PLAY:"英文多义无法同时保留", POINT:"含义过宽", POUND:"地域货币与多义依赖语境", PRESS:"英文多义无法同时保留",
  ROUND:"英文多义依赖语境", ROW:"译法提示空间不足", SCALE:"英文多义无法同时保留", SLIP:"动词义提示空间不足",
  SPRING:"英文多义无法同时保留", STATE:"地域行政概念且多义", STAFF:"英文多义无法同时保留", STOCK:"英文多义依赖语境",
  STRIKE:"英文多义无法同时保留", TAG:"译法偏技术化", TAP:"英文多义依赖语境", TICK:"地域常识门槛较高",
  TUBE:"译法边界不清", WAKE:"英文多义且中文义项生僻", WASHINGTON:"人物与地名歧义且地域性强"
});

// 人工语义审查：文字不同，但与现有词或同批候选过近时只保留更通用的一项。
const NEAR_CONFLICTS = Object.freeze({
  CAP:["帽子"], CONCERT:["音乐"], DRESS:["裙子"], FIGURE:["雕塑"], GRASS:["草原"],
  HAWK:["鹰"], HORN:["军号"], LIMOUSINE:["汽车"], ROBIN:["知更鸟"],
  SUPERHERO:["英雄"], THEATER:["电影院"], WATCH:["钟表"]
});

const keyOf = (en) => en.replaceAll(" ", "_");
export const CODENAMES_CANDIDATES = Object.freeze(PAIR_TEXT.trim().split("\n").map((line) => {
  const separator = line.indexOf(":");
  const en = line.slice(0, separator);
  const zh = line.slice(separator + 1);
  const excludedReason = EXCLUSIONS[keyOf(en)];
  return Object.freeze({ en, zh, status: excludedReason ? "excluded" : "candidate", reason: excludedReason || "待与现有词库比对", conflicts: [] });
}));

export function reviewAgainst(existingWords) {
  const existing = new Set(existingWords);
  return CODENAMES_CANDIDATES.map((item) => {
    if (item.status === "excluded") return item;
    const near = NEAR_CONFLICTS[keyOf(item.en)];
    if (near) return { ...item, status:"excluded", reason:"与已有或候选词语义过近", conflicts:near };
    if (existing.has(item.zh)) return { ...item, status:"merged", reason:"与现有原创词库精确重复", conflicts:[item.zh] };
    return { ...item, status:"included", reason:"中文常用且具备多轮提示空间", conflicts:[] };
  });
}
