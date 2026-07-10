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
    expenseMode: game.expenseMode || game.aaMode || 'none',
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

// ===== 规则模板（更风趣牙贱口，<= 280 字） =====
function templateReview(f) {
  const lines = []

  const openers = f.durationMin
    ? [
      `${f.durationMin} 分钟，${f.playerCount} 个人，桌上发生的事比《孙子兵法》还精彩。`,
      `${f.durationMin} 分钟一场，${f.playerCount} 人围炉夜话，话题只有一个：「为什么是我」。`,
      `打了 ${f.durationMin} 分钟，${f.playerCount} 个人轮流给彼此上课，学费已结清。`
    ]
    : [
      `${f.playerCount} 个人速战速决，今晚地板和钱包都没怎么热起来。`,
      `${f.playerCount} 人闪击战，一杯茶还没凉，账已经算完。`
    ]
  lines.push(pick(openers))

  if (f.bigWinner) {
    const w = f.bigWinner
    const wPct = f.totalPot ? Math.round((w.profit / f.totalPot) * 100) : 0
    const winnerLines = [
      `今晚 MVP：${w.nickname}，独吞 ${w.profit}（约 ${wPct}% 总池），孙子说"善战者，致人而不致于人"，说的就是他。`,
      `${w.nickname} +${w.profit}，赢得不像兵法，倒像玄学，下次记得带上他。`,
      `${w.nickname} 笑收 ${w.profit}，建议宵夜由他买，毕竟"取用于国，因粮于敌"。`
    ]
    lines.push(pick(winnerLines))
  }

  if (f.bigLoser) {
    const loserLines = [
      `${f.bigLoser.nickname} ${f.bigLoser.profit}，输得最稳的人往往是下次最稳的赢家。`,
      `心态奖颁给 ${f.bigLoser.nickname}：${f.bigLoser.profit}，下次记住"小敌之坚，大敌之擒也"，别硬刚。`,
      `${f.bigLoser.nickname} 今晚 ${f.bigLoser.profit}，复盘三件事就够：位置、对手、自己别上头。`
    ]
    lines.push(pick(loserLines))
  }

  if (f.totalRebuys >= f.playerCount * 2) {
    lines.push(`全场补了 ${f.totalRebuys} 次码，人均两轮起步，今晚的 ATM 不是机器，是你们。`)
  } else if (f.totalRebuys >= f.playerCount) {
    lines.push(`全场 ${f.totalRebuys} 次补码，看来"将能而君不御者胜"，谁也不肯先认怂。`)
  } else if (f.totalRebuys === 0) {
    lines.push('全场零补码，要么个个紧得像保险柜，要么牌实在不肯给力，下次大胆点。')
  }

  if (f.me) {
    if (f.me.profit > 0) {
      lines.push(
        pick([
          `你今晚 +${f.me.profit}，宵夜随便点，毕竟"兵贵胜，不贵久"，及时收手最帅。`,
          `你 +${f.me.profit}，赢家发言权拉满，记得收着点。`
        ])
      )
    } else if (f.me.profit < 0) {
      lines.push(
        pick([
          `你今晚 ${f.me.profit}，回家路上想想哪几手 marginal 跟得太松，位置 / 人数 / 风格三件事缺一不可。`,
          `你 ${f.me.profit}，没事，"多算胜，少算不胜"，下次先算完再下注。`
        ])
      )
    } else {
      lines.push('你今晚账面持平，不输就是赢，回家睡个好觉。')
    }
  }

  if (f.extraCost > 0) {
    const label = f.expenseMode === 'winner' ? '水上 AA' : '全员 AA'
    lines.push(`其他费用 ${f.extraCost} 按「${label}」记账，不进盈亏，结账请坦坦荡荡。`)
  }

  return lines.join(' ').slice(0, 320)
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
