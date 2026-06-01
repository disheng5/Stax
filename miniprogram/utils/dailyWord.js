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
  { word: '和', note: '如温酒香', verse: '和气致祥，乖气致戾' }
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
