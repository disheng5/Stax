// utils/avatar.js — 头像跨页缓存，消除开页闪烁
//
// 头像统一以 cloud:// fileID 存库；展示层把 fileID 映射到短期可显示 URL 并本地缓存，
// 下次进房间直接用缓存 URL 首帧显示，再后台校正最新资料，避免默认头像闪烁。
//
// 本模块只解决「老数据里 game.players 未存 avatar、需按 openid 回查」的场景：
// 把 openid→{avatar, nickname} 持久缓存，开页【同步】命中，避免每次都发 getAvatars。
// cloud:// 是稳定 fileID（非临时链接），资料缓存 12h；显示 URL 缓存较短，过期自动刷新。

const STORE_KEY = 'avatar_by_openid_v1'
const URL_STORE_KEY = 'avatar_display_url_v1'
const TTL = 12 * 60 * 60 * 1000
const URL_TTL = 50 * 60 * 1000

let mem = null
let urlMem = null

function _load() {
  if (mem) return mem
  try {
    mem = wx.getStorageSync(STORE_KEY) || {}
  } catch (_) {
    mem = {}
  }
  return mem
}

function _save() {
  const now = Date.now()
  Object.keys(mem).forEach(k => {
    if (now - mem[k].ts > TTL * 2) delete mem[k]
  })
  try {
    wx.setStorageSync(STORE_KEY, mem)
  } catch (_) {}
}

function _loadUrls() {
  if (urlMem) return urlMem
  try {
    urlMem = wx.getStorageSync(URL_STORE_KEY) || {}
  } catch (_) {
    urlMem = {}
  }
  return urlMem
}

function _saveUrls() {
  const now = Date.now()
  Object.keys(urlMem).forEach(k => {
    if (now - urlMem[k].ts > URL_TTL * 2) delete urlMem[k]
  })
  try {
    wx.setStorageSync(URL_STORE_KEY, urlMem)
  } catch (_) {}
}

// 同步：命中返回 { avatar, nickname }，未命中返回 null
function cached(openid) {
  const c = _load()[openid]
  return c ? { avatar: c.avatar, nickname: c.nickname } : null
}

function putProfiles(profiles) {
  const list = profiles || []
  if (!list.length) return
  const m = _load()
  list.forEach(p => {
    if (!p || !p.openid) return
    m[p.openid] = {
      avatar: p.avatar || '',
      nickname: p.nickname || '',
      ts: Date.now()
    }
  })
  _save()
}

function isStale(openid) {
  const c = _load()[openid]
  return !c || Date.now() - c.ts > TTL
}

// 异步：批量回查未缓存/过期的 openid（走 getAvatars），写缓存，返回 openid->{avatar,nickname}
async function resolve(openids, options = {}) {
  const uniq = [...new Set((openids || []).filter(Boolean))]
  const m = _load()
  const need = options.force ? uniq : uniq.filter(isStale)
  if (need.length) {
    try {
      const res = await wx.cloud.callFunction({ name: 'getAvatars', data: { openids: need } })
      const av = (res.result && res.result.avatars) || {}
      const nk = (res.result && res.result.nicknames) || {}
      need.forEach(o => {
        m[o] = { avatar: av[o] || '', nickname: nk[o] || '', ts: Date.now() }
      })
      _save()
    } catch (_) {}
  }
  const out = {}
  uniq.forEach(o => {
    if (m[o]) out[o] = { avatar: m[o].avatar, nickname: m[o].nickname }
  })
  return out
}

function displayCached(fileID) {
  if (!fileID || !fileID.startsWith('cloud://')) return fileID || ''
  const c = _loadUrls()[fileID]
  if (!c || !c.url || Date.now() - c.ts > URL_TTL) return ''
  return c.url
}

async function resolveDisplayUrls(fileIDs) {
  const uniq = [...new Set((fileIDs || []).filter(id => id && id.startsWith('cloud://')))]
  const m = _loadUrls()
  const need = uniq.filter(id => !m[id] || !m[id].url || Date.now() - m[id].ts > URL_TTL)
  if (need.length) {
    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: need.map(fileID => ({ fileID }))
      })
      ;(res.fileList || []).forEach(item => {
        if (item.fileID && item.tempFileURL) {
          m[item.fileID] = { url: item.tempFileURL, ts: Date.now() }
        }
      })
      _saveUrls()
    } catch (_) {}
  }
  const out = {}
  uniq.forEach(id => {
    if (m[id] && m[id].url) out[id] = m[id].url
  })
  return out
}

module.exports = {
  cached,
  putProfiles,
  isStale,
  resolve,
  displayCached,
  resolveDisplayUrls
}
