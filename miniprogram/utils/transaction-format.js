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
  // 费用留痕必须先于形状推断：它也带 beforeValue/afterValue，
  // 落入下方推断会被误判成结算修正（曾显示"结算从0改为561"）
  if (type === 'expense' || mode === 'expense') return 'expense'

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

const EXPENSE_MODE_TEXT = {
  all: '全员平均',
  winner: '水上比例',
  winnerEven: '水上平均',
  mvp: 'MVP买单'
}

// 语义块之间用 CSS margin 分隔，不写真实空格；数字与单位同处一块不断行。
// 每块独立成 inline-block，块间统一一个极轻的语义间距，让关键语义读起来更顺。
// 逗号本身已起分隔作用：块尾是逗号、或下一块以逗号开头时不再加间距。
// role 决定颜色/字重：operator(操作人) player(目标玩家) action(动词/连接词)
//   result(数值：手数/积分) dim(修改前的旧值，弱化)
function buildTransactionSentence(tx, hands, accHands, resolveName) {
  const resolve = typeof resolveName === 'function' ? resolveName : () => ''
  const player = resolve(tx.playerOpenid) || tx.meta?.nickname || '某玩家'
  const operator = tx.operatorOpenid
    ? resolve(tx.operatorOpenid) || tx.operatorNicknameSnapshot || ''
    : ''
  const isProxy = tx.operatorOpenid && tx.operatorOpenid !== tx.playerOpenid && operator
  const kind = normalizeTransactionKind(tx)

  // 收集语义块，最后统一编 key（wx:key 需唯一）并按标点决定是否留间距
  const parts = []
  const seg = (role, text) => {
    if (text || text === 0) parts.push({ role, text: `${text}` })
  }
  const withKeys = () =>
    parts.map((p, i) => {
      const next = parts[i + 1]
      const endsPunct = /[，、。]$/.test(p.text)
      const nextStartsPunct = next && /^[，、。]/.test(next.text)
      return {
        key: String(i),
        role: p.role,
        text: p.text,
        gap: !!next && !endsPunct && !nextStartsPunct
      }
    })

  if (kind === 'buyIn') {
    const finalHands = hasBeforeAfter(tx.beforeHands, tx.afterHands) ? tx.afterHands : accHands
    if (isProxy) seg('operator', `${operator}帮`)
    seg('player', player)
    seg('action', '入场')
    seg('result', `${finalHands}手`)
    return withKeys()
  }

  if (kind === 'rebuy' || kind === 'addOn') {
    // 总手数：优先权威 afterHands，其次用完整流水反推的 accHands；都不可靠才省略
    const totalAfter = hasBeforeAfter(tx.beforeHands, tx.afterHands)
      ? tx.afterHands
      : accHands || null
    if (tx.revoked && operator) seg('operator', `${operator}撤销`)
    else if (isProxy) seg('operator', `${operator}帮`)
    seg('player', player)
    seg('action', '补买')
    if (totalAfter) {
      seg('result', `${hands}手，`)
      seg('action', '共')
      seg('result', `${totalAfter}手`)
    } else {
      seg('result', `${hands}手`)
    }
    return withKeys()
  }

  if (kind === 'settle') {
    // 修改结算：只突出修改后的值，修改前值弱化
    if (hasBeforeAfter(tx.beforeValue, tx.afterValue)) {
      if (isProxy) seg('operator', `${operator}将`)
      seg('player', player)
      seg('action', '结算从')
      seg('dim', `${tx.beforeValue}`)
      seg('action', '改为')
      seg('result', `${tx.afterValue}`)
      return withKeys()
    }
    const totalHands = accHands || 0
    if (isProxy) seg('operator', `${operator}帮`)
    seg('player', player)
    if (totalHands) {
      seg('action', '结算，')
      seg('action', '共')
      seg('result', `${totalHands}手，`)
    } else {
      seg('action', '结算')
    }
    seg('action', '剩')
    seg('result', `${tx.amount}积分`)
    return withKeys()
  }

  if (kind === 'expense') {
    // 留痕的增量信息是「谁、何时、改成了什么」；金额与方式保留（历史演变可追溯），
    // 与费用块重复的合规注释（不计积分）不再重复出现。playerOpenid 即执行人。
    const modeLabel = EXPENSE_MODE_TEXT[tx.meta?.expenseMode] || ''
    const before = Number(tx.beforeValue)
    const after = hasBeforeAfter(tx.beforeValue, tx.afterValue) ? tx.afterValue : tx.amount
    seg('player', player)
    if (hasBeforeAfter(tx.beforeValue, tx.afterValue) && before > 0 && Number(after) !== before) {
      seg('action', '把费用分摊从')
      seg('dim', `${tx.beforeValue}`)
      seg('action', '改为')
      seg('result', modeLabel ? `${after}，` : `${after}`)
    } else {
      seg('action', '设置费用分摊')
      seg('result', modeLabel ? `${after}，` : `${after}`)
    }
    if (modeLabel) seg('dim', modeLabel)
    return withKeys()
  }

  if (kind === 'eliminate') {
    const removedBuyIn = Number(tx.meta?.removedBuyIn) || Math.abs(Number(tx.amount) || 0)
    if (operator) seg('operator', `${operator}移出`)
    else seg('action', '移出')
    seg('player', player)
    seg('action', '，扣')
    seg('result', `${removedBuyIn}积分`)
    return withKeys()
  }

  // 兜底：不返回孤立"记录"，尽量保留可读信息，同时记录未知类型便于补齐兼容
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[tx-format] unknown kind', tx.type, tx.meta?.mode, tx._id)
  }
  const amount = Number(tx.amount)
  seg('player', player)
  if (Number.isFinite(amount) && amount !== 0) {
    seg('action', '记录')
    seg('result', `${Math.abs(amount)}积分`)
  } else {
    seg('action', '有一条历史流水')
  }
  return withKeys()
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
