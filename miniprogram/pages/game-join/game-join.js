// pages/game-join/game-join.js — 加入朋友局积分记录
const { isMeaningfulNickname, readLocalProfile } = require('../../utils/user.js')
const { cacheGame } = require('../../utils/game-data.js')
const app = getApp()

Page({
  data: {
    code: '',
    game: null,
    loadingGame: false,
    submitting: false
  },

  onLoad(options) {
    if (options.code) {
      const code = String(options.code).toUpperCase()
      this.setData({ code })
      this._loadGameByCode(code)
    }
  },

  onUnload() { this._unloaded = true },

  async _loadGameByCode(code) {
    if (!/^[A-Z0-9]{6}$/.test(code)) return
    this.setData({ loadingGame: true })
    try {
      await app.globalData.openidReady
      const db = wx.cloud.database()
      // 先查进行中，再查已结束（新分享直达支持结束局回看）
      let res = await db
        .collection('games')
        .where({ inviteCode: code, status: 'ongoing' })
        .limit(1)
        .get()
      if (!res.data.length) {
        res = await db
          .collection('games')
          .where({ inviteCode: code, status: 'ended' })
          .orderBy('endedAt', 'desc')
          .limit(1)
          .get()
      }
      const game = res.data[0] || null
      if (game) {
        // 通过 getGameView 做身份裁剪与鉴权判断
        const gv = await wx.cloud
          .callFunction({
            name: 'getGameView',
            data: { gameId: game._id, inviteCode: code }
          })
          .catch(() => null)
        const view = gv && gv.result
        if (view && view.ok && view.role === 'player') {
          // 已是参与者直接跳转
          cacheGame(game)
          wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${game._id}` })
          return
        }
        if (view && view.ok && view.role === 'viewerEnded') {
          // 已结束局的受分享人直接跳转（观看）
          cacheGame(game)
          wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${game._id}&mode=viewer` })
          return
        }
      }
      this.setData({ game })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '积分记录加载失败', icon: 'none' })
    } finally {
      this.setData({ loadingGame: false })
    }
  },

  onJoinAsPlayer() {
    this._join('player')
  },

  onJoinAsViewer() {
    this._join('viewer')
  },

  async _join(mode) {
    if (this.data.submitting || this._profileJoining) return
    if (!/^[A-Z0-9]{6}$/.test(this.data.code)) {
      wx.showToast({ title: '邀请信息无效，请让好友重新分享', icon: 'none' })
      return
    }

    await app.globalData.openidReady
    const profile = readLocalProfile(app.globalData.openid)
    if (!isMeaningfulNickname(profile.nickname) && mode === 'player') {
      await this._completeJoinProfile()
      return
    }
    if (isMeaningfulNickname(profile.nickname) && mode === 'player') {
      wx.showModal({
        title: '初始记录几份？',
        editable: true,
        placeholderText: '1',
        content: `每份 ${this.data.game?.buyIn || '?'} 积分`,
        confirmText: '参与',
        success: async r => {
          if (!r.confirm) return
          const hands = Number(r.content || 1)
          if (!Number.isInteger(hands) || hands < 1 || hands > 99) {
            wx.showToast({ title: '请输入1至99之间的整数', icon: 'none' }); return
          }
          await this._doJoin(mode, hands)
        }
      })
      return
    }
    await this._doJoin(mode, 1)
  },

  async _completeJoinProfile(hands = 1) {
    if (this._profileJoining || this._unloaded) return
    this._profileJoining = true
    try {
      const filled = await this.selectComponent('#join-profile').request({ hands, buyIn: this.data.game?.buyIn || 0 })
      if (filled && !this._unloaded) await this._doJoin('player', filled.hands, true)
    } finally { this._profileJoining = false }
  },

  async _doJoin(mode, hands = 1, profileCompleted = false) {
    if (this.data.submitting || this._unloaded) return
    const profile = readLocalProfile(app.globalData.openid)
    this.setData({ submitting: true })
    wx.showLoading({ title: mode === 'viewer' ? '进入中…' : '加入中…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'joinGame',
        data: {
          inviteCode: this.data.code,
          nickname: profile.nickname || '玩家',
          avatar: profile.avatar || '',
          mode,
          hands
        }
      })
      wx.hideLoading()
      const { ok, gameId, game, error, alreadyJoined } = res.result || {}
      if (!ok) {
        if (error === 'PROFILE_REQUIRED' && mode === 'player' && !profileCompleted) {
          this.setData({ submitting: false })
          await this._completeJoinProfile(hands)
          return
        }
        wx.showToast({
          title:
            error === 'GAME_NOT_FOUND'
              ? '邀请已失效或记录已结束'
              : error === 'PROFILE_REQUIRED'
                ? '请先完善真实昵称'
                : '操作失败，请稍后重试',
          icon: 'none'
        })
        return
      }
      if (alreadyJoined) wx.showToast({ title: '您已在该记录中', icon: 'none' })
      const query = mode === 'viewer' ? '&mode=viewer' : ''
      const snapshot = game || (this.data.game?._id === gameId ? this.data.game : null)
      if (snapshot) cacheGame(snapshot)
      wx.redirectTo({ url: `/pages/game-detail/game-detail?id=${gameId}${query}` })
    } catch (err) {
      wx.hideLoading()
      console.error(err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onBack() {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
