function text(key, value) {
  return { key, text: value, emphasis: false }
}

// 最终值（最终手数/最终积分）：最重字重
function strong(key, value) {
  return { key, text: String(value), emphasis: true, weight: 'strong' }
}

// 本次变化量（如 +3手 / -1手）：中等字重
function delta(key, value) {
  return { key, text: value, emphasis: true, weight: 'delta' }
}

// 变化前数字、箭头、单位：正常字重 + 次要颜色
function dim(key, value) {
  return { key, text: value, emphasis: false, dim: true }
}

// 操作人后缀（由 X 代记 / 由 X 撤销）：次要颜色，附加在行尾
function operatorPart(prefix, nickname) {
  return {
    key: 'operator',
    text: `${prefix} ${nickname}`,
    emphasis: false,
    dim: true,
    operator: true
  }
}

// 是否有可信的前后值（缺失不猜测）
function hasBeforeAfter(before, after) {
  return before !== null && before !== undefined && after !== null && after !== undefined
}

// 按 Section 二 权威格式构建流水明细（不含最前面的玩家昵称，由页面单独渲染）。
// 旧流水缺少 before/after/operationSequence 等新字段时按旧格式降级，不猜测。
function transactionDetailParts(tx, hands, accHands) {
  const currentHands = Math.max(0, accHands - hands)

  if (tx.type === 'buyIn') {
    // 入场 2手
    const finalHands = hasBeforeAfter(tx.beforeHands, tx.afterHands) ? tx.afterHands : accHands
    return [strong('entry-hands', finalHands), text('entry-unit', '手')]
  }

  if (tx.type === 'rebuy' || tx.type === 'addOn') {
    if (tx.revoked) {
      // 撤销买入 -1手 · 6→5手 · 由 X 撤销
      const parts = [delta('rv-delta', `-${hands}手`)]
      if (hasBeforeAfter(tx.beforeHands, tx.afterHands)) {
        parts.push(
          text('rv-sep', ' · '),
          dim('rv-before', String(tx.beforeHands)),
          dim('rv-arrow', '→'),
          strong('rv-after', String(tx.afterHands)),
          dim('rv-unit', '手')
        )
      } else {
        parts.push(text('rv-note', ' · 未计入当前手数'))
      }
      return parts
    }
    // 买入 +3手 · 2→5手
    const parts = [delta('buy-delta', `+${hands}手`)]
    if (hasBeforeAfter(tx.beforeHands, tx.afterHands)) {
      parts.push(
        text('buy-sep', ' · '),
        dim('buy-before', String(tx.beforeHands)),
        dim('buy-arrow', '→'),
        strong('buy-after', String(tx.afterHands)),
        dim('buy-unit', '手')
      )
    } else {
      // 旧记录缺前后值：沿用可读的累计口径
      parts.push(
        text('buy-sep', ' · '),
        dim('buy-before', String(currentHands)),
        dim('buy-arrow', '→'),
        strong('buy-after', String(accHands)),
        dim('buy-unit', '手')
      )
    }
    return parts
  }

  if (tx.type === 'settle' || tx.type === 'settlePartial') {
    // 修改：580→550   /   结算：580
    if (hasBeforeAfter(tx.beforeValue, tx.afterValue)) {
      return [
        dim('settle-before', String(tx.beforeValue)),
        dim('settle-arrow', '→'),
        strong('settle-after', String(tx.afterValue))
      ]
    }
    return [strong('settle-value', String(tx.amount))]
  }

  if (tx.type === 'eliminate') {
    const removedBuyIn = Number(tx.meta?.removedBuyIn) || Math.abs(Number(tx.amount) || 0)
    if (removedBuyIn <= 0) return [text('remove-only', '移出房间')]
    return [
      text('remove-label', '移出房间，扣除 '),
      strong('remove-value', String(removedBuyIn)),
      text('remove-unit', ' 积分')
    ]
  }

  if (!Number(tx.amount)) return []
  return [text('score-label', '积分 '), strong('score-value', String(tx.amount))]
}

// 操作人后缀：本人操作不显示；代操作/撤销显示"由 X 代记/撤销"。
// 展示优先用最新资料（nameMap 传入），回退到快照昵称。
function operatorSuffixPart(tx, resolveName) {
  if (!tx.operatorOpenid || tx.operatorOpenid === tx.playerOpenid) return null
  const nickname =
    (typeof resolveName === 'function' && resolveName(tx.operatorOpenid)) ||
    tx.operatorNicknameSnapshot ||
    ''
  if (!nickname) return null
  const verb = tx.type === 'rebuy' || tx.type === 'addOn' ? (tx.revoked ? '撤销' : '代记') : '代记'
  return operatorPart('由', `${nickname} ${verb}`.trim())
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

// 按流水类型与前后值推断展示标签（Section 二）：
// buyIn→入场; rebuy/addOn→买入(撤销时→撤销买入); settle 有前后值→修正,否则→结算; eliminate→移出
function transactionTypeLabel(tx) {
  if (!tx) return '记录'
  if (tx.type === 'buyIn') return '入场'
  if (tx.type === 'rebuy' || tx.type === 'addOn') return tx.revoked ? '撤销买入' : '买入'
  if (tx.type === 'settle' || tx.type === 'settlePartial') {
    return hasBeforeAfter(tx.beforeValue, tx.afterValue) ? '修正' : '结算'
  }
  if (tx.type === 'eliminate') return '移出'
  return '记录'
}

module.exports = {
  transactionDetailParts,
  transactionDetailText,
  transactionHandState,
  transactionTypeLabel,
  operatorSuffixPart,
  sortTransactions,
  mergeTransactions
}
