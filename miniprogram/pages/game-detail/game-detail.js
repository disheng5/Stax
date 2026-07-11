// pages/game-detail/game-detail.js — 牌局详情（核心页）
const app = getApp()
const { settle } = require('../../utils/settle.js')
const { computeShares } = require('../../utils/aa.js')
const {
  invalidateGamesCache,
  cacheGame,
  getCachedGame,
  removeCachedGame
} = require('../../utils/game-data.js')
const avatarCache = require('../../utils/avatar.js')
const { isMeaningfulNickname, readLocalProfile } = require('../../utils/user.js')
const { createOperationId } = require('../../utils/operation.js')
const SUNZI = require('../../utils/sunzi.js')

const TX_TYPE_LABEL = {
  buyIn: '入场',
  rebuy: '买入',
  addOn: '买入',
  eliminate: '移出',
  settle: '结算',
  settlePartial: '结算'
}

const TX_TYPE_CLASS = {
  buyIn: 'entry',
  rebuy: 'buy',
  addOn: 'buy',
  eliminate: 'remove',
  settle: 'settle',
  settlePartial: 'settle'
}

function transactionDetail(tx, hands, accHands) {
  if (tx.type === 'buyIn') return `入场${hands}手，共${accHands}手`
  if (tx.type === 'rebuy' || tx.type === 'addOn') {
    if (tx.revoked) return `买入${hands}手，未计入当前手数`
    return `当前${Math.max(0, accHands - hands)}手，买入${hands}手，共${accHands}手`
  }
  if (tx.type === 'settle' || tx.type === 'settlePartial') {
    return `剩余积分${Number(tx.amount) || 0}`
  }
  if (tx.type === 'eliminate') {
    const removedBuyIn = Number(tx.meta?.removedBuyIn) || Math.abs(Number(tx.amount) || 0)
    return removedBuyIn > 0 ? `移出房间，扣除${removedBuyIn}积分` : '移出房间'
  }
  return Number(tx.amount) ? `积分${Number(tx.amount)}` : ''
}

function normalizeExpenseMode(value) {
  if (['winner', 'winnerRatio', 'winnerByRatio'].includes(value)) return 'winner'
  if (['winnerEven', 'winnersEven'].includes(value)) return 'winnerEven'
  if (value === 'mvp') return 'mvp'
  return 'all'
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
    canEditSettle: false,
    expensePanel: { show: false, extraCost: '', expenseMode: 'all', submitting: false },
    expenseModeLabels: EXPENSE_MODE_LABELS,
    expenseModeOptions: EXPENSE_MODE_OPTIONS,
    settleResult: null,
    settleWinnerOpenid: ''
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
    const cachedGame = getCachedGame(gameId)
    if (cachedGame) this._applyGame(cachedGame, { cached: true })
    // HTTP 直拉先上屏，watch 作为实时升级通道，两者并行；
    // 若 watch 首包抢先到达，这次直拉结果作废，避免重复渲染（deferToWatch）
    this._watchDelivered = false
    this._fetchGameOnce({ deferToWatch: true })
    this._startWatch()
    await this._ensureOpenid()
    this._recomputeIdentity()
  },

  onShow() {
    if (!this.watcher && this.data.gameId) {
      this._watchRetries = 0
      this._startWatch()
    }
    this._recomputeIdentity()
  },

  onUnload() {
    clearTimeout(this._watchRetryTimer)
    this._stopPolling()
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch (_) {}
      this.watcher = null
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
      excludeFromSeason: game.excludeFromSeason,
      endedAt: game.endedAt,
      extraCost: game.extraCost,
      expenseMode: game.expenseMode,
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
      cacheGame(g)
      if (!options.cached) this._resolveAvatars(players)
      return
    }
    this._renderSignature = signature
    const settleStatus = this._getSettleStatus(g)
    // 终局与结束后的积分修正/费用变更都要让首页与历史即时刷新
    if (g.status === 'ended' && this.data.game) invalidateGamesCache()
    const patch = {
      game: g,
      isHost,
      isPlayer,
      viewerMode: !isPlayer,
      loading: false,
      notFound: false,
      loadError: false,
      canEditSettle: canEditSettle(g),
      ...settleStatus
    }
    if (g.status === 'ended') Object.assign(patch, this._createSettleResult(g))
    if (myOpenid && myOpenid !== this.data.myOpenid) patch.myOpenid = myOpenid
    this.setData(patch)
    cacheGame(g)
    this._resolveAvatars(players)
    this._resolveDisplayAvatars(players)
    this._fetchRecentTx()
  },

  _startWatch() {
    if (!this.data.gameId) return
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
            this._watchRetries = 0
            this._watchDelivered = true // 标记：初次直拉可作废，避免重复渲染
            this._stopPolling() // 实时通道可用，停掉兜底轮询
            if (snapshot.docs && snapshot.docs.length) {
              this._applyGame(snapshot.docs[0])
            } else {
              // watch 正常回调但查无此文档，才是真的不存在/已删除
              removeCachedGame(this.data.gameId)
              this.setData({ game: null, loading: false, notFound: true })
            }
          },
          onError: err => {
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
    if (!this._pollToastShown && this.data.game) {
      this._pollToastShown = true
      wx.showToast({ title: '实时同步不可用，已切换为自动刷新', icon: 'none', duration: 2500 })
    }
    this._fetchGameOnce()
    this._pollTimer = setInterval(() => {
      if (this.data.game && this.data.game.status === 'ended') {
        this._stopPolling()
        return
      }
      this._fetchGameOnce()
    }, 8000)
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  },

  async _fetchGameOnce(opts = {}) {
    if (!this.data.gameId || this._fetching) return
    this._fetching = true
    try {
      const db = wx.cloud.database()
      const got = await db.collection('games').doc(this.data.gameId).get()
      // 初次直拉：若 watch 已抢先渲染权威数据，丢弃本次结果（省一次 setData/头像/流水）
      if (opts.deferToWatch && this._watchDelivered) return
      if (got && got.data) {
        this._applyGame(got.data)
      } else {
        removeCachedGame(this.data.gameId)
        this.setData({ game: null, loading: false, notFound: true })
      }
    } catch (err) {
      console.error('[fetchGameOnce]', err)
      const msg = (err && (err.errMsg || err.message)) || ''
      if (/not.?exist|non.?exist|不存在|-502004/i.test(msg)) {
        // 确证文档不存在
        removeCachedGame(this.data.gameId)
        this.setData({ game: null, loading: false, notFound: true })
      } else if (!this.data.game) {
        // 网络/权限等失败且手上没有任何数据：如实展示加载失败，可重试，
        // 不能谎报"牌局不存在或已结束"
        this.setData({ loading: false, loadError: true })
      }
    } finally {
      this._fetching = false
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, loadError: false })
    this._watchRetries = 0
    this._fetchGameOnce()
    this._startWatch()
  },

  // 用 game 文档中与流水相关的字段构造签名：
  // 签名没变说明没有新交易（盲注升级/暂停等推送不触发流水重拉）
  _txSignature(game) {
    if (!game) return ''
    const players = game.players || []
    let buySum = 0
    let finalSum = 0
    let checked = 0
    let elim = 0
    players.forEach(p => {
      buySum += Number(p.totalBuyIn) || 0
      if (p.finalStack !== null && p.finalStack !== undefined) {
        checked++
        finalSum += Number(p.finalStack) || 0
      }
      if (p.eliminatedAt) elim++
    })
    return [game.totalPot || 0, players.length, buySum, checked, finalSum, elim, game.status].join(
      '|'
    )
  },

  async _fetchRecentTx(force = false) {
    if (!this.data.gameId) return
    if (this._txFetching) {
      this._txRefreshQueued = this._txRefreshQueued || force
      return
    }
    const sig = this._txSignature(this.data.game)
    if (!force && sig && sig === this._lastTxSig) return
    this._txFetching = true
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const coll = db.collection('transactions').where({ gameId: this.data.gameId })
      let all = null

      // 增量路径：已有缓存且非强制刷新（撤销需全量以更新 revoked 标记）时，
      // 只拉比已知最新更晚的流水；一次拉满 20 条说明落后太多，回退全量
      if (!force && Array.isArray(this._txRaw) && this._txRaw.length) {
        const newestTs = this._txRaw.reduce((m, t) => {
          const v = +new Date(t.timestamp)
          return v > m ? v : m
        }, 0)
        const inc = await db
          .collection('transactions')
          .where({ gameId: this.data.gameId, timestamp: _.gt(new Date(newestTs)) })
          .orderBy('timestamp', 'desc')
          .limit(20)
          .get()
        if (inc.data.length < 20) {
          const known = {}
          this._txRaw.forEach(t => {
            known[t._id] = true
          })
          all = [...inc.data.filter(t => !known[t._id]), ...this._txRaw]
        }
      }

      if (!all) {
        // 全量路径：count + 首页并行，其余页并行补齐（固定 2 轮 RTT）
        const [countRes, first] = await Promise.all([
          coll.count(),
          coll.orderBy('timestamp', 'desc').limit(20).get()
        ])
        all = first.data
        const total = countRes.total || 0
        if (total > 20) {
          for (let skip = 20; skip < total; skip += 100) {
            const fetches = []
            for (let s = skip; s < Math.min(skip + 100, total); s += 20) {
              fetches.push(coll.orderBy('timestamp', 'desc').skip(s).limit(20).get())
            }
            const rest = await Promise.all(fetches)
            rest.forEach(r => {
              all = all.concat(r.data)
            })
          }
        }
      }
      this._txRaw = all
      const nameMap = {}
      ;(this.data.game?.players || []).forEach(p => {
        nameMap[p.openid] = p.nickname
      })
      ;(this.data.game?.removedPlayers || []).forEach(p => {
        if (!nameMap[p.openid]) nameMap[p.openid] = p.nickname
      })
      const buyIn = Number(this.data.game?.buyIn || 0)
      const asc = all.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      const totalHands = {}
      const totalAmount = {}
      const handsMap = {}
      const accHandsMap = {}
      const accAmountMap = {}
      asc.forEach(t => {
        const isBuy =
          t.type === 'buyIn' || ((t.type === 'rebuy' || t.type === 'addOn') && !t.revoked)
        let h = 0
        if (t.type === 'buyIn') h = Math.max(1, Number(t.meta?.hands) || 1)
        else if (t.type === 'rebuy' || t.type === 'addOn') {
          h =
            Number(t.meta?.hands) ||
            (buyIn > 0 ? Math.max(1, Math.round((t.amount || 0) / buyIn)) : 1)
        }
        handsMap[t._id] = h
        if (isBuy) {
          totalHands[t.playerOpenid] = (totalHands[t.playerOpenid] || 0) + h
          totalAmount[t.playerOpenid] = (totalAmount[t.playerOpenid] || 0) + (Number(t.amount) || 0)
        }
        accHandsMap[t._id] = totalHands[t.playerOpenid] || 0
        accAmountMap[t._id] = totalAmount[t.playerOpenid] || 0
      })
      const recentTx = all.slice(0, 80).map(t => {
        const d = t.timestamp ? new Date(t.timestamp) : null
        const timeStr = d
          ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : ''
        const hands = handsMap[t._id] || 0
        const accHands = accHandsMap[t._id] || 0
        return {
          ...t,
          nickname: nameMap[t.playerOpenid] || t.meta?.nickname || '某玩家',
          hands,
          accHands,
          accAmount: accAmountMap[t._id] || 0,
          timeStr,
          typeLabel: TX_TYPE_LABEL[t.type] || '记录',
          typeClass: TX_TYPE_CLASS[t.type] || 'settle',
          detail: transactionDetail(t, hands, accHands)
        }
      })
      this.setData({ recentTx })
      this._lastTxSig = sig
    } catch (err) {
      console.error(err)
    } finally {
      this._txFetching = false
      if (this._txRefreshQueued !== undefined) {
        const queuedForce = this._txRefreshQueued
        delete this._txRefreshQueued
        setTimeout(() => this._fetchRecentTx(queuedForce), 0)
      }
    }
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
      let txNamesChanged = false
      const recentTx = (this.data.recentTx || []).map(tx => {
        const nickname = latestNames[tx.playerOpenid] || tx.nickname
        if (nickname === tx.nickname) return tx
        txNamesChanged = true
        return { ...tx, nickname }
      })
      if (txNamesChanged) patch.recentTx = recentTx
      this.setData(patch)
      cacheGame(game)
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
    const players = (game.players || []).map(p =>
      p.openid === openid ? { ...p, ...patch(p) } : p
    )
    const nextGame = { ...game, players }
    if (extraSet['game.totalPot'] !== undefined) nextGame.totalPot = extraSet['game.totalPot']
    const settleStatus = this._getSettleStatus(nextGame)
    this._renderSignature = this._gameSignature(nextGame)
    this.setData({ 'game.players': players, ...extraSet, ...settleStatus })
    cacheGame(nextGame)
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (_) {}
  },

  _applyOptimisticBuy(openid, amount, hands) {
    if (!this.data.game) return
    this._patchPlayer(
      openid,
      p => ({
        buyInCount: (p.buyInCount || 0) + hands,
        totalBuyIn: (p.totalBuyIn || 0) + amount,
        currentStack: (p.currentStack || 0) + amount,
        eliminatedAt: null
      }),
      { 'game.totalPot': (Number(this.data.game.totalPot) || 0) + amount }
    )
  },

  async _record(type, playerOpenid, amount = 0, extra = {}) {
    if (this._recording) return
    this._recording = true
    const optimistic = (type === 'rebuy' || type === 'addOn') && !!this.data.game
    if (optimistic) {
      this._applyOptimisticBuy(playerOpenid, amount, Math.max(1, Number(extra.hands) || 1))
    } else {
      wx.showLoading({ title: '处理中…' })
    }
    try {
      const operationId = createOperationId(type)
      const res = await wx.cloud.callFunction({
        name: 'recordTransaction',
        data: { gameId: this.data.gameId, type, playerOpenid, amount, operationId, ...extra }
      })
      if (!optimistic) wx.hideLoading()
      if (!res.result || !res.result.ok) {
        const err = res.result && res.result.error
        const msg =
          {
            NOT_HOST: '仅庄家可操作',
            CAN_ONLY_BUY_FOR_SELF: '只能给自己补码',
            GAME_ENDED: '牌局已结束',
            CONFLICT_RETRY: '操作冲突，请重试'
          }[err] ||
          err ||
          '操作失败'
        wx.showToast({ title: msg, icon: 'none' })
        if (optimistic) this._fetchGameOnce()
      } else {
        this._fetchRecentTx()
      }
    } catch (err) {
      if (!optimistic) wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
      if (optimistic) this._fetchGameOnce()
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
          this._promptAmount('补码', openid, 'rebuy')
        } else if (action === 'settle') {
          this._doSettle(openid, player)
        } else if (action === 'rebuy') {
          this._promptAmount('帮他补码', openid, 'rebuy')
        } else if (action === 'eliminate') {
          this._confirmEliminate(openid)
        }
      }
    })
  },

  _doSettle(openid, player) {
    const hasExisting = player.finalStack !== null && player.finalStack !== undefined
    wx.showModal({
      title: hasExisting ? '修改结算筹码' : '结算筹码',
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
        // 乐观上屏：本地先记下桌筹码，失败再回拉
        this._applyOptimisticCheckout(openid, finalStack)
        try {
          const res = await wx.cloud.callFunction({
            name: 'settleGame',
            data: {
              gameId: this.data.gameId,
              mode: 'checkout',
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
                CONFLICT_RETRY: '操作冲突，请重试'
              }[res.result?.error] ||
              res.result?.error ||
              '操作失败'
            wx.showToast({ title: msg, icon: 'none' })
            this._fetchGameOnce()
            return
          }
          wx.showToast({
            title: res.result.justEnded ? '全员结算完成，已收局' : '已记录',
            icon: 'success'
          })
          this._fetchRecentTx()
        } catch (err) {
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
          this._fetchGameOnce()
        }
      }
    })
  },

  _applyOptimisticCheckout(openid, finalStack) {
    this._patchPlayer(openid, p => ({
      finalStack,
      profit: finalStack - (p.totalBuyIn || 0),
      currentStack: finalStack
    }))
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
    this._promptAmount('帮他补码', e.detail.openid, 'rebuy')
  },
  onAddOn(e) {
    this._promptAmount('代补 (Add-on)', e.detail.openid, 'addOn')
  },
  onSelfRebuy(e) {
    this._promptAmount('补码', e.detail.openid, 'rebuy')
  },

  onRevokeTx(e) {
    const txId = e.currentTarget.dataset.id
    wx.showModal({
      title: '撤销该笔补码',
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
          if (!res.result?.ok)
            wx.showToast({ title: res.result?.error || '撤销失败', icon: 'none' })
          else {
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
    const buyIn = Number(this.data.game.buyIn || 0)
    this.setData({ 'handsPicker.show': false })
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
        expenseMode: normalizeExpenseMode(game.expenseMode || game.aaMode || 'all'),
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
            CONFLICT_RETRY: '操作冲突，请重试'
          }[res.result?.error] ||
          res.result?.error ||
          '操作失败'
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
      this.setData({ 'expensePanel.show': false })
      wx.showToast({ title: '已保存', icon: 'success' })
      this._fetchGameOnce()
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
          profit: hasFinalStack
            ? finalStack - totalBuyIn
            : Number(p.finalProfit ?? p.profit) || 0
        }
      })
    const transfers = settle(profitList.map(p => ({ nickname: p.nickname, profit: p.profit })))
    let shares = []
    if (extraCost > 0) {
      // 服务端已把费用单落在 players[].share（权威）；无则本地按方式计算兜底
      const serverShares = players
        .filter(p => !p.eliminatedAt && Number(p.share) > 0)
        .map(p => ({ openid: p.openid, nickname: p.nickname || '玩家', share: Number(p.share) }))
      shares = serverShares.length ? serverShares : computeShares(profitList, extraCost, expenseMode)
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
    const quote =
      this.data.settleResult?.quote ||
      SUNZI[Math.floor(Math.random() * SUNZI.length)] || { text: '', from: '' }
    const gameName =
      (Array.isArray(gameOrPlayers) ? this.data.game?.name : gameOrPlayers?.name) || 'StaxKit 牌局'
    const endedDate = new Date(rawGame?.endedAt || rawGame?.startedAt || Date.now())
    const dateStr = `${endedDate.getFullYear()}-${String(endedDate.getMonth() + 1).padStart(2, '0')}-${String(endedDate.getDate()).padStart(2, '0')}`
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
        dateStr
      },
      settleWinnerOpenid: winner?.openid || ''
    }
  },

  _buildSettleResult(gameOrPlayers) {
    this.setData(this._createSettleResult(gameOrPlayers))
  },

  async onJoinAsPlayer() {
    if (this.data.joining) return
    if (!this.data.game) return
    await app.globalData.openidReady
    await app.refreshCurrentUser()
    const profile = readLocalProfile(app.globalData.openid) || {}
    if (!isMeaningfulNickname(profile.nickname)) {
      wx.showModal({
        title: '先完善资料',
        content: '设置昵称和头像后，牌友才能认出你',
        confirmText: '去设置',
        success: r => {
          if (r.confirm) wx.navigateTo({ url: '/pages/profile/profile?firstTime=1' })
        }
      })
      return
    }
    const code = this.data.inviteCode || this.data.game?.inviteCode
    if (!code) {
      wx.showToast({ title: '无法获取邀请码，请重新分享', icon: 'none' })
      return
    }
    wx.showModal({
      title: '上桌几手？',
      editable: true,
      placeholderText: '1',
      content: `每手 ${this.data.game.buyIn} 筹码`,
      confirmText: '上桌',
      success: async r => {
        if (!r.confirm) return
        const hands = Math.max(1, Math.floor(Number(r.content || 1) || 1))
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
          const { ok, error, alreadyJoined } = res.result || {}
          if (!ok) {
            const msg =
              {
                GAME_NOT_FOUND: '牌局已结束',
                PROFILE_REQUIRED: '请先完善真实昵称',
                CONFLICT_RETRY: '操作冲突，请重试'
              }[error] ||
              error ||
              '上桌失败'
            wx.showToast({ title: msg, icon: 'none' })
            return
          }
          if (alreadyJoined) wx.showToast({ title: '你已经在桌上', icon: 'none' })
          this.setData({ viewerMode: false })
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        } finally {
          this.setData({ joining: false })
        }
      }
    })
  },

  onShare() {
    wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage'] })
  },

  onShareAppMessage() {
    const g = this.data.game
    const playerN = g?.players?.length || 0
    const pot = g?.totalPot || 0
    return {
      title: `「${g?.name || 'StaxKit 牌局'}」${playerN} 人在打，总池 ${pot}`,
      path:
        '/pages/game-detail/game-detail?id=' +
        this.data.gameId +
        '&code=' +
        (g?.inviteCode || '') +
        '&mode=viewer',
      imageUrl: '' // 可后续加结算图作为分享图
    }
  }
})
