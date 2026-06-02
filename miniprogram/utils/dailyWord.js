const WORDS = [
  { word: '稳', note: '如一座山', verse: '泰山崩于前而色不变' },
  { word: '锐', note: '如出鞘剑', verse: '长风破浪会有时' },
  { word: '静', note: '如深潭水', verse: '静而后能安，安而后能虑' },
  { word: '柔', note: '如春日风', verse: '天下莫柔弱于水，而攻坚强者莫之能胜' },
  { word: '韧', note: '如老竹根', verse: '千磨万击还坚劲' },
  { word: '清', note: '如月下溪', verse: '明月松间照，清泉石上流' },
  { word: '准', note: '如老猎人', verse: '不鸣则已，一鸣惊人' },
  { word: '缓', note: '如行云过', verse: '行云流水，不滞于物' },
  { word: '聚', note: '如握满弓', verse: '蓄而后发，厚积薄发' },
  { word: '远', note: '如望天阔', verse: '会当凌绝顶，一览众山小' },
  { word: '轻', note: '如落叶飘', verse: '羽化而登仙' },
  { word: '默', note: '如夜深沉', verse: '此时无声胜有声' },
  { word: '坦', note: '如平湖面', verse: '胸怀坦荡，方能容天下' },
  { word: '专', note: '如绣花针', verse: '用志不分，乃凝于神' },
  { word: '退', note: '如潮归海', verse: '知止而后有定' },
  { word: '进', note: '如朝日升', verse: '乘风破浪，扶摇直上' },
  { word: '凝', note: '如冰封川', verse: '神凝气定，随机应变' },
  { word: '空', note: '如旷野风', verse: '无为而无不为' },
  { word: '简', note: '如一笔画', verse: '大道至简，衍化至繁' },
  { word: '深', note: '如老井水', verse: '深山藏古寺，大智若愚' },
  { word: '观', note: '如山中客', verse: '旁观者清，当局者迷' },
  { word: '待', note: '如等春雷', verse: '静待花开，时机自来' },
  { word: '隐', note: '如雾里灯', verse: '藏锋于鞘，伺机而动' },
  { word: '明', note: '如雪后晴', verse: '拨云见日，心如明镜' },
  { word: '逸', note: '如鹤掠林', verse: '闲云野鹤，超然物外' },
  { word: '定', note: '如老僧坐', verse: '心定则万物静' },
  { word: '慎', note: '如踏薄冰', verse: '如临深渊，如履薄冰' },
  { word: '舒', note: '如解长缨', verse: '宠辱不惊，去留无意' },
  { word: '凛', note: '如冬夜星', verse: '凛然正气，傲霜斗雪' },
  { word: '和', note: '如温酒香', verse: '和气致祥，乖气致戾' },
  { word: '沉', note: '如铁锚落', verse: '沉舟侧畔千帆过' },
  { word: '正', note: '如松挺立', verse: '身正不怕影子斜' },
  { word: '润', note: '如春夜雨', verse: '随风潜入夜，润物细无声' },
  { word: '朗', note: '如晴空万', verse: '海阔天空，心旷神怡' },
  { word: '厚', note: '如冬土藏', verse: '地势坤，君子以厚德载物' },
  { word: '通', note: '如水过隙', verse: '穷则变，变则通' },
  { word: '圆', note: '如月满时', verse: '大巧若拙，大辩若讷' },
  { word: '守', note: '如城不破', verse: '善守者藏于九地之下' },
  { word: '破', note: '如石出锋', verse: '不破不立，大破大立' },
  { word: '收', note: '如渔归港', verse: '见好就收，能舍能得' },
  { word: '散', note: '如烟入云', verse: '聚散终有时' },
  { word: '敛', note: '如虎卧眠', verse: '韬光养晦，以待天时' },
  { word: '宽', note: '如海纳川', verse: '海纳百川，有容乃大' },
  { word: '实', note: '如金沉底', verse: '脚踏实地，仰望星空' },
  { word: '灵', note: '如猫踏雪', verse: '灵机一动，妙手偶得' },
  { word: '笃', note: '如牛耕田', verse: '笃行致远，惟实励新' },
  { word: '达', note: '如风过岭', verse: '穷则独善其身，达则兼济天下' },
  { word: '诚', note: '如玉无瑕', verse: '精诚所至，金石为开' },
  { word: '畅', note: '如鱼入渊', verse: '鸢飞鱼跃，万物自得' },
  { word: '醒', note: '如晨钟鸣', verse: '众人皆醉我独醒' },
  { word: '净', note: '如雨洗尘', verse: '心如止水，身如琉璃' },
  { word: '融', note: '如冰化春', verse: '春风化雨，润物无声' },
  { word: '恒', note: '如北辰固', verse: '有恒者事竟成' },
  { word: '谦', note: '如谷受风', verse: '满招损，谦受益' },
  { word: '素', note: '如白纸展', verse: '绚烂之极归于平淡' },
  { word: '健', note: '如马奔原', verse: '天行健，君子以自强不息' },
  { word: '忍', note: '如刀藏鞘', verse: '小不忍则乱大谋' },
  { word: '悟', note: '如灯初燃', verse: '朝闻道，夕死可矣' },
  { word: '安', note: '如鸟归巢', verse: '心安即是归处' },
  { word: '觉', note: '如梦初醒', verse: '觉来知是梦，不胜悲' },
  { word: '容', note: '如天覆地', verse: '宰相肚里能撑船' },
  { word: '活', note: '如水绕石', verse: '问渠那得清如许，为有源头活水来' },
  { word: '顺', note: '如舟随流', verse: '顺势而为，事半功倍' },
  { word: '盈', note: '如杯将满', verse: '持盈保泰，知足常乐' }
]

function _hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff
  }
  let g = 0
  for (let i = str.length - 1; i >= 0; i--) {
    g = (((g << 3) ^ g) + str.charCodeAt(i) * (i + 1)) & 0xffffffff
  }
  return Math.abs(h ^ g)
}

function getDailyWord(openid) {
  const date = new Date().toISOString().slice(0, 10)
  const idx = _hash(date + (openid || 'default')) % WORDS.length
  return { date, ...WORDS[idx] }
}

function getYesterdayWord(openid) {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const date = d.toISOString().slice(0, 10)
  const idx = _hash(date + (openid || 'default')) % WORDS.length
  return { date, ...WORDS[idx] }
}

module.exports = { getDailyWord, getYesterdayWord }
