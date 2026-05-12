// cloudfunctions/termAi/index.js — 术语 AI 深度解释
// 同 aiReview 的策略：
//   - 默认走「本地规则模板」，给出比基础释义更口语化的"1 句话懂 + 1 个生动例子"
//   - 预留 hunyuan / cloudbase 真模型接入
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PROVIDER = process.env.STAX_AI_PROVIDER || 'template'

exports.main = async event => {
  const { termId, termEn } = event
  if (!termId && !termEn) return { ok: false, error: 'INVALID_PARAMS' }

  // 加载术语
  let term
  try {
    if (termId) {
      const r = await db.collection('terms').doc(termId).get()
      term = r.data
    } else {
      const r = await db.collection('terms').where({ termEn }).limit(1).get()
      term = r.data[0]
    }
  } catch (err) {
    return { ok: false, error: 'TERM_NOT_FOUND' }
  }
  if (!term) return { ok: false, error: 'TERM_NOT_FOUND' }

  let aiText
  try {
    if (PROVIDER === 'hunyuan') aiText = await callHunyuan(term)
    else if (PROVIDER === 'cloudbase') aiText = await callCloudbase(term)
    else aiText = templateAi(term)
  } catch (err) {
    console.error('[termAi] fallback to template:', err.message)
    aiText = templateAi(term)
  }

  return { ok: true, term, aiText, provider: PROVIDER }
}

// ===== 规则模板：场景化口语化释义 =====
function templateAi(term) {
  const cat = term.category
  const en = term.termEn
  const cn = term.termCn

  // 场景化前缀
  const scenarios = {
    rule:     `🎴 「${en} / ${cn}」一句话懂：`,
    action:   `🃏 「${en} / ${cn}」实战时机：`,
    position: `📍 「${en} / ${cn}」位置体感：`,
    hand:     `🂠 「${en} / ${cn}」拿到这手怎么打：`,
    concept:  `💡 「${en} / ${cn}」内功心法：`
  }
  const prefix = scenarios[cat] || `📖 「${en} / ${cn}」：`

  // 类别专属 AI 体感解读
  const insights = {
    rule:     `${term.definition}\n\n💬 通俗讲，这就是德州扑克的"游戏规则"，不懂这个根本玩不起来。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
    action:   `${term.definition}\n\n💬 什么时候用？看场面、看对手、看位置——三件事齐活儿才能打出 +EV 的决定。${term.example ? `\n\n🎯 真实场景：${term.example}` : ''}`,
    position: `${term.definition}\n\n💬 位置就是德州的"金钱本身"——前位是地狱，后位是天堂，按钮位是 GOAT。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
    hand:     `${term.definition}\n\n💬 拿到这手牌别上头——位置、人数、对手风格三件事先想清楚，再决定要不要投。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`,
    concept:  `${term.definition}\n\n💬 这是高手和新手的分水岭，懂这个能让你少输一半的钱。${term.example ? `\n\n🎯 比如：${term.example}` : ''}`
  }

  return prefix + (insights[cat] || term.definition)
}

async function callHunyuan(term) {
  throw new Error('HUNYUAN_NOT_CONFIGURED')
}
async function callCloudbase(term) {
  throw new Error('CLOUDBASE_AI_NOT_CONFIGURED')
}
