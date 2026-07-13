function hasBeforeAfter(before, after) {
  return before !== null && before !== undefined && after !== null && after !== undefined
}

function buildTransactionSentence(tx, hands, accHands, resolveName) {
  const resolve = typeof resolveName === 'function' ? resolveName : () => ''
  const player = resolve(tx.playerOpenid) || tx.meta?.nickname || '某玩家'
  const operator = tx.operatorOpenid
    ? resolve(tx.operatorOpenid) || tx.operatorNicknameSnapshot || ''
    : ''
  const isProxy = tx.operatorOpenid && tx.operatorOpenid !== tx.playerOpenid && operator

  if (tx.type === 'buyIn') {
    const finalHands = hasBeforeAfter(tx.beforeHands, tx.afterHands) ? tx.afterHands : accHands
    if (isProxy) {
      return [
        { key: 'op', text: operator, role: 'operator' },
        { key: 'v1', text: '帮', role: 'text' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'v2', text: '入场，买入', role: 'text' },
        { key: 'r1', text: `${finalHands}手`, role: 'result' }
      ]
    }
    return [
      { key: 'pl', text: player, role: 'player' },
      { key: 'v1', text: '入场，买入', role: 'text' },
      { key: 'r1', text: `${finalHands}手`, role: 'result' }
    ]
  }

  if (tx.type === 'rebuy' || tx.type === 'addOn') {
    if (tx.revoked) {
      const remaining = hasBeforeAfter(tx.beforeHands, tx.afterHands) ? tx.afterHands : null
      const parts = [
        { key: 'op', text: operator || player, role: operator ? 'operator' : 'player' },
        { key: 'v1', text: '撤销', role: 'text' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'v2', text: '的', role: 'text' },
        { key: 'r1', text: `${hands}手`, role: 'result' },
        { key: 'v3', text: '补买', role: 'text' }
      ]
      if (remaining !== null) {
        parts.push(
          { key: 'v4', text: '，共', role: 'text' },
          { key: 'r2', text: `${remaining}手`, role: 'result' }
        )
      }
      return parts
    }
    const totalAfter = hasBeforeAfter(tx.beforeHands, tx.afterHands) ? tx.afterHands : null
    if (isProxy) {
      const parts = [
        { key: 'op', text: operator, role: 'operator' },
        { key: 'v1', text: '帮', role: 'text' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'v2', text: '补买', role: 'text' },
        { key: 'r1', text: `${hands}手`, role: 'result' }
      ]
      if (totalAfter !== null) {
        parts.push(
          { key: 'v3', text: '，共', role: 'text' },
          { key: 'r2', text: `${totalAfter}手`, role: 'result' }
        )
      }
      return parts
    }
    const parts = [
      { key: 'pl', text: player, role: 'player' },
      { key: 'v1', text: '补买', role: 'text' },
      { key: 'r1', text: `${hands}手`, role: 'result' }
    ]
    if (totalAfter !== null) {
      parts.push(
        { key: 'v2', text: '，共', role: 'text' },
        { key: 'r2', text: `${totalAfter}手`, role: 'result' }
      )
    }
    return parts
  }

  if (tx.type === 'settle' || tx.type === 'settlePartial') {
    if (hasBeforeAfter(tx.beforeValue, tx.afterValue)) {
      return [
        { key: 'op', text: operator || player, role: operator ? 'operator' : 'player' },
        { key: 'v1', text: '将', role: 'text' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'v2', text: '的结算积分从', role: 'text' },
        { key: 'r1', text: `${tx.beforeValue}`, role: 'result' },
        { key: 'v3', text: '调整为', role: 'text' },
        { key: 'r2', text: `${tx.afterValue}`, role: 'result' }
      ]
    }
    const totalHands = accHands || 0
    const amount = tx.amount
    if (isProxy) {
      return [
        { key: 'op', text: operator, role: 'operator' },
        { key: 'v1', text: '帮', role: 'text' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'v2', text: '结算，共买入', role: 'text' },
        { key: 'r1', text: `${totalHands}手`, role: 'result' },
        { key: 'v3', text: '，剩余', role: 'text' },
        { key: 'r2', text: `${amount}积分`, role: 'result' }
      ]
    }
    return [
      { key: 'pl', text: player, role: 'player' },
      { key: 'v1', text: '结算，共买入', role: 'text' },
      { key: 'r1', text: `${totalHands}手`, role: 'result' },
      { key: 'v2', text: '，剩余', role: 'text' },
      { key: 'r2', text: `${amount}积分`, role: 'result' }
    ]
  }

  if (tx.type === 'eliminate') {
    const removedBuyIn = Number(tx.meta?.removedBuyIn) || Math.abs(Number(tx.amount) || 0)
    return [
      { key: 'op', text: operator || player, role: operator ? 'operator' : 'player' },
      { key: 'v1', text: '将', role: 'text' },
      { key: 'pl', text: player, role: 'player' },
      { key: 'v2', text: '移出记录，扣除', role: 'text' },
      { key: 'r1', text: `${removedBuyIn}积分`, role: 'result' }
    ]
  }

  return [{ key: 'fallback', text: '记录', role: 'text' }]
}

function transactionSentenceText(tx, hands, accHands, resolveName) {
  return buildTransactionSentence(tx, hands, accHands, resolveName)
    .map(p => p.text)
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
  buildTransactionSentence,
  transactionSentenceText,
  transactionHandState,
  sortTransactions,
  mergeTransactions
}
