function text(key, value) {
  return { key, text: value, emphasis: false }
}

function number(key, value) {
  return { key, text: String(Number(value) || 0), emphasis: true }
}

function transactionDetailParts(tx, hands, accHands) {
  const currentHands = Math.max(0, accHands - hands)
  if (tx.type === 'buyIn') {
    return [
      text('entry-label', '入场 '),
      number('entry-hands', hands),
      text('entry-total-label', ' 手，共 '),
      number('entry-total', accHands),
      text('entry-unit', ' 手')
    ]
  }
  if (tx.type === 'rebuy' || tx.type === 'addOn') {
    if (tx.revoked) {
      return [
        text('revoked-label', '买入 '),
        number('revoked-hands', hands),
        text('revoked-unit', ' 手，未计入当前手数')
      ]
    }
    return [
      text('current-label', '当前 '),
      number('current-hands', currentHands),
      text('buy-label', ' 手，买入 '),
      number('buy-hands', hands),
      text('total-label', ' 手，共 '),
      number('total-hands', accHands),
      text('total-unit', ' 手')
    ]
  }
  if (tx.type === 'settle' || tx.type === 'settlePartial') {
    return [text('stack-label', '剩余积分 '), number('stack-value', tx.amount)]
  }
  if (tx.type === 'eliminate') {
    const removedBuyIn = Number(tx.meta?.removedBuyIn) || Math.abs(Number(tx.amount) || 0)
    if (removedBuyIn <= 0) return [text('remove-only', '移出房间')]
    return [
      text('remove-label', '移出房间，扣除 '),
      number('remove-value', removedBuyIn),
      text('remove-unit', ' 积分')
    ]
  }
  if (!Number(tx.amount)) return []
  return [text('score-label', '积分 '), number('score-value', tx.amount)]
}

function transactionDetailText(tx, hands, accHands) {
  return transactionDetailParts(tx, hands, accHands)
    .map(part => part.text)
    .join('')
}

function transactionHandState(transactions, profiles, buyInValue) {
  const buyIn = Number(buyInValue) || 0
  const runningHands = {}
  ;(profiles || []).forEach(player => {
    const inferred = buyIn > 0 ? Math.round((Number(player.totalBuyIn) || 0) / buyIn) : 0
    runningHands[player.openid] = Math.max(0, Number(player.buyInCount) || 0, inferred)
  })

  const state = {}
  ;(transactions || []).forEach(tx => {
    let hands = 0
    if (tx.type === 'buyIn') hands = Math.max(1, Number(tx.meta?.hands) || 1)
    else if (tx.type === 'rebuy' || tx.type === 'addOn') {
      hands =
        Number(tx.meta?.hands) ||
        (buyIn > 0 ? Math.max(1, Math.round((tx.amount || 0) / buyIn)) : 1)
    }
    state[tx._id] = { hands, accHands: runningHands[tx.playerOpenid] || 0 }
    const countsTowardTotal =
      tx.type === 'buyIn' || ((tx.type === 'rebuy' || tx.type === 'addOn') && !tx.revoked)
    if (countsTowardTotal) {
      runningHands[tx.playerOpenid] = Math.max(0, (runningHands[tx.playerOpenid] || 0) - hands)
    }
  })
  return state
}

function sortTransactions(txs) {
  return (txs || []).slice().sort((a, b) => {
    const ta = +new Date(a.timestamp)
    const tb = +new Date(b.timestamp)
    if (tb !== ta) return tb - ta
    const sa = typeof a.operationSequence === 'number' ? a.operationSequence : -1
    const sb = typeof b.operationSequence === 'number' ? b.operationSequence : -1
    if (sa >= 0 && sb >= 0) return sb - sa
    if (sa >= 0) return -1
    if (sb >= 0) return 1
    return (b._id || '').localeCompare(a._id || '')
  })
}

function mergeTransactions(existing, incoming) {
  const map = new Map()
  ;(existing || []).forEach(tx => map.set(tx._id, tx))
  ;(incoming || []).forEach(tx => map.set(tx._id, tx))
  return sortTransactions([...map.values()])
}

module.exports = {
  transactionDetailParts,
  transactionDetailText,
  transactionHandState,
  sortTransactions,
  mergeTransactions
}
