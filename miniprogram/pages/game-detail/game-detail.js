// pages/game-detail/game-detail.js — 牌局详情（核心页）
const app = getApp()
const { settle } = require('../../utils/settle.js')
const { computeShares } = require('../../utils/aa.js')
const {
  invalidateGamesCache,
  markGamesChanged,
  cacheGame,
  removeCachedGame
} = require('../../utils/game-data.js')
const avatarCache = require('../../utils/avatar.js')
const { isMeaningfulNickname, readLocalProfile } = require('../../utils/user.js')
const { createOperationId } = require('../../utils/operation.js')
const {
  buildTransactionSentence,
  transactionHandState,
  sortTransactions,
  mergeTransactions,
  expandRevocations
} = require('../../utils/transaction-format.js')
const SUNZI = require('../../utils/sunzi.js')
const { createPendingQueue, isReplayable } = require('../../utils/pending-ops.js')
const { txSignature, getCompleteGame, fetchCompleteGame, rememberCompleteGame, removeCompleteGame } = require('../../utils/game-view.js')
const { batchRender, changedPatch } = require('../../utils/render.js')
const { observe } = require('../../utils/live-view.js')

function normalizeExpenseMode(value) {
  if (['winner', 'winnerRatio', 'winnerByRatio'].includes(value)) return 'winner'
  if (['winnerEven', 'winnersEven'].includes(value)) return 'winnerEven'
  if (value === 'mvp') return 'mvp'
  if (['all', 'even'].includes(value)) return 'all'
  // 与云函数一致：未知取值回退产品默认「水上比例」
  return 'winner'
}

const EXPENSE_MODE_LABELS = {
  all: '全员平均',
  winner: '水上比例',
  winnerEven: '水上平均',
  mvp: 'MVP买单'
}
const EXPENSE_MODE_OPTIONS = ['all', 'winner', 'winnerEven', 'mvp']

// 结束后 3 小时内仍可修改结算积分（与云函数一致）
const EDIT_WINDOW_MS = 3 * 60 * 60 * 1000
function canEditSettle(game) {
  if (!game) return false
  if (game.status === 'ongoing') return true
  if (game.status !== 'ended' || !game.endedAt) return false
  const endedAt = +new Date(game.endedAt)
  return Number.isFinite(endedAt) && Date.now() - endedAt <= EDIT_WINDOW_MS
}

Page({
  data: {
    gameId: '',
    inviteCode: '',
    game: null,
    isHost: false,
    myOpenid: '',
    loading: true,
    notFound: false,
    loadError: false,
    recentTx: [],
    viewerMode: false,
    isPlayer: false,
    joining: false,
    handsPicker: { show: false, title: '', openid: '', type: '', hands: 1 },
    allCheckedOut: false,
    settleDiff: 0,
    aboveTotal: 0,
    belowTotal: 0,
    expensePanel: { show: false, extraCost: '', expenseMode: 'winner', submitting: false },
    expenseModeLabels: EXPENSE_MODE_LABELS,
    expenseModeOptions: EXPENSE_MODE_OPTIONS,
    settleResult: null,
    settleWinnerOpenid: '',
    pendingCount: 0,
    legacyPendingCount: 0
  },

  async onLoad(options) {
    const gameId = options.id || ''
    this.setData({
      gameId,
      inviteCode: (options.code || '').toUpperCase(),
      viewerMode: options.mode === 'viewer'
    })
    if (!gameId) {
      this.setData({ loading: false, notFound: true })
      return
    }
    const cached = getCompleteGame(gameId)
    if (cached) this._applyCompleteGame(cached)
    // 刚由创建/加入响应写入的快照可直接消费；普通历史快照仍并行校验，避免陈旧数据。
    this._watchDelivered = false
    if (!cached || Date.now() - cached.ts > 2000) this._fetchGameOnce()
    this._startWatch()
    await this._ensureOpenid()
    this._recomputeIdentity()
  },

  onShow() {
    this._hidden = false
    if (!this.watcher && this.data.gameId) {
      this._watchRetries = 0
      this._startWatch()
    }
    this._recomputeIdentity()
    this._flushPending()
    if (this.data.game) this._startProfileWatch(this.data.game.players || [])
  },

  onHide() {
    this._hidden = true
    this._closeProfiles?.()
    this._closeProfiles = null
    clearTimeout(this._watchRetryTimer)
    this._stopPolling()
    try { this.watcher?.close() } catch (_) {}
    this.watcher = null
  },

  onUnload() {
    this._unloaded = true
    this._closeProfiles?.()
    clearTimeout(this._completeRetry)
    clearTimeout(this._watchRetryTimer)
    this._stopPolling()
    if (this._netListener) {
      try {
        wx.offNetworkStatusChange(this._netListener)
      } catch (_) {}
      this._netListener = null
    }
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch (_) {}
      this.watcher = null
    }
  },

  // 弱网待提交队列：按 operationId 去重，网络恢复/回前台重放。
  _pendingQueue() {
    const owner = app.globalData.openid || ''
    if (!this._queue || this._queueOwner !== owner) {
      this._queueOwner = owner
      const key = `stax_pending_${this.data.gameId}_${owner}`
      this._queue = createPendingQueue({
        load: () => {
          try {
            return wx.getStorageSync(key) || []
          } catch (_) {
            return []
          }
        },
        save: items => {
          try {
            wx.setStorageSync(key, items)
          } catch (_) {}
        }
      })
    }
    if (!this._netListener) {
      this._netListener = res => {
        if (res && res.isConnected) this._flushPending()
      }
      try {
        wx.onNetworkStatusChange(this._netListener)
      } catch (_) {}
    }
    return this._queue
  },

  async _flushPending() {
    if (!this.data.gameId || this._flushing) return
    await app.globalData.openidReady
    if (!app.globalData.openid || this._unloaded || this._flushing) return
    const queue = this._pendingQueue()
    this._syncPendingBadge()
    if (!queue.list().length) return
    this._flushing = true
    try {
      const result = await queue.flush(async op => {
        const res = await wx.cloud.callFunction({
          name: 'recordTransaction',
          data: { gameId: this.data.gameId, ...op }
        })
        return res.result
      })
      if (result.sent > 0) {
        // 静默续传成功后拉一次权威数据校正
        this._fetchGameOnce()
      }
      this._syncPendingBadge()
    } finally {
      this._flushing = false
    }
  },

  _syncPendingBadge() {
    const count = this._queue ? this._queue.list().length : 0
    if (this.data.pendingCount !== count) this.setData({ pendingCount: count })
    try {
      const legacy = wx.getStorageSync(`stax_pending_${this.data.gameId}`) || []
      const legacyCount = Array.isArray(legacy) ? legacy.length : 0
      if (this.data.legacyPendingCount !== legacyCount) this.setData({ legacyPendingCount: legacyCount })
    } catch (err) {
      console.warn('[pending storage]', err)
    }
  },

  async onRecoverPending() {
    if (this._recoveringPending) return
    this._recoveringPending = true
    try {
      await app.globalData.openidReady
      if (!app.globalData.openid) return
      const key = `stax_pending_${this.data.gameId}`
      const entries = wx.getStorageSync(key) || []
      if (!Array.isArray(entries) || !entries.length) return
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '恢复待提交记录',
        content: `旧版留下了 ${entries.length} 笔待提交操作。确认这些操作由你发起后，将继续同步；已成功的操作不会重复计入。`,
        confirmText: '确认恢复', success: r => resolve(r.confirm), fail: () => resolve(false)
      }))
      if (!confirmed || this._unloaded) return
      const queue = this._pendingQueue()
      for (const op of entries) queue.enqueue(op)
      const savedIds = new Set(queue.list().map(op => op.operationId))
      wx.setStorageSync(key, (wx.getStorageSync(key) || []).filter(op => !savedIds.has(op.operationId)))
      await this._flushPending()
    } catch (err) {
      console.warn('[pending recovery]', err)
      if (!this._unloaded) wx.showToast({ title: '暂时无法恢复，请稍后重试', icon: 'none' })
    } finally {
      this._recoveringPending = false
      if (!this._unloaded) this._syncPendingBadge()
    }
  },

  // openid 晚于牌局数据到位时，重算我在本局的身份
  _recomputeIdentity() {
    const game = this.data.game
    const myOpenid = this.data.myOpenid || app.globalData.openid || ''
    if (!game || !myOpenid) return
    if (myOpenid !== this.data.myOpenid) this.setData({ myOpenid })
    const isHost = game.hostOpenid === myOpenid
    const isPlayer = (game.players || []).some(p => p.openid === myOpenid)
    if (isHost !== this.data.isHost || isPlayer !== this.data.isPlayer) {
      this.setData({ isHost, isPlayer, viewerMode: !isPlayer })
    }
  },

  async _ensureOpenid() {
    if (app.globalData.openid) {
      this.setData({ myOpenid: app.globalData.openid })
      return
    }
    try {
      await app.globalData.openidReady
      if (app.globalData.openid) {
        this.setData({ myOpenid: app.globalData.openid })
        return
      }
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      if (res?.result?.openid) {
        app.globalData.openid = res.result.openid
        this.setData({ myOpenid: res.result.openid })
      }
    } catch (err) {
      console.error('[whoami]', err)
    }
  },

  _gameSignature(game) {
    if (!game) return ''
    return JSON.stringify({
      id: game._id,
      status: game.status,
      name: game.name,
      hostOpenid: game.hostOpenid,
      inviteCode: game.inviteCode,
      buyIn: game.buyIn,
      smallBlind: game.smallBlind,
      bigBlind: game.bigBlind,
      scoreRatio: game.scoreRatio,
      playerOpsShared: game.playerOpsShared,
      totalPot: game.totalPot,
      checkedOutCount: game.checkedOutCount,
      endedAt: game.endedAt,
      extraCost: game.extraCost,
      expenseMode: game.expenseMode,
      txRevision: game.txRevision || 0,
      stateRevision: game.stateRevision ?? game.txRevision ?? 0,
      players: (game.players || []).map(p => [
        p.openid,
        p.nickname,
        p.avatar,
        p.profileUpdatedAt,
        p.buyInCount,
        p.totalBuyIn,
        p.currentStack,
        p.finalStack,
        p.profit,
        p.finalProfit,
        p.share,
        p.eliminatedAt
      ])
    })
  },

  _getSettleStatus(game) {
    const players = (game.players || []).filter(p => !p.eliminatedAt)
    const checkedOut = players.filter(p => p.finalStack !== null && p.finalStack !== undefined)
    const allCheckedOut = players.length > 0 && checkedOut.length === players.length
    let settleDiff = 0
    let aboveTotal = 0
    let belowTotal = 0
    checkedOut.forEach(p => {
      const profit = Number(p.finalStack) - Number(p.totalBuyIn || 0)
      if (profit > 0) aboveTotal += profit
      else if (profit < 0) belowTotal += profit
      if (allCheckedOut) settleDiff += profit
    })
    return { allCheckedOut, settleDiff, aboveTotal, belowTotal }
  },

  // watch、HTTP 与本地快照共用的落地逻辑。
  _applyGame(game, options = {}) {
    if (this._unloaded) return
    if (!options.complete && !options.optimistic && txSignature(game) !== this._lastTxSig) {
      this._loadComplete(game)
      return
    }
    const current = this.data.game
    const incomingRevision = Number(game.stateRevision ?? game.txRevision) || 0
    const currentRevision = Number(current?.stateRevision ?? current?.txRevision) || 0
    if (
      current &&
      game._id === current._id &&
      incomingRevision < currentRevision &&
      !options.cached &&
      !options.optimistic
    ) {
      return
    }
    const myOpenid = this.data.myOpenid || app.globalData.openid || ''
    const isHost = !!myOpenid && game.hostOpenid === myOpenid
    const isPlayer = !!myOpenid && (game.players || []).some(p => p.openid === myOpenid)
    avatarCache.putProfiles(game.players || [], { source: 'snapshot' })
    // users 缓存优先于牌局快照；旧局不能再把新资料反向覆盖回去。
    const players = (game.players || []).map(p => {
      const c = avatarCache.cached(p.openid)
      const avatar = c?.avatar || p.avatar || ''
      const nickname = avatarCache.meaningfulNickname(c?.nickname)
        ? c.nickname
        : avatarCache.meaningfulNickname(p.nickname)
          ? p.nickname
          : '玩家'
      return {
        ...p,
        avatar,
        nickname,
        displayAvatar:
          avatarCache.displayCached(avatar) ||
          (avatar && !avatar.startsWith('cloud://') ? avatar : '')
      }
    })
    avatarCache.putProfiles(players)
    const g = { ...game, players }
    const signature = this._gameSignature(g)
    if (signature === this._renderSignature) {
      if (!options.optimistic) {
        cacheGame(g)
        if (!options.cached) this._resolveAvatars(players)
      }
      return
    }
    this._renderSignature = signature
    const settleStatus = this._getSettleStatus(g)
    // 终局与结束后的积分修正/费用变更都要让首页与历史即时刷新
    if (g.status === 'ended' && this.data.game && !options.optimistic) invalidateGamesCache()
    const patch = {
      game: g,
      isHost,
      isPlayer,
      viewerMode: !isPlayer,
      loading: false,
      notFound: false,
      loadError: false,
      ...settleStatus
    }
    if (g.status === 'ended') Object.assign(patch, this._createSettleResult(g))
    if (myOpenid && myOpenid !== this.data.myOpenid) patch.myOpenid = myOpenid
    const changed = changedPatch(this.data, patch)
    if (Object.keys(changed).length) this.setData(changed)
    if (!options.optimistic) {
      cacheGame(g)
      this._resolveAvatars(players)
      this._resolveDisplayAvatars(players)
    }
  },

  _applyCompleteGame(snapshot) {
    if (this._unloaded) return
    const current = Number(this.data.game?.stateRevision ?? this.data.game?.txRevision) || 0
    const incoming = Number(snapshot.game.stateRevision ?? snapshot.game.txRevision) || 0
    if (incoming < current) return
    batchRender(this, () => {
      // Build the ledger against this exact player snapshot, before committing one patch.
      this._applyTransactions(snapshot.transactions, snapshot.signature, snapshot.game)
      this._applyGame(snapshot.game, { complete: true, cached: true })
    })
    this._completeFailures = 0
    this._startProfileWatch(snapshot.game.players || [])
    if (snapshot.game.derivedPending && this.data.isPlayer) this._syncDerived()
  },

  _startProfileWatch(players) {
    if (this._hidden || this._unloaded) return
    const ids = [...new Set(players.map(p => p.openid).filter(Boolean))].sort()
    const signature = ids.join(',')
    if (this._closeProfiles && this._profileWatchSignature === signature) return
    this._closeProfiles?.()
    this._profileWatchSignature = signature
    if (!ids.length) { this._closeProfiles = null; return }
    const db = wx.cloud.database(), queries = []
    for (let start = 0; start < ids.length; start += 20) {
      const batch = ids.slice(start, start + 20)
      queries.push(() => db.collection('users').where({ _openid: db.command.in(batch) })
        .field({ _openid: true, nickname: true, avatar: true, updatedAt: true }).limit(20))
    }
    this._closeProfiles = observe(queries, () => this._resolveAvatars(null, { force: true }))
  },

  async _loadComplete(game) {
    if (this._unloaded) return
    if (this._completeLoading) { this._completeQueued = game || this._completeQueued; return }
    this._completeLoading = true
    try {
      const snapshot = await fetchCompleteGame(this.data.gameId, game)
      this._applyCompleteGame(snapshot)
      if (game && (Number(game.stateRevision) || 0) > (Number(snapshot.game.stateRevision) || 0)) this._completeQueued = game
    } catch (err) {
      if (err.message === 'GAME_NOT_FOUND') {
        removeCachedGame(this.data.gameId)
        removeCompleteGame(this.data.gameId)
        clearTimeout(this._completeRetry)
        if (!this._unloaded) this.setData({ game: null, recentTx: [], loading: false, notFound: true })
        return
      }
      if (!this.data.game && !this._unloaded) this.setData({ loading: false, loadError: true })
      if (!this._unloaded) {
        clearTimeout(this._completeRetry)
        this._completeFailures = (this._completeFailures || 0) + 1
        this._completeRetry = setTimeout(() => this._loadComplete(), Math.min(30000, 1000 * 2 ** this._completeFailures))
      }
    } finally {
      this._completeLoading = false
      if (this._completeQueued) {
        const latest = this._completeQueued
        this._completeQueued = null
        if (txSignature(latest) !== this._lastTxSig) this._loadComplete(latest)
        else this._applyGame(latest)
      }
    }
  },

  _startWatch() {
    if (!this.data.gameId || this._unloaded || this._hidden) return
    clearTimeout(this._watchRetryTimer)
    const db = wx.cloud.database()
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch (_) {}
      this.watcher = null
    }
    this._watchRetries = this._watchRetries || 0
    try {
      this.watcher = db
        .collection('games')
        .doc(this.data.gameId)
        .watch({
          onChange: snapshot => {
            if (this._unloaded) return
            this._watchRetries = 0
            this._watchDelivered = true // 标记：初次直拉可作废，避免重复渲染
            this._stopPolling() // 实时通道可用，停掉兜底轮询
            if (snapshot.docs && snapshot.docs.length) {
              this._applyGame(snapshot.docs[0])
            } else {
              // watch 正常回调但查无此文档，才是真的不存在/已删除
              removeCachedGame(this.data.gameId)
              removeCompleteGame(this.data.gameId)
              this.setData({ game: null, loading: false, notFound: true })
            }
          },
          onError: err => {
            if (this._unloaded) return
            // 实时通道失败 ≠ 牌局不存在。部分设备/网络（代理、企业 Wi-Fi、
            // 旧基础库）websocket 不可用，但普通 HTTP 读库是通的——
            // 此处绝不能进入"不存在"空态，改走单次拉取 + 轮询兜底。
            console.error('[watch] error', err)
            this.watcher = null
            if (!this.data.game) this._fetchGameOnce()
            if (this._watchRetries < 3) {
              this._watchRetries++
              clearTimeout(this._watchRetryTimer)
              this._watchRetryTimer = setTimeout(
                () => this._startWatch(),
                this._watchRetries * 2000
              )
            } else {
              this._startPolling()
            }
          }
        })
    } catch (err) {
      // 基础库过旧等原因导致 watch 不可用：直接降级轮询
      console.error('[watch] unavailable', err)
      this.watcher = null
      this._startPolling()
    }
  },

  // 实时通道不可用时的兜底：HTTP 轮询，watch 恢复后自动停止
  _startPolling() {
    if (this._pollTimer) return
    this._fetchGameOnce()
    this._pollTimer = setInterval(() => {
      this._fetchGameOnce()
      if (!this.watcher) this._startWatch()
    }, 8000)
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  async _fetchGameOnce() {
    return this._loadComplete()
  },

  _syncDerived() {
    if (this._derivedTask) return this._derivedTask
    // A separate cloud invocation survives page navigation; the durable server task is the fallback.
    this._derivedTask = wx.cloud.callFunction({ name: 'settleGame', data: {
      gameId: this.data.gameId, syncDerived: true
    } }).catch(err => console.warn('[derived sync]', err)).finally(() => { this._derivedTask = null })
    return this._derivedTask
  },

  onRetryLoad() {
    this.setData({ loading: true, loadError: false })
    this._watchRetries = 0
    this._fetchGameOnce()
    this._startWatch()
  },

  // 用 game 文档中与流水相关的字段构造签名：
  // 状态版本不进入签名，盲注升级、暂停和费用修改不会触发流水重拉。
  _txSignature(game) {
    return txSignature(game)
  },

  async _fetchRecentTx() {
    return this._loadComplete()
  },

  _applyTransactions(transactions, signature, game = this.data.game) {
    this._txRaw = sortTransactions(mergeTransactions([], transactions))
    const all = expandRevocations(this._txRaw)
    const nameMap = {}
    const buyIn = Number(game?.buyIn || 0)
    const profiles = [...(game?.players || []), ...(game?.removedPlayers || [])]
    profiles.forEach(player => {
      if (!nameMap[player.openid]) nameMap[player.openid] = avatarCache.cached(player.openid)?.nickname || player.nickname
    })

    const handState = transactionHandState(all, profiles, buyIn)
    const resolveName = openid => nameMap[openid]

    const recentTx = all.map(tx => {
      const d = tx.timestamp ? new Date(tx.timestamp) : null
      const timeStr = d
        ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : ''
      const hands = handState[tx._id]?.hands || 0
      const accHands = handState[tx._id]?.accHands || 0
      const sentenceParts = buildTransactionSentence(tx, hands, accHands, resolveName)
      return {
        _id: tx._id,
        playerOpenid: tx.playerOpenid,
        type: tx.type,
        revoked: tx.revoked,
        timeStr,
        sentenceParts
      }
    })
    if (JSON.stringify(recentTx) !== JSON.stringify(this.data.recentTx)) this.setData({ recentTx })
    this._lastTxSig = signature
  },

  // 首帧用本地缓存秒显；后台轻量刷新 users 表，保证改名/换头像能很快纠正。
  async _resolveAvatars(players, options = {}) {
    const list = players || this.data.game?.players || []
    const need = list
      .filter(p => options.force || !p.avatar || !p.nickname || avatarCache.isStale(p.openid))
      .map(p => p.openid)
    if (!need.length) return
    if (this._profileRefreshing) return
    this._profileRefreshing = true
    let map = {}
    try {
      map = await avatarCache.resolve(need, { force: !!options.force })
    } finally {
      this._profileRefreshing = false
    }
    const cur = this.data.game?.players || []
    if (this._unloaded) return
    let changed = false
    const updated = cur.map(p => {
      const latest = map[p.openid]
      if (!latest) return p
      const nextAvatar = latest.avatar || p.avatar || ''
      const nextName = latest.nickname || p.nickname || '玩家'
      if (nextAvatar !== p.avatar || nextName !== p.nickname) {
        changed = true
        return {
          ...p,
          avatar: nextAvatar,
          nickname: nextName,
          displayAvatar:
            avatarCache.displayCached(nextAvatar) ||
            (nextAvatar && !nextAvatar.startsWith('cloud://') ? nextAvatar : '')
        }
      }
      return p
    })
    if (changed) {
      const game = { ...this.data.game, players: updated }
      this._renderSignature = this._gameSignature(game)
      const patch = { 'game.players': updated }
      if (game.status === 'ended') Object.assign(patch, this._createSettleResult(game))
      const latestNames = {}
      updated.forEach(player => {
        latestNames[player.openid] = player.nickname
      })
      batchRender(this, () => {
        if (this._txRaw && this._txRaw.length) this._applyTransactions(this._txRaw, this._lastTxSig, game)
        this.setData(patch)
      })
      cacheGame(game)
      if (this._txRaw) rememberCompleteGame(game, this._txRaw)
    }
    this._resolveDisplayAvatars(updated)
  },

  async _resolveDisplayAvatars(players) {
    const list = players || this.data.game?.players || []
    const fileIDs = list.map(player => player.avatar).filter(Boolean)
    if (!fileIDs.some(fileID => fileID.startsWith('cloud://'))) return
    const urls = await avatarCache.resolveDisplayUrls(fileIDs)
    const current = this.data.game?.players || []
    let changed = false
    const updated = current.map(player => {
      const displayAvatar = urls[player.avatar] || player.displayAvatar || ''
      if (displayAvatar && displayAvatar !== player.displayAvatar) {
        changed = true
        return { ...player, displayAvatar }
      }
      return player
    })
    if (!changed) return
    const game = { ...this.data.game, players: updated }
    this.setData({ 'game.players': updated })
    cacheGame(game)
  },

  // ===== 操作 =====
  // 乐观更新公共原语：本地立即改指定玩家上屏，云端失败由调用方回拉纠正；
  // watch 推送的服务端数据始终是权威，会自动覆盖本地状态
  _patchPlayer(openid, patch, extraSet = {}) {
    const game = this.data.game
    if (!game) return
    const players = (game.players || []).map(p => (p.openid === openid ? { ...p, ...patch(p) } : p))
    const nextGame = { ...game, players }
    if (extraSet['game.totalPot'] !== undefined) nextGame.totalPot = extraSet['game.totalPot']
    const settleStatus = this._getSettleStatus(nextGame)
    this._renderSignature = this._gameSignature(nextGame)
    this.setData({ 'game.players': players, ...extraSet, ...settleStatus })
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (_) {}
  },

  _applyOptimisticBuy(openid, amount, hands) {
    const game = this.data.game
    if (!game) return
    const players = (game.players || []).map(player => {
      if (player.openid !== openid) return player
      return {
        ...player,
        buyInCount: (Number(player.buyInCount) || 0) + hands,
        totalBuyIn: (Number(player.totalBuyIn) || 0) + amount,
        currentStack: (Number(player.currentStack) || 0) + amount,
        finalStack: null,
        profit: 0,
        finalProfit: null,
        share: 0,
        checkedOutAt: null,
        eliminatedAt: null
      }
    })
    const settledCount = players.filter(
      player => player.finalStack !== null && player.finalStack !== undefined
    ).length
    this._applyGame(
      {
        ...game,
        players,
        totalPot: (Number(game.totalPot) || 0) + amount,
        checkedOutCount: settledCount,
        settledCount
      },
      { optimistic: true }
    )
  },

  async _record(type, playerOpenid, amount = 0, extra = {}) {
    if (this._recording) return
    this._recording = true
    const optimistic = (type === 'rebuy' || type === 'addOn') && !!this.data.game
    const rollbackGame = optimistic ? this.data.game : null
    if (optimistic) {
      this._applyOptimisticBuy(playerOpenid, amount, Math.max(1, Number(extra.hands) || 1))
    } else {
      wx.showLoading({ title: '处理中…' })
    }
    // 请求 >400ms 才提示"待确认"，避免正常延迟也打扰
    const operationId = createOperationId(type)
    const opData = { type, playerOpenid, amount, operationId, ...extra }
    let pendingTimer = null
    if (optimistic) {
      pendingTimer = setTimeout(() => {
        this._syncPendingBadge()
      }, 400)
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'recordTransaction',
        data: { gameId: this.data.gameId, ...opData }
      })
      clearTimeout(pendingTimer)
      if (!optimistic) wx.hideLoading()
      if (!res.result || !res.result.ok) {
        const err = res.result && res.result.error
        const msg =
          {
            NOT_HOST: '仅庄家可操作',
            CAN_ONLY_BUY_FOR_SELF: '只能给自己买入',
            GAME_ENDED: '牌局已结束',
            CONFLICT_RETRY: '操作冲突，请重试'
          }[err] ||
          require('../../utils/errors.js').errorMessage(err)
        wx.showToast({ title: msg, icon: 'none' })
        if (rollbackGame) this._applyGame(rollbackGame, { optimistic: true })
        if (optimistic) this._fetchGameOnce()
      } else {
        // 成功静默（不弹成功 Toast）
        if (res.result.game) this._applyGame(res.result.game)
        else this._fetchRecentTx()
      }
    } catch (err) {
      clearTimeout(pendingTimer)
      if (!optimistic) wx.hideLoading()
      console.error(err)
      // 弱网：可重放的买入操作入队静默续传，保留乐观态，不回滚不报错
      if (optimistic && isReplayable(type)) {
        this._pendingQueue().enqueue(opData)
        this._syncPendingBadge()
      } else {
        wx.showToast({ title: '网络异常', icon: 'none' })
        if (rollbackGame) this._applyGame(rollbackGame, { optimistic: true })
      }
    } finally {
      this._recording = false
    }
  },

  onQuickBuy() {
    this._promptAmount('买入', this.data.myOpenid, 'rebuy')
  },

  onQuickSettle() {
    const me = (this.data.game?.players || []).find(p => p.openid === this.data.myOpenid)
    if (!me) return
    this._doSettle(this.data.myOpenid, me)
  },

  onPlayerTap(e) {
    const { openid, player, isSelf } = e.detail
    const game = this.data.game
    if (!game) return
    if (player.eliminatedAt) return
    if (this.data.viewerMode) return
    if (!this.data.isPlayer) return
    // 结束后 3 小时内仍可修改结算积分；超时后锁定
    if (!canEditSettle(game)) return
    const ongoing = game.status === 'ongoing'
    // 朋友局：参赛成员可代提他人结算；房间关闭「权限共享」时仅房主可操作
    const canOperateOthers = this.data.isHost || game.playerOpsShared !== false
    if (!isSelf && !canOperateOthers) return

    const settled = player.finalStack !== null && player.finalStack !== undefined
    const items = []
    const actions = []

    if (isSelf) {
      if (ongoing && !settled) {
        items.push('买入')
        actions.push('selfrebuy')
        items.push('结算')
        actions.push('settle')
      } else if (ongoing) {
        items.push('改码')
        actions.push('settle')
        items.push('买入')
        actions.push('selfrebuy')
      } else {
        items.push('修改结算积分')
        actions.push('settle')
      }
    } else {
      if (ongoing && !settled) {
        items.push('帮他买入')
        actions.push('rebuy')
        items.push('帮他结算')
        actions.push('settle')
      } else if (ongoing) {
        items.push('帮他改码')
        actions.push('settle')
        items.push('帮他买入')
        actions.push('rebuy')
      } else {
        items.push('修改他的结算积分')
        actions.push('settle')
      }
      if (ongoing && this.data.isHost) {
        items.push('踢人')
        actions.push('eliminate')
      }
    }

    wx.showActionSheet({
      itemList: items,
      success: res => {
        const action = actions[res.tapIndex]
        if (action === 'selfrebuy') {
          this._promptAmount('买入', openid, 'rebuy')
        } else if (action === 'settle') {
          this._doSettle(openid, player)
        } else if (action === 'rebuy') {
          this._promptAmount('帮他买入', openid, 'rebuy')
        } else if (action === 'eliminate') {
          this._confirmEliminate(openid)
        }
      }
    })
  },

  _doSettle(openid, player) {
    const hasExisting = player.finalStack !== null && player.finalStack !== undefined
    wx.showModal({
      title: hasExisting ? '修改结算积分' : '结算积分',
      editable: true,
      placeholderText: String(hasExisting ? player.finalStack : player.currentStack || 0),
      success: async r => {
        if (!r.confirm) return
        const val =
          r.content !== ''
            ? Number(r.content)
            : hasExisting
              ? player.finalStack
              : player.currentStack || 0
        const finalStack = Number(val || 0)
        if (finalStack < 0) {
          wx.showToast({ title: '筹码不能小于 0', icon: 'none' })
          return
        }
        // 乐观上屏：最后一位结算时直接呈现终局；失败立即回滚。
        const rollbackGame = this._applyOptimisticCheckout(openid, finalStack)
        try {
          const res = await wx.cloud.callFunction({
            name: 'settleGame',
            data: {
              gameId: this.data.gameId,
              mode: 'checkout',
              deferDerived: true,
              operationId: createOperationId('checkout'),
              finalStacks: { [openid]: finalStack }
            }
          })
          if (!res.result?.ok) {
            const msg =
              {
                ALREADY_ENDED: '结束已超 3 小时，积分已锁定',
                INVALID_STACK: '请输入有效的非负积分',
                PLAYER_OPS_DISABLED: '本局仅房主可操作',
                INVALID_MODE: '请更新到最新版后重试',
                CONFLICT_RETRY: '操作冲突，请重试'
              }[res.result?.error] || '操作失败，请稍后重试'
            wx.showToast({ title: msg, icon: 'none' })
            if (rollbackGame) this._applyGame(rollbackGame, { optimistic: true })
            this._fetchGameOnce()
            return
          }
          if (res.result.game) this._applyGame(res.result.game)
          else this._fetchGameOnce()
          if (res.result.derivedPending) this._syncDerived()
          wx.showToast({
            title: res.result.justEnded ? '全员结算完成，已收局' : '已记录',
            icon: 'success'
          })
        } catch (err) {
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
          if (rollbackGame) this._applyGame(rollbackGame, { optimistic: true })
          this._fetchGameOnce()
        }
      }
    })
  },

  _applyOptimisticCheckout(openid, finalStack) {
    const game = this.data.game
    if (!game) return null
    const now = new Date()
    let players = (game.players || []).map(p => {
      if (p.openid !== openid) return p
      return {
        ...p,
        finalStack,
        profit: finalStack - (p.totalBuyIn || 0),
        currentStack: finalStack,
        checkedOutAt: p.checkedOutAt || now
      }
    })
    const active = players.filter(p => !p.eliminatedAt)
    const allSettled =
      active.length > 0 && active.every(p => p.finalStack !== null && p.finalStack !== undefined)
    if (allSettled) {
      players = players.map(p =>
        p.eliminatedAt ? p : { ...p, finalProfit: Number(p.profit) || 0 }
      )
    }
    const settledCount = players.filter(
      p => p.finalStack !== null && p.finalStack !== undefined
    ).length
    const nextGame = {
      ...game,
      players,
      checkedOutCount: settledCount,
      settledCount,
      ...(allSettled && game.status === 'ongoing' ? { status: 'ended', endedAt: now } : {})
    }
    this._applyGame(nextGame, { optimistic: true })
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (_) {}
    return game
  },

  _confirmEliminate(openid) {
    wx.showModal({
      title: '踢出该玩家',
      content: '将把该玩家移出本局：其买入从总池中扣除，结算、战绩与赛季积分均不再包含 TA。',
      confirmText: '踢出',
      confirmColor: '#C8102E',
      success: r => {
        if (r.confirm) this._record('eliminate', openid)
      }
    })
  },

  onRebuy(e) {
    this._promptAmount('帮他买入', e.detail.openid, 'rebuy')
  },
  onAddOn(e) {
    this._promptAmount('追加买入', e.detail.openid, 'addOn')
  },
  onSelfRebuy(e) {
    this._promptAmount('买入', e.detail.openid, 'rebuy')
  },

  onRevokeTx(e) {
    const txId = e.currentTarget.dataset.id
    wx.showModal({
      title: '撤销该笔买入',
      content: '将回退该玩家的买入额与次数，且操作不可再次撤销',
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '撤销中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'recordTransaction',
            data: {
              gameId: this.data.gameId,
              type: 'revoke',
              txId,
              operationId: createOperationId('revoke')
            }
          })
          wx.hideLoading()
          if (!res.result?.ok) wx.showToast({ title: '撤销失败，请稍后重试', icon: 'none' })
          else {
            if (res.result.game) this._applyGame(res.result.game)
            wx.showToast({ title: '已撤销', icon: 'success' })
            this._fetchRecentTx(true)
          }
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  _promptAmount(title, openid, type) {
    this.setData({
      handsPicker: { show: true, title, openid, type, hands: 1 }
    })
  },

  onHandsClose() {
    this.setData({ 'handsPicker.show': false })
  },

  onHandsStop() {
    /* 阻止冒泡 */
  },

  onHandsMinus() {
    const cur = this.data.handsPicker.hands || 1
    if (cur <= 1) return
    this.setData({ 'handsPicker.hands': cur - 1 })
  },

  onHandsPlus() {
    const cur = this.data.handsPicker.hands || 1
    if (cur >= 99) return
    this.setData({ 'handsPicker.hands': cur + 1 })
  },

  onHandsInput(e) {
    const v = Math.max(1, Math.min(99, Math.floor(Number(e.detail.value) || 1)))
    this.setData({ 'handsPicker.hands': v })
  },

  onHandsConfirm() {
    const { openid, type, hands } = this.data.handsPicker
    const n = Math.max(1, Math.floor(Number(hands) || 1))
    this.setData({ 'handsPicker.show': false })
    if (type === 'join') {
      this._joinWithHands(n)
      return
    }
    const buyIn = Number(this.data.game.buyIn || 0)
    this._record(type, openid, n * buyIn, { hands: n })
  },

  // ===== 费用分摊（随时可设，仅记录，不影响盈亏积分） =====
  onOpenExpense() {
    if (this.data.viewerMode || !this.data.isPlayer) return
    const game = this.data.game || {}
    this.setData({
      expensePanel: {
        show: true,
        extraCost: Number(game.extraCost) > 0 ? String(game.extraCost) : '',
        // 已存过就用存的；没存过默认「水上比例」
        expenseMode:
          game.expenseMode || game.aaMode
            ? normalizeExpenseMode(game.expenseMode || game.aaMode)
            : 'winner',
        submitting: false
      }
    })
  },

  onExpensePanelClose() {
    if (this.data.expensePanel.submitting) return
    this.setData({ 'expensePanel.show': false })
  },

  onExpensePanelStop() {},

  onExtraCostInput(e) {
    this.setData({ 'expensePanel.extraCost': e.detail.value })
  },

  onExpenseModePick(e) {
    const idx = Number(e.detail.value) || 0
    this.setData({ 'expensePanel.expenseMode': EXPENSE_MODE_OPTIONS[idx] || 'all' })
  },

  async onExpenseConfirm() {
    if (this.data.expensePanel.submitting) return
    const extraCost = Number(this.data.expensePanel.extraCost) || 0
    if (extraCost < 0) {
      wx.showToast({ title: '请输入有效的费用金额', icon: 'none' })
      return
    }
    this.setData({ 'expensePanel.submitting': true })
    wx.showLoading({ title: '保存中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'settleGame',
        data: {
          gameId: this.data.gameId,
          mode: 'expense',
          deferDerived: true,
          operationId: createOperationId('expense'),
          extraCost,
          expenseMode: this.data.expensePanel.expenseMode
        }
      })
      wx.hideLoading()
      if (!res.result?.ok) {
        const msg =
          {
            ALREADY_ENDED: '结束已超 3 小时，费用已锁定',
            PLAYER_OPS_DISABLED: '本局仅房主可操作',
            INVALID_EXTRA_COST: '请输入有效的费用金额',
            INVALID_MODE: '请更新到最新版后重试',
            CONFLICT_RETRY: '操作冲突，请重试'
          }[res.result?.error] || '操作失败，请稍后重试'
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
      this.setData({ 'expensePanel.show': false })
      if (res.result.derivedPending) this._syncDerived()
      wx.showToast({ title: '已保存', icon: 'success' })
      if (res.result.game) this._applyGame(res.result.game)
      else this._fetchGameOnce()
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ 'expensePanel.submitting': false })
    }
  },

  _createSettleResult(gameOrPlayers) {
    const game = Array.isArray(gameOrPlayers) ? null : gameOrPlayers
    const players = Array.isArray(gameOrPlayers)
      ? gameOrPlayers
      : gameOrPlayers?.players || this.data.game?.players || []
    const extraCost = Number(game?.extraCost ?? this.data.game?.extraCost) || 0
    const expenseMode = normalizeExpenseMode(
      game?.expenseMode || game?.aaMode || this.data.game?.expenseMode || 'all'
    )
    const profitList = players
      .filter(p => !p.eliminatedAt)
      .map(p => {
        const hasFinalStack = p.finalStack !== null && p.finalStack !== undefined
        const totalBuyIn = Number(p.totalBuyIn) || 0
        const finalStack = hasFinalStack ? Number(p.finalStack) || 0 : 0
        return {
          openid: p.openid,
          nickname: p.nickname || '玩家',
          avatar: p.avatar || '',
          buyInCount: p.buyInCount || 1,
          totalBuyIn,
          finalStack,
          profit: hasFinalStack ? finalStack - totalBuyIn : Number(p.finalProfit ?? p.profit) || 0
        }
      })
    const transfers = settle(profitList.map(p => ({ nickname: p.nickname, profit: p.profit })))
    let shares = []
    if (extraCost > 0) {
      // 服务端已把费用单落在 players[].share（权威）；无则本地按方式计算兜底
      const serverShares = players
        .filter(p => !p.eliminatedAt && Number(p.share) > 0)
        .map(p => ({ openid: p.openid, nickname: p.nickname || '玩家', share: Number(p.share) }))
      shares = serverShares.length
        ? serverShares
        : computeShares(profitList, extraCost, expenseMode)
    }
    const expenseRows = shares
      .filter(item => Number(item.share) > 0)
      .map(item => ({
        openid: item.openid,
        nickname: item.nickname || '玩家',
        share: Number(item.share) || 0
      }))
    const winner = profitList.slice().sort((a, b) => b.profit - a.profit)[0] || null
    const loser = profitList.slice().sort((a, b) => a.profit - b.profit)[0] || null
    const mostRebuys = profitList.slice().sort((a, b) => b.buyInCount - a.buyInCount)[0] || null
    const winnerCount = profitList.filter(p => p.profit > 0).length
    const aboveCount = profitList.filter(p => p.profit > 0).length
    const evenCount = profitList.filter(p => p.profit === 0).length
    const belowCount = profitList.filter(p => p.profit < 0).length
    const aboveTotal = profitList.filter(p => p.profit > 0).reduce((s, p) => s + p.profit, 0)
    const belowTotal = profitList.filter(p => p.profit < 0).reduce((s, p) => s + p.profit, 0)
    const totalPot = profitList.reduce((s, p) => s + p.totalBuyIn, 0)
    const rawGame = Array.isArray(gameOrPlayers) ? this.data.game : gameOrPlayers
    let duration = '--'
    if (rawGame?.startedAt && rawGame?.endedAt) {
      const ms = new Date(rawGame.endedAt) - new Date(rawGame.startedAt)
      const h = Math.floor(ms / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      duration = h > 0 ? `${h}h ${m}m` : `${m} 分钟`
    }
    const quote = this.data.settleResult?.quote ||
      SUNZI[Math.floor(Math.random() * SUNZI.length)] || { text: '', from: '' }
    const gameName =
      (Array.isArray(gameOrPlayers) ? this.data.game?.name : gameOrPlayers?.name) || 'StaxKit 牌局'
    const endedDate = new Date(rawGame?.endedAt || rawGame?.startedAt || Date.now())
    const dateStr = `${endedDate.getFullYear()}-${String(endedDate.getMonth() + 1).padStart(2, '0')}-${String(endedDate.getDate()).padStart(2, '0')}`
    const endTimeStr = rawGame?.endedAt
      ? `${String(new Date(rawGame.endedAt).getHours()).padStart(2, '0')}:${String(new Date(rawGame.endedAt).getMinutes()).padStart(2, '0')}`
      : ''
    return {
      settleResult: {
        profitList,
        transfers,
        extraCost,
        expenseMode,
        expenseModeLabel: EXPENSE_MODE_LABELS[expenseMode] || '全员平均',
        expenseRows,
        shares,
        winner,
        loser,
        mostRebuys,
        winnerCount,
        aboveCount,
        evenCount,
        belowCount,
        aboveTotal,
        belowTotal,
        totalPot,
        duration,
        quote,
        gameName,
        dateStr,
        endTimeStr
      },
      settleWinnerOpenid: winner?.openid || ''
    }
  },

  _buildSettleResult(gameOrPlayers) {
    this.setData(this._createSettleResult(gameOrPlayers))
  },

  async onJoinAsPlayer() {
    if (this.data.joining || this._profileJoining) return
    if (!this.data.game) return
    await app.globalData.openidReady
    const profile = readLocalProfile(app.globalData.openid) || {}
    if (!isMeaningfulNickname(profile.nickname)) {
      await this._completeJoinProfile()
      return
    }
    const code = this.data.inviteCode || this.data.game?.inviteCode
    if (!code) {
      wx.showToast({ title: '邀请信息已失效，请让好友重新分享', icon: 'none' })
      return
    }
    // 与常规买入同一套手数选择器（+/- 或直接输入），openid 无意义占位
    this.setData({
      handsPicker: { show: true, title: '上桌', openid: '', type: 'join', hands: 1 }
    })
  },

  async _completeJoinProfile(hands = 1) {
    if (this._profileJoining || this._unloaded) return
    this._profileJoining = true
    try {
      const filled = await this.selectComponent('#join-profile').request({ hands, buyIn: this.data.game?.buyIn || 0 })
      if (filled && !this._unloaded) await this._joinWithHands(filled.hands, true)
    } finally { this._profileJoining = false }
  },

  async _joinWithHands(hands, profileCompleted = false) {
    if (this.data.joining || this._unloaded) return
    const code = this.data.inviteCode || this.data.game?.inviteCode
    const profile = readLocalProfile(app.globalData.openid) || {}
    this.setData({ joining: true })
    wx.showLoading({ title: '上桌中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'joinGame',
        data: {
          inviteCode: code,
          nickname: profile.nickname || '玩家',
          avatar: profile.avatar || '',
          mode: 'player',
          hands
        }
      })
      wx.hideLoading()
      const { ok, error, alreadyJoined, game } = res.result || {}
      if (!ok) {
        if (error === 'PROFILE_REQUIRED' && !profileCompleted) {
          this.setData({ joining: false })
          await this._completeJoinProfile(hands)
          return
        }
        const msg =
          {
            GAME_NOT_FOUND: '牌局已结束',
            PROFILE_REQUIRED: '请先完善真实昵称',
            CONFLICT_RETRY: '操作冲突，请重试'
          }[error] ||
          '操作失败，请稍后重试'
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
      if (alreadyJoined) wx.showToast({ title: '你已经在桌上', icon: 'none' })
      markGamesChanged()
      if (game) this._applyGame(game)
      this.setData({ viewerMode: false })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ joining: false })
    }
  },

  onShareAppMessage() {
    const g = this.data.game
    return require('../../utils/share.js').safeShare(
      `/pages/game-detail/game-detail?id=${encodeURIComponent(this.data.gameId)}&code=${encodeURIComponent(g?.inviteCode || '')}&mode=viewer`,
      '邀请你一起记录朋友局积分'
    )
  }
})
