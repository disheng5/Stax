// A visible page owns its subscriptions; fallback polling only runs after a channel failure.
function observe(queryFactories, refresh, { fallbackMs = 15000 } = {}) {
  let closed = false,
    watchers = [],
    retry,
    fallback,
    debounce,
    running = false,
    queued = false
  let signatures = []
  let connection = 0
  const run = async () => {
    if (closed) return
    if (running) {
      queued = true
      return
    }
    running = true
    try {
      await refresh()
    } catch (err) {
      console.warn('[live view]', err)
    } finally {
      running = false
      if (queued) {
        queued = false
        schedule()
      }
    }
  }
  const schedule = () => {
    if (closed) return
    clearTimeout(debounce)
    debounce = setTimeout(run, 80)
  }
  const closeWatches = () => {
    watchers.forEach(w => {
      try {
        w?.close()
      } catch (_) {}
    })
    watchers = []
  }
  const connect = () => {
    if (closed) return
    const generation = ++connection
    closeWatches()
    let healthy = new Set()
    const failed = () => {
      if (closed || generation !== connection) return
      if (!fallback) fallback = setInterval(schedule, fallbackMs)
      clearTimeout(retry)
      retry = setTimeout(connect, 8000)
    }
    queryFactories.forEach((factory, i) => {
      try {
        watchers.push(
          factory().watch({
            onChange(snapshot) {
              if (closed || generation !== connection) return
              healthy.add(i)
              if (healthy.size === queryFactories.length) {
                clearInterval(fallback)
                fallback = null
                clearTimeout(retry)
              }
              const signature = JSON.stringify(snapshot.docs || [])
              if (signatures[i] !== undefined && signature !== signatures[i]) schedule()
              signatures[i] = signature
            },
            onError: failed
          })
        )
      } catch (_) {
        failed()
      }
    })
  }
  const network = state => {
    if (state.isConnected && !closed) {
      connect()
      schedule()
    }
  }
  try {
    wx.onNetworkStatusChange(network)
  } catch (_) {}
  connect()
  return () => {
    closed = true
    closeWatches()
    clearTimeout(retry)
    clearTimeout(debounce)
    clearInterval(fallback)
    try {
      wx.offNetworkStatusChange(network)
    } catch (_) {}
  }
}

function liveGamesPage(definition, refresh) {
  const onShow = definition.onShow,
    onHide = definition.onHide,
    onUnload = definition.onUnload
  const stop = function () {
    this._liveVisible = false
    this._closeLive?.()
    this._closeLive = null
  }
  return {
    ...definition,
    onShow(...args) {
      this._liveVisible = true
      const app = getApp()
      Promise.resolve(app.globalData.openidReady).then(() => {
        if (!this._liveVisible || this._closeLive || !app.globalData.openid) return
        const db = wx.cloud.database(),
          openid = app.globalData.openid
        this._closeLive = observe(
          [
            () =>
              db
                .collection('games')
                .where({ players: db.command.elemMatch({ openid }) })
                .orderBy('startedAt', 'desc')
                .field({
                  _id: true,
                  name: true,
                  status: true,
                  stateRevision: true,
                  txRevision: true,
                  players: true,
                  hiddenForOpenids: true,
                  deletedAt: true
                })
                .limit(20),
            () =>
              db
                .collection('users')
                .where({ _openid: openid })
                .field({ _id: true, nickname: true, avatar: true, updatedAt: true, stats: true })
                .limit(20)
          ],
          async () => {
            require('./game-data.js').invalidateGamesCache()
            if (this._liveVisible) await refresh.call(this, openid)
          }
        )
      })
      return onShow?.apply(this, args)
    },
    onHide(...args) {
      stop.call(this)
      return onHide?.apply(this, args)
    },
    onUnload(...args) {
      stop.call(this)
      return onUnload?.apply(this, args)
    }
  }
}
module.exports = { observe, liveGamesPage }
