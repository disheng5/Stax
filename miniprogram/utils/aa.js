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

// 水上平均：仅赢家均摊；无赢家退化为全员均摊
function aaWinnerEven(players, totalCost) {
  if (!players.length || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  const winners = players.filter(p => p.profit > 0)
  if (!winners.length) return aaEven(players, totalCost)
  const winnerShares = aaEven(winners, totalCost)
  const map = {}
  winnerShares.forEach(s => {
    map[s.openid] = s.share
  })
  return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: map[p.openid] || 0 }))
}

// MVP 买单：赢最多的一人承担全部费用；无赢家退化为全员均摊
function aaMvp(players, totalCost) {
  if (!players.length || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  const winners = players.filter(p => p.profit > 0)
  if (!winners.length) return aaEven(players, totalCost)
  const mvp = winners.slice().sort((a, b) => b.profit - a.profit)[0]
  return players.map(p => ({
    openid: p.openid,
    nickname: p.nickname,
    share: p.openid === mvp.openid ? totalCost : 0
  }))
}

// 统一入口：按分摊方式计算费用单
// mode: 'all'(全员平均) | 'winner'(水上比例) | 'winnerEven'(水上平均) | 'mvp'(MVP买单)
function computeShares(players, totalCost, mode) {
  if (!totalCost || totalCost <= 0)
    return players.map(p => ({ openid: p.openid, nickname: p.nickname, share: 0 }))
  if (mode === 'winner') return aaWinnerByRatio(players, totalCost)
  if (mode === 'winnerEven') return aaWinnerEven(players, totalCost)
  if (mode === 'mvp') return aaMvp(players, totalCost)
  return aaEven(players, totalCost)
}

// 费用分摊只作为费用单展示，不影响牌局真实水上水下。
function applyShares(players, shares) {
  const map = {}
  shares.forEach(s => {
    map[s.openid] = s.share
  })
  return players.map(p => ({ ...p, share: map[p.openid] || 0, finalProfit: p.profit }))
}

module.exports = { aaEven, aaWinnerByRatio, aaWinnerEven, aaMvp, computeShares, applyShares }
