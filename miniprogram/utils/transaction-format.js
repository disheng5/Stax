function hasBeforeAfter(before, after) {
  return before !== null && before !== undefined && after !== null && after !== undefined
}

// 兼容归一层：既参考 type，也参考载荷形状（未知枚举按载荷推断，符合契约）。
// 修复历史二次结算/checkout/finalize 落入兜底被显示成"记录"的问题。
function normalizeTransactionKind(tx) {
  const type = String(tx.type || '').toLowerCase()
  const mode = String(tx.meta?.mode || '').toLowerCase()

  if (type === 'buyin') return 'buyIn'
  if (type === 'rebuy' || type === 'addon') return tx.type === 'addOn' ? 'addOn' : 'rebuy'
  if (type === 'eliminate') return 'eliminate'
  if (type === 'settle' || type === 'settlepartial') return 'settle'

  // 载荷形状推断：带结算/收局语义，或带结算前后值 → 归一为结算
  if (
    /settle|checkout|final/.test(type) ||
    ['checkout', 'finalize'].includes(mode) ||
    hasBeforeAfter(tx.beforeValue, tx.afterValue)
  ) {
    return 'settle'
  }
  return type
}

// 语义块之间用 CSS margin 分隔，不写真实空格。role 决定颜色/字重与间距：
// operator(操作人) player(目标玩家) action(动作) result(最终结果) dim(修改前值)
function buildTransactionSentence(tx, hands, accHands, resolveName) {
  const resolve = typeof resolveName === 'function' ? resolveName : () => ''
  const player = resolve(tx.playerOpenid) || tx.meta?.nickname || '某玩家'
  const operator = tx.operatorOpenid
    ? resolve(tx.operatorOpenid) || tx.operatorNicknameSnapshot || ''
    : ''
  const isProxy = tx.operatorOpenid && tx.operatorOpenid !== tx.playerOpenid && operator
  const kind = normalizeTransactionKind(tx)

  if (kind === 'buyIn') {
    const finalHands = hasBeforeAfter(tx.beforeHands, tx.afterHands) ? tx.afterHands : accHands
    if (isProxy) {
      return [
        { key: 'op', text: `${operator}帮`, role: 'operator' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'a1', text: `入场${finalHands}手`, role: 'action' }
      ]
    }
    return [
      { key: 'pl', text: player, role: 'player' },
      { key: 'a1', text: `入场${finalHands}手`, role: 'action' }
    ]
  }

  if (kind === 'rebuy' || kind === 'addOn') {
    // 总手数：优先权威 afterHands，其次用完整流水反推的 accHands；都不可靠才省略
    const totalAfter = hasBeforeAfter(tx.beforeHands, tx.afterHands)
      ? tx.afterHands
      : accHands || null
    if (tx.revoked) {
      const parts = [
        { key: 'op', text: operator ? `${operator}撤销` : player, role: 'operator' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'a1', text: `补买${hands}手，`, role: 'action' }
      ]
      if (totalAfter) parts.push({ key: 'r2', text: `共${totalAfter}手`, role: 'result' })
      return parts
    }
    if (isProxy) {
      const parts = [
        { key: 'op', text: `${operator}帮`, role: 'operator' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'a1', text: `补买${hands}手，`, role: 'action' }
      ]
      if (totalAfter) parts.push({ key: 'r2', text: `共${totalAfter}手`, role: 'result' })
      return parts
    }
    const parts = [
      { key: 'pl', text: player, role: 'player' },
      { key: 'a1', text: `补买${hands}手，`, role: 'action' }
    ]
    if (totalAfter) parts.push({ key: 'r2', text: `共${totalAfter}手`, role: 'result' })
    return parts
  }

  if (kind === 'settle') {
    // 修改结算：只突出修改后的值，修改前值弱化
    if (hasBeforeAfter(tx.beforeValue, tx.afterValue)) {
      return [
        { key: 'op', text: operator ? `${operator}将` : player, role: 'operator' },
        { key: 'pl', text: player, role: 'player' },
        { key: 'a1', text: '结算从', role: 'action' },
        { key: 'r1', text: `${tx.beforeValue}`, role: 'dim' },
        { key: 'a2', text: '改为', role: 'action' },
        { key: 'r2', text: `${tx.afterValue}`, role: 'result' }
      ]
    }
    const totalHands = accHands || 0
    const amount = tx.amount
    const resultPart = { key: 'r2', text: `剩${amount}积分`, role: 'result' }
    if (isProxy) {
      const parts = [
        { key: 'op', text: `${operator}帮`, role: 'operator' },
        { key: 'pl', text: player, role: 'player' }
      ]
      if (totalHands) {
        parts.push({ key: 'a1', text: '结算，', role: 'action' })
        parts.push({ key: 'r1', text: `共${totalHands}手，`, role: 'result' })
      } else {
        parts.push({ key: 'a1', text: '结算，', role: 'action' })
      }
      parts.push(resultPart)
      return parts
    }
    const parts = [{ key: 'pl', text: player, role: 'player' }]
    parts.push({ key: 'a1', text: '结算，', role: 'action' })
    if (totalHands) parts.push({ key: 'r1', text: `共${totalHands}手，`, role: 'result' })
    parts.push(resultPart)
    return parts
  }

  if (kind === 'eliminate') {
    const removedBuyIn = Number(tx.meta?.removedBuyIn) || Math.abs(Number(tx.amount) || 0)
    return [
      { key: 'op', text: operator ? `${operator}移出` : '移出', role: 'operator' },
      { key: 'pl', text: player, role: 'player' },
      { key: 'a1', text: `，扣${removedBuyIn}积分`, role: 'action' }
    ]
  }

  // 兜底：不返回孤立"记录"，尽量保留可读信息，同时记录未知类型便于补齐兼容
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[tx-format] unknown kind', tx.type, tx.meta?.mode, tx._id)
  }
  const amount = Number(tx.amount)
  if (Number.isFinite(amount) && amount !== 0) {
    return [
      { key: 'pl', text: player, role: 'player' },
      { key: 'a1', text: `记录${Math.abs(amount)}积分`, role: 'action' }
    ]
  }
  return [
    { key: 'pl', text: player, role: 'player' },
    { key: 'a1', text: '有一条历史流水', role: 'action' }
  ]
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
  normalizeTransactionKind,
  transactionHandState,
  sortTransactions,
  mergeTransactions
}
