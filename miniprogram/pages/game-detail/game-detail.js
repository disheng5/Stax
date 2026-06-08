// pages/game-detail/game-detail.js — 牌局详情（核心页）
const app = getApp()

const TX_TYPE_LABEL = {
  buyIn: '初次买入',
  rebuy: 'Rebuy',
  addOn: 'Add-on',
  eliminate: '淘汰',
  settle: '结算',
  settlePartial: '下桌'
}

Page({
  data: {
    gameId: '',
    inviteCode: '',
    game: null,
    isHost: false,
    myOpenid: '',
    loading: true,
    recentTx: [],
    txTypeLabel: TX_TYPE_LABEL,
    viewerMode: false,
    isPlayer: false,
    joining: false,
    handsPicker: { show: false, title: '', openid: '', type: '', hands: 1 },
    allCheckedOut: false,
    settleDiff: 0
  },

  async onLoad(options) {
    this.setData({
      gameId: options.id || '',
      inviteCode: (options.code || '').toUpperCase(),
      viewerMode: options.mode === 'viewer'
    })
    await this._ensureOpenid()
    this._startWatch()
  },

  onShow() {
    if (!this.watcher && this.data.gameId) this._startWatch()
    if (this.data.game && this.data.myOpenid) {
      const isPlayer = (this.data.game.players || []).some(p => p.openid === this.data.myOpenid)
      if (isPlayer && this.data.viewerMode) {
        this.setData({ viewerMode: false, isPlayer: true })
      }
    }
  },

  onUnload() {
    clearTimeout(this._watchRetryTimer)
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch (_) {}
      this.watcher = null
    }
  },

  async _ensureOpenid() {
    if (app.globalData.openid) {
      this.setData({ myOpenid: app.globalData.openid })
      return
    }
    try {
      const res = await wx.cloud.callFunction({ name: 'whoami', data: {} })
      if (res?.result?.openid) {
        app.globalData.openid = res.result.openid
        this.setData({ myOpenid: res.result.openid })
      }
    } catch (err) {
      console.error('[whoami]', err)
    }
  },

  _startWatch() {
    const db = wx.cloud.database()
    if (!this.data.gameId) {
      this.setData({ loading: false })
      return
    }
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch (_) {}
      this.watcher = null
    }
    this._watchRetries = this._watchRetries || 0
    this.watcher = db
      .collection('games')
      .doc(this.data.gameId)
      .watch({
        onChange: snapshot => {
          this._watchRetries = 0
          if (snapshot.docs && snapshot.docs.length) {
            const game = snapshot.docs[0]
            const myOpenid = this.data.myOpenid
            const isHost = !!myOpenid && game.hostOpenid === myOpenid
            const isPlayer = !!myOpenid && (game.players || []).some(p => p.openid === myOpenid)
            this.setData({ game, isHost, isPlayer, viewerMode: !isPlayer, loading: false })
            this._computeSettleStatus(game)
            this._resolveAvatars(game.players)
            this._fetchRecentTx()
          } else {
            this.setData({ game: null, loading: false })
          }
        },
        onError: err => {
          console.error('[watch] error', err)
          this.setData({ loading: false })
          this.watcher = null
          if (this._watchRetries < 3) {
            this._watchRetries++
            const delay = this._watchRetries * 2000
            clearTimeout(this._watchRetryTimer)
            this._watchRetryTimer = setTimeout(() => this._startWatch(), delay)
          } else {
            wx.showToast({ title: '同步连接断开，请刷新页面', icon: 'none', duration: 3000 })
          }
        }
      })
  },

  _computeSettleStatus(game) {
    const players = game.players || []
    const checkedOut = players.filter(p => p.finalStack !== null && p.finalStack !== undefined)
    const allCheckedOut = players.length > 0 && checkedOut.length === players.length
    let settleDiff = 0
    if (allCheckedOut) {
      settleDiff = players.reduce((s, p) => s + (p.finalStack - p.totalBuyIn), 0)
    }
    this.setData({ allCheckedOut, settleDiff })
  },

  async _fetchRecentTx() {
    if (!this.data.gameId) return
    try {
      const db = wx.cloud.database()
      const all = []
      for (let skip = 0; skip < 500; skip += 20) {
        const r = await db
          .collection('transactions')
          .where({ gameId: this.data.gameId })
          .orderBy('timestamp', 'desc')
          .skip(skip)
          .limit(20)
          .get()
        all.push(...r.data)
        if (r.data.length < 20) break
      }
      const nameMap = {}
      ;(this.data.game?.players || []).forEach(p => {
        nameMap[p.openid] = p.nickname
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
        if (t.type === 'buyIn') h = 1
        else if ((t.type === 'rebuy' || t.type === 'addOn') && !t.revoked) {
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
      const recentTx = all.map(t => {
        const d = t.timestamp ? new Date(t.timestamp) : null
        const timeStr = d
          ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          : ''
        return {
          ...t,
          nickname: nameMap[t.playerOpenid] || '某玩家',
          hands: handsMap[t._id] || 0,
          accHands: accHandsMap[t._id] || 0,
          accAmount: accAmountMap[t._id] || 0,
          timeStr
        }
      })
      this.setData({ recentTx })
    } catch (err) {
      console.error(err)
    }
  },

  async _resolveAvatars(players) {
    if (!this._resolvedAvatars) this._resolvedAvatars = {}
    const needTempUrl = []
    const needFetch = []

    ;(players || []).forEach(p => {
      if (p.avatar && p.avatar.startsWith('cloud://')) {
        if (!this._resolvedAvatars[p.avatar]) needTempUrl.push(p.avatar)
      } else if (!p.avatar || p.avatar === '/images/default-avatar.png') {
        if (!this._resolvedAvatars['fetched_' + p.openid]) needFetch.push(p.openid)
      }
    })

    const tasks = []

    if (needTempUrl.length) {
      const unique = [...new Set(needTempUrl)]
      tasks.push(
        wx.cloud
          .getTempFileURL({ fileList: unique })
          .then(res => {
            ;(res.fileList || []).forEach(f => {
              if (f.tempFileURL) this._resolvedAvatars[f.fileID] = f.tempFileURL
            })
          })
          .catch(() => {})
      )
    }

    if (needFetch.length) {
      const unique = [...new Set(needFetch)]
      tasks.push(
        wx.cloud
          .callFunction({ name: 'getAvatars', data: { openids: unique } })
          .then(res => {
            const avatarMap = (res.result && res.result.avatars) || {}
            Object.keys(avatarMap).forEach(openid => {
              this._resolvedAvatars['fetched_' + openid] = avatarMap[openid] || ''
            })
            unique.forEach(openid => {
              if (!this._resolvedAvatars['fetched_' + openid]) {
                this._resolvedAvatars['fetched_' + openid] = ''
              }
            })
          })
          .catch(() => {
            needFetch.forEach(openid => {
              this._resolvedAvatars['fetched_' + openid] = ''
            })
          })
      )
    }

    if (tasks.length) await Promise.all(tasks)

    const updated = (this.data.game?.players || []).map(p => {
      if (p.avatar && p.avatar.startsWith('cloud://') && this._resolvedAvatars[p.avatar]) {
        return { ...p, avatar: this._resolvedAvatars[p.avatar] }
      }
      if (!p.avatar || p.avatar === '/images/default-avatar.png') {
        const fetched = this._resolvedAvatars['fetched_' + p.openid]
        if (fetched) return { ...p, avatar: fetched }
      }
      return p
    })

    const hasChange = updated.some(
      (p, i) => p.avatar !== (this.data.game?.players || [])[i]?.avatar
    )
    if (hasChange) this.setData({ 'game.players': updated })
  },

  // ===== 操作 =====
  async _record(type, playerOpenid, amount = 0, extra = {}) {
    if (this._recording) return
    this._recording = true
    wx.showLoading({ title: '处理中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'recordTransaction',
        data: { gameId: this.data.gameId, type, playerOpenid, amount, ...extra }
      })
      wx.hideLoading()
      if (!res.result || !res.result.ok) {
        const err = res.result && res.result.error
        const msg =
          {
            NOT_HOST: '仅庄家可操作',
            CAN_ONLY_BUY_FOR_SELF: '只能给自己补码',
            GAME_ENDED: '牌局已结束'
          }[err] ||
          err ||
          '操作失败'
        wx.showToast({ title: msg, icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this._recording = false
    }
  },

  onPlayerTap(e) {
    const { openid, player, isSelf, isHost } = e.detail
    if (this.data.game?.status !== 'ongoing') return
    if (player.eliminatedAt) return
    if (this.data.viewerMode) return

    const canSelfOp = this.data.game?.playerOpsShared !== false
    const items = []
    const actions = []

    if (isSelf && canSelfOp) {
      if (player.finalStack === null || player.finalStack === undefined) {
        items.push('买入')
        actions.push('selfrebuy')
        items.push('结算')
        actions.push('settleself')
      } else {
        items.push('改码')
        actions.push('settleself')
        items.push('买入')
        actions.push('selfrebuy')
      }
    } else if (this.data.isHost) {
      items.push('帮他补码')
      actions.push('rebuy')
      items.push('帮他结算')
      actions.push('settleother')
      items.push('踢人')
      actions.push('eliminate')
    } else {
      return
    }

    wx.showActionSheet({
      itemList: items,
      success: res => {
        const action = actions[res.tapIndex]
        if (action === 'selfrebuy') {
          this._promptAmount('补码', openid, 'rebuy')
        } else if (action === 'settleself' || action === 'settleother') {
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
        wx.showLoading({ title: '记录中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'settleGame',
            data: {
              gameId: this.data.gameId,
              mode: 'checkout',
              finalStacks: { [openid]: finalStack }
            }
          })
          wx.hideLoading()
          if (!res.result?.ok) {
            wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
            return
          }
          wx.showToast({ title: '已记录', icon: 'success' })
        } catch (err) {
          wx.hideLoading()
          console.error(err)
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
  },

  _confirmEliminate(openid) {
    wx.showModal({
      title: '踢出该玩家',
      content: '该玩家将不再参与本局结算，确认踢人？',
      confirmText: '踢人',
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
            data: { gameId: this.data.gameId, type: 'revoke', txId }
          })
          wx.hideLoading()
          if (!res.result?.ok)
            wx.showToast({ title: res.result?.error || '撤销失败', icon: 'none' })
          else {
            wx.showToast({ title: '已撤销', icon: 'success' })
            this._fetchRecentTx()
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

  onEndGame() {
    if (!this.data.isPlayer || this.data.viewerMode) {
      wx.showToast({ title: '上桌玩家才能发起结算', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/game-settle/game-settle?id=' + this.data.gameId })
  },

  async onJoinAsPlayer() {
    if (this.data.joining) return
    if (!this.data.game) return
    const { readLocalProfile } = require('../../utils/user.js')
    const profile = readLocalProfile() || {}
    if (!profile.nickname) {
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
    const code = this.data.inviteCode || this.data.game.inviteCode
    if (!code) {
      wx.showToast({ title: '缺少邀请码', icon: 'none' })
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
            wx.showToast({
              title: error === 'GAME_NOT_FOUND' ? '牌局已结束' : error || '上桌失败',
              icon: 'none'
            })
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

  async onToggleExclude() {
    const exclude = !this.data.game.excludeFromSeason
    const action = exclude ? '排除' : '恢复'
    wx.showModal({
      title: `${action}本局`,
      content: exclude ? '该局将不计入圈子赛季积分。' : '该局将重新计入圈子赛季积分。',
      confirmText: action,
      success: async r => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中…' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'excludeGame',
            data: { gameId: this.data.gameId, exclude }
          })
          wx.hideLoading()
          if (res.result?.ok) wx.showToast({ title: `已${action}` })
          else wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
        } catch (_) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常', icon: 'none' })
        }
      }
    })
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
