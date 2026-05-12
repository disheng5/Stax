// cloudfunctions/aiReview/index.js — AI 牌局复盘
// 当前实现策略：
//   1. 默认走「本地规则模板」（零成本、零外部依赖），生成"牙贱口 200 字"点评
//   2. 预留 hunyuan / cloudbase AI 真模型接入点；通过环境变量 STAX_AI_PROVIDER 切换
//      - 'template'  ：规则模板（默认，开箱可用）
//      - 'hunyuan'   ：腾讯混元（需在云函数控制台配置 HUNYUAN_SECRET_ID / HUNYUAN_SECRET_KEY）
//      - 'cloudbase' ：云开发智能能力（需开通）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PROVIDER = process.env.STAX_AI_PROVIDER || 'template'

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId } = event
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db.collection('games').doc(gameId).get().catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data
  if (game.status !== 'ended') return { ok: false, error: 'GAME_NOT_ENDED' }

  const facts = buildFacts(game, OPENID)
  let review
  try {
    if (PROVIDER === 'hunyuan') review = await callHunyuan(facts)
    else if (PROVIDER === 'cloudbase') review = await callCloudbase(facts)
    else review = templateReview(facts)
  } catch (err) {
    console.error('[ai] fallback to template:', err.message)
    review = templateReview(facts)
  }

  return { ok: true, facts, review, provider: PROVIDER }
}

// ===== 事实构建 =====
function buildFacts(game, viewerOpenid) {
  const players = (game.players || []).slice()
  const me = players.find(p => p.openid === viewerOpenid)
  const winners = players.filter(p => (p.finalProfit ?? p.profit) > 0).sort((a, b) => (b.finalProfit ?? b.profit) - (a.finalProfit ?? a.profit))
  const losers  = players.filter(p => (p.finalProfit ?? p.profit) < 0).sort((a, b) => (a.finalProfit ?? a.profit) - (b.finalProfit ?? b.profit))
  const totalRebuys = players.reduce((s, p) => s + (p.buyInCount - 1), 0)
  const durationMin = game.endedAt && game.startedAt ? Math.round((new Date(game.endedAt) - new Date(game.startedAt)) / 60000) : 0
  const totalPot = (game.totalPot || players.reduce((s, p) => s + p.totalBuyIn, 0))
  return {
    name: game.name,
    playerCount: players.length,
    durationMin,
    totalPot,
    totalRebuys,
    extraCost: game.extraCost || 0,
    aaMode: game.aaMode || 'none',
    me: me ? { nickname: me.nickname, profit: me.finalProfit ?? me.profit, buyInCount: me.buyInCount } : null,
    bigWinner: winners[0] || null,
    bigLoser:  losers[0]  || null,
    winners: winners.map(p => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit })),
    losers:  losers.map(p  => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit }))
  }
}

// ===== 规则模板（牙贱口 + 推股，<= 250 字） =====
function templateReview(f) {
  const lines = []
  // 开场
  if (f.durationMin) {
    lines.push(`聊了整整 ${f.durationMin} 分钟，${f.playerCount} 个人围着桌子转了 ${Math.round(f.durationMin / 30)} 圈，确认过眼神，是有故事的人。`)
  } else {
    lines.push(`${f.playerCount} 个人凑了一局，速战速决。`)
  }

  // 大赢家
  if (f.bigWinner) {
    const w = f.bigWinner
    const wPct = f.totalPot ? Math.round((w.profit / f.totalPot) * 100) : 0
    lines.push(`今晚的 MVP 是 ${w.nickname}，独吞 ${w.profit}（约占总池 ${wPct}%），运气和算计都拿满分。`)
  }
  // 大输家
  if (f.bigLoser) {
    lines.push(`心态最稳的是 ${f.bigLoser.nickname}，${f.bigLoser.profit} 也能笑着结账，下次可以少点儿冲动 all-in。`)
  }
  // 补码次数
  if (f.totalRebuys >= f.playerCount) {
    lines.push(`全场补了 ${f.totalRebuys} 次码，几乎人均一次，看来今晚都打得相当"投入"。`)
  } else if (f.totalRebuys === 0) {
    lines.push(`全场零补码，不是太稳就是太怂，下次大胆点。`)
  }

  // 个人观察
  if (f.me) {
    if (f.me.profit > 0)       lines.push(`你今晚 +${f.me.profit}，赢了这顿宵夜，明天继续保持耐心选位。`)
    else if (f.me.profit < 0)  lines.push(`你今晚 ${f.me.profit}，先复盘一下哪几手 marginal 牌跟得太松——位置、人数、对手风格三件事，下次先想清楚再投筹码。`)
    else                       lines.push(`你今晚账面持平，全身而退也是一种胜利。`)
  }

  // AA
  if (f.extraCost > 0) {
    lines.push(`额外 ${f.extraCost} 块${f.aaMode === 'winnerByRatio' ? '由赢家按比例担了' : '人均 AA 解决'}，结账清清爽爽。`)
  }

  return lines.join(' ').slice(0, 280)
}

// ===== 混元接入 stub =====
async function callHunyuan(facts) {
  // 待用户提供 SecretId/SecretKey；当前抛错，让外层 catch 走模板
  throw new Error('HUNYUAN_NOT_CONFIGURED')
}

async function callCloudbase(facts) {
  // 待用户开通云开发 AI 能力；当前抛错，让外层 catch 走模板
  throw new Error('CLOUDBASE_AI_NOT_CONFIGURED')
}
