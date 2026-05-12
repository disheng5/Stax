// utils/settle.js — 清算贪心算法（最少转账次数）
// 输入：players = [{ nickname, profit }]，profit 正数为赢、负数为输
// 输出：transfers = [{ from, to, amount }]
function settle(players) {
  const debtors = players
    .filter(p => p.profit < 0)
    .map(p => ({ nickname: p.nickname, profit: -p.profit }))
  const creditors = players.filter(p => p.profit > 0).map(p => ({ ...p }))
  debtors.sort((a, b) => b.profit - a.profit)
  creditors.sort((a, b) => b.profit - a.profit)

  const transfers = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].profit, creditors[j].profit)
    transfers.push({ from: debtors[i].nickname, to: creditors[j].nickname, amount })
    debtors[i].profit -= amount
    creditors[j].profit -= amount
    if (debtors[i].profit === 0) i++
    if (creditors[j].profit === 0) j++
  }
  return transfers
}

module.exports = { settle }
