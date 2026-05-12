// pages/learn-hand-chart/learn-hand-chart.js — 起手牌表（13×13）
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

Page({
  data: { matrix: [], legend: [
    { tier: 'premium',  label: '顶级' },
    { tier: 'strong',   label: '强' },
    { tier: 'playable', label: '可玩' },
    { tier: 'marginal', label: '边缘' },
    { tier: 'trash',    label: '弃' }
  ], loading: true, picked: null },

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
      all.forEach(r => { map[r.hand] = r })
      const matrix = []
      for (let i = 0; i < 13; i++) {
        const row = []
        for (let j = 0; j < 13; j++) {
          let hand
          if (i === j) hand = RANKS[i] + RANKS[j]
          else if (i < j) hand = RANKS[i] + RANKS[j] + 's'
          else hand = RANKS[j] + RANKS[i] + 'o'
          row.push(map[hand] || { hand, tier: 'trash' })
        }
        matrix.push(row)
      }
      this.setData({ matrix, loading: false })
    } catch (err) {
      console.error(err)
      this.setData({ loading: false })
    }
  },

  onCellTap(e) {
    const { ri, ci } = e.currentTarget.dataset
    const cell = this.data.matrix[ri][ci]
    this.setData({ picked: cell })
  },

  onClosePicked() { this.setData({ picked: null }) }
})
