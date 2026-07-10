// utils/aa.js — 额外费用 AA 分摊
// 输入：
//   players: [{ nickname, openid, profit }]   profit 是结算后的盈亏（赢正/输负）
//   totalCost: number                         总额外费用（口粮/场地/酒水）
//   mode: 'even' | 'winnerByRatio'            人均 AA / 赢家按赢额比例
// 输出：
//   shares: [{ openid, nickname, share }]     share 是该玩家应分摊金额（>=0）
//
// 处理：
//   - even             ：所有人均摊；不能整除时余数从第 1 人补
//   - winnerByRatio    ：仅赢家分摊，按 profit 占总盈利比例
//                       特殊：若没有赢家（理论上不会，因 Σ=0），退化为 even

function aaEven(players, totalCost) {
  if (!players.length || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  const base = Math.floor(totalCost / players.length)
  let remain = totalCost - base * players.length
  const shares = players.map((p, i) => ({
    openid: p.openid,
    nickname: p.nickname,
    share: base + (i < remain ? 1 : 0)
  }))
  return shares
}

function aaWinnerByRatio(players, totalCost) {
  if (!players.length || totalCost <= 0) {
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  }
  const winners = players.filter(p => p.profit > 0)
  if (!winners.length) return aaEven(players, totalCost)
  const totalWin = winners.reduce((s, p) => s + p.profit, 0)
  const shares = players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  let assigned = 0
  // 按比例分配，但用 floor 控制总额不超
  winners.forEach(w => {
    const idx = shares.findIndex(s => s.openid === w.openid)
    const v = Math.floor((w.profit / totalWin) * totalCost)
    shares[idx].share = v
    assigned += v
  })
  // 余数补到赢额最大者
  let remain = totalCost - assigned
  if (remain > 0) {
    const maxWinner = winners.slice().sort((a, b) => b.profit - a.profit)[0]
    const idx = shares.findIndex(s => s.openid === maxWinner.openid)
    shares[idx].share += remain
  }
  return shares
}

// 费用分摊只作为费用单展示，不影响牌局真实水上水下。
function applyShares(players, shares) {
  const map = {}
  shares.forEach(s => {
    map[s.openid] = s.share
  })
  return players.map(p => ({ ...p, share: map[p.openid] || 0, finalProfit: p.profit }))
}

module.exports = { aaEven, aaWinnerByRatio, applyShares }
