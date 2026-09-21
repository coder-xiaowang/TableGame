export const FIXTURES = Object.freeze([
  { id: "portrait-01", category: "portrait", title: "暖色正面头像", file: "fixtures/portrait/portrait-01.svg", focus: ["双眼可区分", "发型轮廓完整", "嘴部不消失"] },
  { id: "portrait-02", category: "portrait", title: "侧脸与眼镜", file: "fixtures/portrait/portrait-02.svg", focus: ["眼镜边缘连续", "侧脸与背景分离", "头发高光可见"] },
  { id: "pet-01", category: "pet", title: "橘猫", file: "fixtures/pet/pet-01.svg", focus: ["双耳尖角保留", "眼睛可辨认", "条纹不过度碎裂"] },
  { id: "pet-02", category: "pet", title: "黑白犬", file: "fixtures/pet/pet-02.svg", focus: ["耳朵与头部分离", "鼻口区域清楚", "黑白色块稳定"] },
  { id: "anime-01", category: "anime", title: "蓝发角色", file: "fixtures/anime/anime-01.svg", focus: ["眼睛高光保留", "深色描边连续", "发梢不粘连"] },
  { id: "anime-02", category: "anime", title: "红帽角色", file: "fixtures/anime/anime-02.svg", focus: ["帽檐轮廓清楚", "面部五官存在", "红色层次可区分"] },
  { id: "logo-01", category: "logo", title: "几何花标", file: "fixtures/logo/logo-01.svg", focus: ["四个花瓣对称", "中心留白存在", "硬边缘不模糊"] },
  { id: "logo-02", category: "logo", title: "字母与圆环", file: "fixtures/logo/logo-02.svg", focus: ["字母P可识别", "圆环不断裂", "双色边界清楚"] },
  { id: "scenery-01", category: "scenery", title: "山间日落", file: "fixtures/scenery/scenery-01.svg", focus: ["太阳与山脊分离", "远近山层次存在", "天空渐变不过度碎裂"] },
  { id: "scenery-02", category: "scenery", title: "湖畔树影", file: "fixtures/scenery/scenery-02.svg", focus: ["树干保持连续", "倒影方向明确", "湖岸轮廓可见"] },
  { id: "pixel-art-01", category: "pixel-art", title: "像素蘑菇", file: "fixtures/pixel-art/pixel-art-01.svg", focus: ["原始方格边缘保持", "白色斑点保留", "轮廓不被平滑"] },
  { id: "pixel-art-02", category: "pixel-art", title: "像素飞船", file: "fixtures/pixel-art/pixel-art-02.svg", focus: ["左右对称", "舷窗和尾焰保留", "背景星点不过量"] }
]);

export const CATEGORY_LABELS = Object.freeze({
  portrait: "人物头像", pet: "宠物", anime: "动漫插画", logo: "Logo / 图标", scenery: "风景", "pixel-art": "像素画"
});

export const DEFAULT_SCENARIOS = Object.freeze([
  { id: "easy-24", label: "易制作", width: 24, height: 24, maximumColors: 8, profile: "easy" },
  { id: "balanced-32", label: "均衡推荐", width: 32, height: 32, maximumColors: 16, profile: "balanced" },
  { id: "detailed-48", label: "高细节", width: 48, height: 48, maximumColors: 24, profile: "detailed" }
]);

export const FULL_SCENARIOS = Object.freeze(["easy", "balanced", "detailed"].flatMap((profile) => [
  { id: `${profile}-24-8`, label: `${profile} · 24格/8色`, width: 24, height: 24, maximumColors: 8, profile },
  { id: `${profile}-32-16`, label: `${profile} · 32格/16色`, width: 32, height: 32, maximumColors: 16, profile },
  { id: `${profile}-48-24`, label: `${profile} · 48格/24色`, width: 48, height: 48, maximumColors: 24, profile }
]));
