// utils/mock-data.js — Demo 模式的内存种子数据
// 当 envId 未配置时使用；模拟"你 + Bob + Carol 三人"已经打了 5 局历史 + 1 局正在进行

const MY_OPENID = 'mock_me'
const NOW = Date.now()
const day = 24 * 3600 * 1000

// 当前用户档案
const me = {
  _id: 'user_me',
  _openid: MY_OPENID,
  nickname: 'Demo 玩家',
  avatar: '',
  createdAt: new Date(NOW - 30 * day),
  stats: {
    totalGames: 5,
    totalProfit: 230,
    biggestWin: 180,
    biggestLoss: -90,
    wins: 3
  }
}

const players3 = [
  { openid: MY_OPENID,    nickname: 'Demo 玩家', avatar: '' },
  { openid: 'mock_bob',   nickname: 'Bob',       avatar: '' },
  { openid: 'mock_carol', nickname: 'Carol',     avatar: '' }
]

function makeBlindStructure(sb, bb) {
  const out = []; let curSb = sb, curBb = bb
  for (let i = 0; i < 12; i++) {
    out.push({ sb: curSb, bb: curBb, ante: i >= 4 ? Math.floor(curBb / 4) : 0 })
    if (i % 2 === 1) { curSb *= 2; curBb *= 2 } else { curSb = Math.floor(curSb * 1.5); curBb = Math.floor(curBb * 1.5) }
  }
  return out
}

function endedGame(idx, daysAgo, profits) {
  const startedAt = new Date(NOW - daysAgo * day - 2 * 3600 * 1000)
  const endedAt = new Date(NOW - daysAgo * day)
  const playersWithProfit = players3.map((p, i) => {
    const profit = profits[i]
    const totalBuyIn = 100 + (i === 0 ? Math.abs(Math.min(0, profit)) : 0)
    return {
      ...p,
      buyInCount: 1 + (i === 0 ? 1 : 0),
      totalBuyIn,
      currentStack: totalBuyIn + profit,
      finalStack: totalBuyIn + profit,
      profit,
      finalProfit: profit,
      share: 0,
      joinedAt: startedAt,
      eliminatedAt: profit <= -100 ? endedAt : null
    }
  })
  return {
    _id: 'game_hist_' + idx,
    hostOpenid: MY_OPENID,
    name: `Demo 牌局 #${idx + 1}`,
    status: 'ended',
    buyIn: 100,
    smallBlind: 10,
    bigBlind: 20,
    blindUpMinutes: 20,
    blindStructure: makeBlindStructure(10, 20),
    currentLevel: 0,
    levelStartedAt: startedAt,
    paused: false,
    pausedAt: null,
    pausedAccumMs: 0,
    startedAt,
    endedAt,
    inviteCode: 'DEMO0' + (idx + 1),
    players: playersWithProfit,
    totalPot: playersWithProfit.reduce((s, p) => s + p.totalBuyIn, 0),
    extraCost: idx === 0 ? 30 : 0,
    aaMode: idx === 0 ? 'winnerByRatio' : 'none',
    shareTotal: 0
  }
}

const historyGames = [
  endedGame(0, 1,  [ 180, -90, -90 ]),
  endedGame(1, 4,  [ -50, 100, -50 ]),
  endedGame(2, 7,  [ 60, -30, -30 ]),
  endedGame(3, 12, [ 120, -60, -60 ]),
  endedGame(4, 18, [ -80, 40, 40 ])
]

// 当前正在进行的牌局
const ongoingGame = {
  _id: 'game_live_demo',
  hostOpenid: MY_OPENID,
  name: '今晚的 Demo 局',
  status: 'ongoing',
  buyIn: 100,
  smallBlind: 10,
  bigBlind: 20,
  blindUpMinutes: 20,
  blindStructure: makeBlindStructure(10, 20),
  currentLevel: 1,
  levelStartedAt: new Date(NOW - 8 * 60 * 1000),  // 8 分钟前
  paused: false,
  pausedAt: null,
  pausedAccumMs: 0,
  startedAt: new Date(NOW - 25 * 60 * 1000),
  endedAt: null,
  inviteCode: 'DEMO99',
  players: [
    { openid: MY_OPENID,    nickname: 'Demo 玩家', avatar: '', buyInCount: 1, totalBuyIn: 100, currentStack: 150, finalStack: null, profit: 0, joinedAt: new Date(NOW - 25 * 60 * 1000), eliminatedAt: null, seat: 3 },
    { openid: 'mock_bob',   nickname: 'Bob',       avatar: '', buyInCount: 2, totalBuyIn: 200, currentStack: 80,  finalStack: null, profit: 0, joinedAt: new Date(NOW - 24 * 60 * 1000), eliminatedAt: null, seat: 5 },
    { openid: 'mock_carol', nickname: 'Carol',     avatar: '', buyInCount: 1, totalBuyIn: 100, currentStack: 70,  finalStack: null, profit: 0, joinedAt: new Date(NOW - 22 * 60 * 1000), eliminatedAt: null, seat: 8 }
  ],
  totalPot: 400
}

// 流水
const transactions = [
  { _id: 'tx_1', gameId: 'game_live_demo', type: 'buyIn', playerOpenid: MY_OPENID,    amount: 100, operatorOpenid: MY_OPENID,    byHost: true,  revoked: false, timestamp: new Date(NOW - 25 * 60 * 1000) },
  { _id: 'tx_2', gameId: 'game_live_demo', type: 'buyIn', playerOpenid: 'mock_bob',   amount: 100, operatorOpenid: 'mock_bob',   byHost: false, revoked: false, timestamp: new Date(NOW - 24 * 60 * 1000) },
  { _id: 'tx_3', gameId: 'game_live_demo', type: 'buyIn', playerOpenid: 'mock_carol', amount: 100, operatorOpenid: 'mock_carol', byHost: false, revoked: false, timestamp: new Date(NOW - 22 * 60 * 1000) },
  { _id: 'tx_4', gameId: 'game_live_demo', type: 'rebuy', playerOpenid: 'mock_bob',   amount: 100, operatorOpenid: 'mock_bob',   byHost: false, revoked: false, timestamp: new Date(NOW - 8 * 60 * 1000) }
]

// 术语词典子集（10 条用于 demo，全量来自 cloudfunctions/seedTerms/seed/terms.json）
const terms = [
  { _id: 'term_1', termEn: 'Texas Hold\'em', termCn: '德州扑克', category: 'rule',     definition: '最流行的扑克变体：每位玩家发两张底牌，与公共牌组合出最佳五张牌型。', example: '今晚我们玩 No-Limit Texas Hold\'em。' },
  { _id: 'term_2', termEn: 'Big Blind',      termCn: '大盲注',   category: 'rule',     definition: '庄家位左侧第二位的强制下注，是基础下注单位。',                   example: 'BB 100 意味着筹码量 100 个大盲。' },
  { _id: 'term_3', termEn: 'Button',         termCn: '庄家位',   category: 'position', definition: '标记本局名义庄家的圆形按钮，最后一个行动，位置最有利。',         example: 'On the button 是最赚钱的位置。' },
  { _id: 'term_4', termEn: 'UTG',            termCn: '枪口位',   category: 'position', definition: 'Under the Gun，大盲左侧第一位，前位中最早行动者。',             example: 'UTG 范围要紧，避免做弱牌。' },
  { _id: 'term_5', termEn: 'Flop',           termCn: '翻牌',     category: 'rule',     definition: '公共牌前三张同时翻开。',                                       example: 'Flop 来了 K-7-2 彩虹。' },
  { _id: 'term_6', termEn: 'Check',          termCn: '过牌',     category: 'action',   definition: '在没有人下注时选择不投筹码并保留行动权。',                       example: '翻牌后我先 check 看对手意图。' },
  { _id: 'term_7', termEn: 'All-in',         termCn: '全下',     category: 'action',   definition: '推入手中所有筹码。',                                            example: 'All-in 没有回头路。' },
  { _id: 'term_8', termEn: 'Pocket Pair',    termCn: '口袋对子', category: 'hand',     definition: '底牌为同点数的对子。',                                          example: 'Pocket Kings = KK。' },
  { _id: 'term_9', termEn: 'Pot Odds',       termCn: '底池赔率', category: 'concept',  definition: '需要跟注金额 ÷ 跟注后底池的比例，用于判断跟注是否盈利。',         example: '需要跟 100 赢 400 → 底池赔率 4:1。' },
  { _id: 'term_10', termEn: 'Bluff',         termCn: '诈唬',     category: 'concept',  definition: '用弱牌持续施压迫使对手弃牌。',                                  example: 'Stone-cold bluff 风险高收益高。' }
]

// 169 起手牌（同 seed/handRanks.json 的生成规则）
function genHandRanks() {
  const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
  function tier(i, j) {
    if (i === j) {
      if (i <= 1) return 'premium'
      if (i <= 3) return 'strong'
      if (i <= 6) return 'playable'
      return 'marginal'
    }
    const hi = Math.min(i, j), lo = Math.max(i, j), suited = i < j
    if (suited) {
      if (hi === 0 && lo <= 4) return 'premium'
      if (hi === 0) return 'strong'
      if (hi === 1 && lo <= 4) return 'strong'
      if (hi === 1 && lo <= 7) return 'playable'
      if (hi === 2 && lo <= 5) return 'playable'
      if (hi === 3 && lo <= 5) return 'playable'
      if (lo - hi === 1 && hi <= 7) return 'playable'
      if (lo - hi === 2 && hi <= 7) return 'marginal'
      return 'trash'
    }
    if (hi === 0 && lo === 1) return 'premium'
    if (hi === 0 && lo <= 3) return 'strong'
    if (hi === 0 && lo === 4) return 'playable'
    if (hi === 0) return 'marginal'
    if (hi === 1 && lo <= 3) return 'strong'
    if (hi === 1 && lo === 4) return 'playable'
    if (hi === 2 && lo === 3) return 'playable'
    if (hi === 1) return 'marginal'
    if (hi === 2 || hi === 3) return 'marginal'
    return 'trash'
  }
  const out = []; let id = 1
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    let hand
    if (i === j) hand = ranks[i] + ranks[j]
    else if (i < j) hand = ranks[i] + ranks[j] + 's'
    else hand = ranks[j] + ranks[i] + 'o'
    out.push({ _id: 'hr_' + id++, hand, tier: tier(i, j), position: 'any', recommendation: '' })
  }
  return out
}

function buildSeed() {
  return {
    MY_OPENID,
    users: [me],
    games: [...historyGames, ongoingGame],
    transactions: transactions.slice(),
    terms: terms.slice(),
    handRanks: genHandRanks()
  }
}

module.exports = { buildSeed, MY_OPENID }
