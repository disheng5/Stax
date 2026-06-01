const WORDS = [
  { word: '稳', note: '如一座山' },
  { word: '锐', note: '如出鞘剑' },
  { word: '静', note: '如深潭水' },
  { word: '柔', note: '如春日风' },
  { word: '韧', note: '如老竹根' },
  { word: '清', note: '如月下溪' },
  { word: '准', note: '如老猎人' },
  { word: '缓', note: '如行云过' },
  { word: '聚', note: '如握满弓' },
  { word: '远', note: '如望天阔' },
  { word: '轻', note: '如落叶飘' },
  { word: '默', note: '如夜深沉' },
  { word: '坦', note: '如平湖面' },
  { word: '专', note: '如绣花针' },
  { word: '退', note: '如潮归海' },
  { word: '进', note: '如朝日升' },
  { word: '凝', note: '如冰封川' },
  { word: '空', note: '如旷野风' },
  { word: '简', note: '如一笔画' },
  { word: '深', note: '如老井水' },
  { word: '观', note: '如山中客' },
  { word: '待', note: '如等春雷' },
  { word: '隐', note: '如雾里灯' },
  { word: '明', note: '如雪后晴' },
  { word: '逸', note: '如鹤掠林' },
  { word: '定', note: '如老僧坐' },
  { word: '慎', note: '如踏薄冰' },
  { word: '舒', note: '如解长缨' },
  { word: '凛', note: '如冬夜星' },
  { word: '和', note: '如温酒香' }
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
