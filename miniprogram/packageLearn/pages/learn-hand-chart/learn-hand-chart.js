// pages/learn-hand-chart/learn-hand-chart.js — 起手牌表（13×13）支持位置+人数动态
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

const HAND_SCORES = {}
;(function buildScores() {
  const top = ['AA', 'KK', 'QQ', 'JJ'] // 只有这4手是真正的"夯"
  const strong = ['AKs', 'TT', '99', 'AQs', 'AJs', 'KQs', 'AKo', 'ATs', 'KJs', 'QJs']
  const playable = [
    '88',
    '77',
    '66',
    'A9s',
    'A8s',
    'A7s',
    'A6s',
    'A5s',
    'A4s',
    'A3s',
    'A2s',
    'KTs',
    'K9s',
    'QTs',
    'Q9s',
    'JTs',
    'J9s',
    'T9s',
    'T8s',
    '98s',
    '97s',
    '87s',
    '86s',
    '76s',
    '75s',
    '65s',
    '54s',
    'AQo',
    'AJo',
    'ATo',
    'KQo',
    'KJo',
    'QJo',
    'JTo'
  ]
  const marginal = [
    '55',
    '44',
    '33',
    '22',
    'K8s',
    'K7s',
    'K6s',
    'K5s',
    'K4s',
    'K3s',
    'K2s',
    'Q8s',
    'Q7s',
    'Q6s',
    'J8s',
    'J7s',
    'T7s',
    'T6s',
    '96s',
    '95s',
    '85s',
    '84s',
    '74s',
    '64s',
    '53s',
    '43s',
    'A9o',
    'A8o',
    'A7o',
    'A6o',
    'A5o',
    'A4o',
    'A3o',
    'A2o',
    'KTo',
    'K9o',
    'QTo',
    'Q9o',
    'J9o',
    'T9o',
    '98o',
    '87o',
    '76o',
    '65o'
  ]
  top.forEach(h => {
    HAND_SCORES[h] = 5
  })
  strong.forEach(h => {
    HAND_SCORES[h] = 4
  })
  playable.forEach(h => {
    HAND_SCORES[h] = 3
  })
  marginal.forEach(h => {
    HAND_SCORES[h] = 2
  })
})()

const POSITIONS_BY_COUNT = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['UTG', 'BTN', 'SB', 'BB'],
  5: ['UTG', 'CO', 'BTN', 'SB', 'BB'],
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  7: ['UTG', 'UTG+1', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO', 'BTN', 'SB', 'BB']
}

const POS_THRESHOLD = {
  UTG: 4,
  'UTG+1': 4,
  MP: 3.5,
  'MP+1': 3.5,
  HJ: 3,
  CO: 2.5,
  BTN: 2,
  SB: 2.5,
  BB: 1.5
}

const TIER_META = {
  premium: { label: '夯', advice: '无脑冲，加注别手软，对面看了都想跑。' },
  strong: { label: '顶级', advice: '很强，正常加注打价值，稳稳拿下。' },
  playable: { label: '人上人', advice: '位置好就打，位置差就忍，灵活点。' },
  marginal: { label: 'NPC', advice: '平平无奇，随缘进场，别上头。' },
  trash: { label: '拉完了', advice: '纯送钱，折了吧，留着积分下把再战。' }
}

function getTier(hand, position, playerCount) {
  const score = HAND_SCORES[hand] || 1
  if (score === 1) return 'trash' // 未收录手牌（72o 等）一律弃牌
  const threshold = POS_THRESHOLD[position] || 2
  const countAdj = (playerCount - 6) * 0.2
  const adjThreshold = threshold + countAdj
  if (score >= 5) return 'premium'
  if (score >= Math.max(adjThreshold + 0.5, 4)) return 'strong'
  if (score >= adjThreshold && score >= 3) return 'playable' // score=2 手牌不能升到playable
  if (score >= Math.max(adjThreshold - 1, 2)) return 'marginal'
  return 'trash'
}

Page({
  data: {
    matrix: [],
    legend: [
      { tier: 'premium', label: '夯' },
      { tier: 'strong', label: '顶级' },
      { tier: 'playable', label: '人上人' },
      { tier: 'marginal', label: 'NPC' },
      { tier: 'trash', label: '拉完了' }
    ],
    loading: true,
    picked: null,
    playerCount: 6,
    position: 'BTN',
    positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    playerCounts: [2, 3, 4, 5, 6, 7, 8, 9],
    cloudData: {}
  },

  async onShow() {
    try {
      const db = wx.cloud.database()
      const all = []
      for (let skip = 0; skip < 200; skip += 20) {
        const res = await db.collection('handRanks').skip(skip).limit(20).get()
        all.push(...res.data)
        if (res.data.length < 20) break
      }
      const map = {}
      all.forEach(r => {
        map[r.hand] = r
      })
      this.setData({ cloudData: map, loading: false })
      this._buildMatrix()
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
      this._buildMatrix()
    }
  },

  onPlayerCountChange(e) {
    const playerCount = Number(e.currentTarget.dataset.n)
    const positions = POSITIONS_BY_COUNT[playerCount] || POSITIONS_BY_COUNT[6]
    let position = this.data.position
    if (!positions.includes(position)) position = 'BTN'
    this.setData({ playerCount, positions, position })
    this._buildMatrix()
  },

  onPositionChange(e) {
    this.setData({ position: e.currentTarget.dataset.pos })
    this._buildMatrix()
  },

  _buildMatrix() {
    const { cloudData, position, playerCount } = this.data
    const matrix = []
    for (let i = 0; i < 13; i++) {
      const row = []
      for (let j = 0; j < 13; j++) {
        let hand
        if (i === j) hand = RANKS[i] + RANKS[j]
        else if (i < j) hand = RANKS[i] + RANKS[j] + 's'
        else hand = RANKS[j] + RANKS[i] + 'o'
        const tier = getTier(hand, position, playerCount)
        const meta = TIER_META[tier]
        const cloud = cloudData[hand] || {}
        row.push({
          hand,
          tier,
          tierLabel: meta.label,
          advice: cloud.recommendation || meta.advice
        })
      }
      matrix.push(row)
    }
    this.setData({ matrix })
  },

  onCellTap(e) {
    const { ri, ci } = e.currentTarget.dataset
    const cell = this.data.matrix[ri][ci]
    this.setData({ picked: cell })
  },

  onClosePicked() {
    this.setData({ picked: null })
  }
})
