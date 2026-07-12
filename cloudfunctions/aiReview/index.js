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
const { hasForbiddenWording } = require('./wording.js')

function normalizeExpenseMode(value) {
  return ['winner', 'winnerRatio', 'winnerByRatio'].includes(value) ? 'winner' : 'all'
}

const PROVIDER = process.env.STAX_AI_PROVIDER || 'template'

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId } = event
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
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
  // 被淘汰/踢出的玩家不参与复盘统计
  const players = (game.players || []).filter(p => !p.eliminatedAt)
  const me = players.find(p => p.openid === viewerOpenid)
  const winners = players
    .filter(p => (p.finalProfit ?? p.profit) > 0)
    .sort((a, b) => (b.finalProfit ?? b.profit) - (a.finalProfit ?? a.profit))
  const losers = players
    .filter(p => (p.finalProfit ?? p.profit) < 0)
    .sort((a, b) => (a.finalProfit ?? a.profit) - (b.finalProfit ?? b.profit))
  const totalRebuys = players.reduce((s, p) => s + (p.buyInCount - 1), 0)
  const durationMin =
    game.endedAt && game.startedAt
      ? Math.round((new Date(game.endedAt) - new Date(game.startedAt)) / 60000)
      : 0
  const totalPot = game.totalPot || players.reduce((s, p) => s + p.totalBuyIn, 0)
  return {
    name: game.name,
    playerCount: players.length,
    durationMin,
    totalPot,
    totalRebuys,
    extraCost: game.extraCost || 0,
    expenseMode: normalizeExpenseMode(game.expenseMode || game.aaMode),
    me: me
      ? { nickname: me.nickname, profit: me.finalProfit ?? me.profit, buyInCount: me.buyInCount }
      : null,
    bigWinner: winners[0] || null,
    bigLoser: losers[0] || null,
    winners: winners.map(p => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit })),
    losers: losers.map(p => ({ nickname: p.nickname, profit: p.finalProfit ?? p.profit }))
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ===== 规则模板（中性、人文，不羞辱、不公开他人低谷，<= 320 字） =====
// 措辞规范同 getMyAnalytics.note：可陈述中性群体事实（时长/人数/MVP/补码总量），
// 本人数据只谈本人；不出现「最大输家/独吞/学费/ATM/别硬刚」等施压或贬损表达。
function templateReview(f) {
  const lines = []

  const openers = f.durationMin
    ? [
      `${f.durationMin} 分钟，${f.playerCount} 个人，一起把一个晚上认真地过完了。`,
      `${f.durationMin} 分钟一局，${f.playerCount} 人同桌，牌是媒介，人才是主角。`,
      `打了 ${f.durationMin} 分钟，${f.playerCount} 个人各自做了很多次选择。`
    ]
    : [
      `${f.playerCount} 个人一局速战，轻松的一晚。`,
      `${f.playerCount} 人小聚，节奏不快，重在同桌。`
    ]
  lines.push(pick(openers))

  if (f.bigWinner) {
    const w = f.bigWinner
    const wPct = f.totalPot ? Math.round((w.profit / f.totalPot) * 100) : 0
    lines.push(
      pick([
        `今晚状态最好的是 ${w.nickname}（约占总池 ${wPct}%）。顺手的时候，节奏往往比运气更值得留意。`,
        `${w.nickname} 今晚发挥出色。结果在短期里很响，决策质量通常更安静。`
      ])
    )
  }

  if (f.totalRebuys >= f.playerCount) {
    lines.push(`全场补了 ${f.totalRebuys} 次码，牌局节奏偏活跃，大家都愿意再试试手感。`)
  } else if (f.totalRebuys === 0) {
    lines.push('全场零补码，整体偏稳健——稳定本身也是一种风格。')
  }

  if (f.me) {
    if (f.me.profit > 0) {
      lines.push(
        pick([
          `你今晚 +${f.me.profit}，是不错的一晚。可以留意一下，哪一手的放弃事后觉得最正确。`,
          `你 +${f.me.profit}。顺境里最值钱的，是记住自己做对了哪个决定。`
        ])
      )
    } else if (f.me.profit < 0) {
      lines.push(
        pick([
          `你今晚 ${f.me.profit}。单局结果的波动是样本量不足的正常表现，不足以定义长期水平；下一次可以只观察一个可控变量，比如边缘起手是否停留得更久。`,
          `你 ${f.me.profit}。关注可控的变量，比关注结果更有效率——位置、人数、节奏，任选其一慢慢看。`
        ])
      )
    } else {
      lines.push('你今晚账面持平，重在同桌的这段时间。')
    }
  }

  if (f.extraCost > 0) {
    const label = f.expenseMode === 'winner' ? '水上比例' : '全员均摊'
    lines.push(`其他费用 ${f.extraCost} 按「${label}」记账，不计入盈亏。`)
  }

  // 守卫：万一未来编辑引入禁用措辞，剔除该行而非直接下发。
  return lines
    .filter(line => !hasForbiddenWording(line))
    .join(' ')
    .slice(0, 320)
}

// ===== 混元接入 stub =====
async function callHunyuan() {
  // 待用户提供 SecretId/SecretKey；当前抛错，让外层 catch 走模板
  throw new Error('HUNYUAN_NOT_CONFIGURED')
}

async function callCloudbase() {
  // 待用户开通云开发 AI 能力；当前抛错，让外层 catch 走模板
  throw new Error('CLOUDBASE_AI_NOT_CONFIGURED')
}
