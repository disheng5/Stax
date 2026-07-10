// utils/avatar.js — 跨页用户资料缓存
// users 表是权威数据；game.players / season.rankings 只是可秒显的历史快照。
// 快照只补空值，不允许反向覆盖刚从 users 查到的新昵称或头像。

const STORE_KEY = 'profile_by_openid_v2'
const URL_STORE_KEY = 'avatar_display_url_v2'
const TTL = 5 * 60 * 1000
const RETAIN_TTL = 7 * 24 * 60 * 60 * 1000
const URL_DEFAULT_TTL = 110 * 60 * 1000
const URL_RETAIN_TTL = 24 * 60 * 60 * 1000
const GENERIC_NICKNAMES = new Set(['玩家', '庄家', '微信用户', '未设置昵称'])

let mem = null
let urlMem = null
let resolveInFlight = null
let urlResolveInFlight = null
const missUntil = {}

function meaningfulNickname(value) {
  const nickname = typeof value === 'string' ? value.trim() : ''
  return !!nickname && !GENERIC_NICKNAMES.has(nickname)
}

function timestamp(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  const n = +new Date(value)
  return Number.isFinite(n) ? n : 0
}

function _load() {
  if (mem) return mem
  try {
    mem = wx.getStorageSync(STORE_KEY) || {}
    if (!Object.keys(mem).length) {
      const legacy = wx.getStorageSync('avatar_by_openid_v1') || {}
      Object.keys(legacy).forEach(openid => {
        const item = legacy[openid] || {}
        if (!meaningfulNickname(item.nickname) && !item.avatar) return
        mem[openid] = {
          nickname: meaningfulNickname(item.nickname) ? item.nickname.trim() : '',
          avatar: item.avatar || '',
          updatedAt: '',
          source: 'snapshot',
          ts: item.ts || 0
        }
      })
    }
  } catch (_) {
    mem = {}
  }
  return mem
}

function _save() {
  const now = Date.now()
  Object.keys(mem).forEach(k => {
    if (now - (mem[k].ts || 0) > RETAIN_TTL) delete mem[k]
  })
  try {
    wx.setStorageSync(STORE_KEY, mem)
  } catch (_) {}
}

function _loadUrls() {
  if (urlMem) return urlMem
  try {
    urlMem = wx.getStorageSync(URL_STORE_KEY) || wx.getStorageSync('avatar_display_url_v1') || {}
  } catch (_) {
    urlMem = {}
  }
  return urlMem
}

function _saveUrls() {
  const now = Date.now()
  const urls = _loadUrls()
  Object.keys(urls).forEach(fileID => {
    const item = urls[fileID] || {}
    const expiresAt = item.expiresAt || (item.ts || 0) + URL_DEFAULT_TTL
    if (!item.url || now - expiresAt > URL_RETAIN_TTL) delete urls[fileID]
  })
  try {
    wx.setStorageSync(URL_STORE_KEY, urls)
  } catch (_) {}
}

// 同步首帧命中；即使需要后台校正，也保留旧资料避免页面闪空。
function cached(openid) {
  const c = _load()[openid]
  return c
    ? {
      avatar: c.avatar || '',
      nickname: c.nickname || '',
      updatedAt: c.updatedAt || '',
      source: c.source || 'snapshot'
    }
    : null
}

function putProfiles(profiles, options = {}) {
  const list = profiles || []
  if (!list.length) return
  const m = _load()
  const now = Date.now()
  const source = options.source || 'snapshot'
  const authoritative = !!options.authoritative || source === 'server' || source === 'self'
  let changed = false
  list.forEach(p => {
    if (!p || !p.openid) return
    const prev = m[p.openid] || null
    const incomingVersion = timestamp(p.updatedAt || p.profileUpdatedAt)
    const previousVersion = timestamp(prev && prev.updatedAt)
    const newer = incomingVersion > 0 && incomingVersion >= previousVersion
    const canReplace = authoritative || newer || !prev || (prev.source || 'snapshot') === 'snapshot'
    const incomingName = meaningfulNickname(p.nickname) ? p.nickname.trim() : ''
    const previousName = prev && meaningfulNickname(prev.nickname) ? prev.nickname : ''
    const incomingAvatar = p.avatar || ''
    const next = {
      nickname: canReplace && incomingName ? incomingName : previousName || incomingName,
      avatar: canReplace && incomingAvatar ? incomingAvatar : (prev && prev.avatar) || incomingAvatar,
      updatedAt:
        incomingVersion >= previousVersion
          ? p.updatedAt || p.profileUpdatedAt || (prev && prev.updatedAt) || ''
          : (prev && prev.updatedAt) || '',
      source: authoritative ? source : (prev && prev.source) || source,
      ts: authoritative ? now : (prev && prev.ts) || now
    }
    if (!next.nickname && !next.avatar && !prev) return
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
      m[p.openid] = next
      changed = true
    }
  })
  if (changed) _save()
}

function isStale(openid) {
  const c = _load()[openid]
  return !c || c.source === 'snapshot' || Date.now() - (c.ts || 0) > TTL
}

async function _fetchProfiles(openids) {
  const res = await wx.cloud.callFunction({ name: 'getAvatars', data: { openids } })
  const result = res && res.result
  if (!result || result.ok === false) {
    throw new Error((result && result.error) || 'GET_PROFILES_FAILED')
  }
  const profiles = result.profiles || {}
  const avatars = result.avatars || {}
  const nicknames = result.nicknames || {}
  const found = []
  openids.forEach(openid => {
    const p = profiles[openid] || {}
    const nickname = p.nickname || nicknames[openid] || ''
    const avatar = p.avatar || avatars[openid] || ''
    if (!nickname && !avatar) {
      missUntil[openid] = Date.now() + 30000
      return
    }
    found.push({
      openid,
      nickname,
      avatar,
      updatedAt: p.updatedAt || ''
    })
  })
  putProfiles(found, { source: 'server', authoritative: true })
}

// 异步后台校正。失败时保留旧快照，不把空结果写入长缓存。
async function resolve(openids, options = {}) {
  const uniq = [...new Set((openids || []).filter(Boolean))]
  let need = (options.force ? uniq : uniq.filter(isStale)).filter(
    openid => options.force || !missUntil[openid] || missUntil[openid] <= Date.now()
  )
  if (need.length) {
    try {
      if (resolveInFlight) {
        await resolveInFlight
        need = need.filter(isStale)
      }
      need = need.filter(
        openid => !missUntil[openid] || missUntil[openid] <= Date.now()
      )
      if (need.length) {
        resolveInFlight = _fetchProfiles(need)
        await resolveInFlight
      }
    } catch (err) {
      console.warn('[profile cache resolve]', err)
    } finally {
      resolveInFlight = null
    }
  }
  const m = _load()
  const out = {}
  uniq.forEach(o => {
    if (m[o]) out[o] = cached(o)
  })
  return out
}

function invalidate(openid) {
  const m = _load()
  const staleAt = Date.now() - TTL - 1
  if (openid) {
    if (m[openid]) m[openid].ts = staleAt
    delete missUntil[openid]
  } else {
    Object.keys(m).forEach(key => {
      m[key].ts = staleAt
      delete missUntil[key]
    })
  }
  _save()
}

function clear() {
  mem = {}
  urlMem = {}
  Object.keys(missUntil).forEach(key => delete missUntil[key])
  try {
    wx.removeStorageSync(STORE_KEY)
    wx.removeStorageSync(URL_STORE_KEY)
    wx.removeStorageSync('avatar_display_url_v1')
    wx.removeStorageSync('avatar_by_openid_v1')
  } catch (_) {}
}

function displayCached(fileID) {
  if (!fileID) return ''
  if (!fileID.startsWith('cloud://')) return fileID
  const item = _loadUrls()[fileID]
  if (!item || !item.url) return ''
  const expiresAt = item.expiresAt || (item.ts || 0) + URL_DEFAULT_TTL
  return expiresAt > Date.now() + 30000 ? item.url : ''
}

async function _fetchDisplayUrls(fileIDs) {
  for (let i = 0; i < fileIDs.length; i += 50) {
    const batch = fileIDs.slice(i, i + 50)
    const res = await wx.cloud.getTempFileURL({ fileList: batch })
    const now = Date.now()
    const urls = _loadUrls()
    ;(res.fileList || []).forEach(item => {
      if (item.fileID && item.tempFileURL) {
        const ttl = Number(item.maxAge || URL_DEFAULT_TTL)
        const ttlMs = ttl < 100000 ? ttl * 1000 : ttl
        urls[item.fileID] = {
          url: item.tempFileURL,
          ts: now,
          expiresAt: now + Math.max(5 * 60 * 1000, ttlMs - 5 * 60 * 1000)
        }
      }
    })
    _saveUrls()
  }
}

async function resolveDisplayUrls(fileIDs) {
  const uniq = [...new Set((fileIDs || []).filter(id => id && id.startsWith('cloud://')))]
  let need = uniq.filter(fileID => !displayCached(fileID))
  if (need.length) {
    try {
      if (urlResolveInFlight) {
        await urlResolveInFlight
        need = need.filter(fileID => !displayCached(fileID))
      }
      if (need.length) {
        urlResolveInFlight = _fetchDisplayUrls(need)
        await urlResolveInFlight
      }
    } catch (err) {
      console.warn('[avatar url resolve]', err)
    } finally {
      urlResolveInFlight = null
    }
  }
  const out = {}
  uniq.forEach(fileID => {
    const url = displayCached(fileID)
    if (url) out[fileID] = url
  })
  return out
}

module.exports = {
  cached,
  putProfiles,
  isStale,
  resolve,
  invalidate,
  clear,
  displayCached,
  resolveDisplayUrls,
  meaningfulNickname
}
