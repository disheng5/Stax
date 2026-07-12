// utils/db-mock.js — 内存版云数据库（API 与 wx.cloud.database() 同形）
// 支持：collection / doc / where (含 elemMatch) / orderBy / skip / limit / get / add / update / remove / count / watch
//
// 用法：
//   const { createMockDb } = require('./db-mock.js')
//   const db = createMockDb({ users:[], games:[], ... })
//   db.collection('games').where({ status:'ongoing' }).get()

function makeId(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function deepClone(o) {
  if (o == null || typeof o !== 'object') return o
  if (o instanceof Date) return new Date(o)
  if (Array.isArray(o)) return o.map(deepClone)
  const out = {}
  for (const k in o) out[k] = deepClone(o[k])
  return out
}

// ===== 命令对象（_.eq / _.gt / _.inc / _.push / _.elemMatch 等的轻量识别） =====
function isCommand(v) {
  return v && typeof v === 'object' && v.__cmd
}
const command = {
  eq: v => ({ __cmd: 'eq', v }),
  neq: v => ({ __cmd: 'neq', v }),
  gt: v => ({ __cmd: 'gt', v }),
  gte: v => ({ __cmd: 'gte', v }),
  lt: v => ({ __cmd: 'lt', v }),
  lte: v => ({ __cmd: 'lte', v }),
  in: v => ({ __cmd: 'in', v }),
  nin: v => ({ __cmd: 'nin', v }),
  exists: v => ({ __cmd: 'exists', v }),
  elemMatch: v => ({ __cmd: 'elemMatch', v }),
  inc: v => ({ __cmd: 'inc', v }),
  push: v => ({ __cmd: 'push', v }),
  pull: v => ({ __cmd: 'pull', v }),
  remove: () => ({ __cmd: 'remove' }),
  set: v => ({ __cmd: 'set', v }),
  and: (...args) => ({ __cmd: 'and', args }),
  or: (...args) => ({ __cmd: 'or', args })
}

// ===== where 匹配 =====
function matchValue(actual, expected) {
  if (isCommand(expected)) {
    switch (expected.__cmd) {
    case 'eq':
      return actual === expected.v
    case 'neq':
      return actual !== expected.v
    case 'gt':
      return actual > expected.v
    case 'gte':
      return actual >= expected.v
    case 'lt':
      return actual < expected.v
    case 'lte':
      return actual <= expected.v
    case 'in':
      return Array.isArray(expected.v) && expected.v.includes(actual)
    case 'nin':
      return Array.isArray(expected.v) && !expected.v.includes(actual)
    case 'exists':
      return (actual !== undefined) === !!expected.v
    case 'elemMatch':
      if (!Array.isArray(actual)) return false
      return actual.some(item =>
        Object.keys(expected.v).every(k => matchValue(item[k], expected.v[k]))
      )
    case 'and':
      return expected.args.every(c => matchValue(actual, c))
    case 'or':
      return expected.args.some(c => matchValue(actual, c))
    default:
      return false
    }
  }
  if (Array.isArray(expected)) return JSON.stringify(actual) === JSON.stringify(expected)
  if (expected !== null && typeof expected === 'object') {
    return Object.keys(expected).every(k => matchValue(actual?.[k], expected[k]))
  }
  return actual === expected
}

function matchDoc(doc, query) {
  if (!query || !Object.keys(query).length) return true
  return Object.keys(query).every(k => matchValue(doc[k], query[k]))
}

// ===== update 应用命令 =====
function applyUpdate(doc, update) {
  for (const key in update) {
    const val = update[key]
    if (isCommand(val)) {
      const path = key.split('.')
      const last = path.pop()
      let target = doc
      for (const p of path) {
        if (!target[p]) target[p] = {}
        target = target[p]
      }
      switch (val.__cmd) {
      case 'inc':
        target[last] = (target[last] || 0) + val.v
        break
      case 'push':
        if (!Array.isArray(target[last])) target[last] = []
        target[last].push(...(Array.isArray(val.v) ? val.v : [val.v]))
        break
      case 'pull':
        if (Array.isArray(target[last]))
          target[last] = target[last].filter(x => !matchValue(x, val.v))
        break
      case 'remove':
        delete target[last]
        break
      case 'set':
        target[last] = val.v
        break
      default:
        target[last] = val
      }
    } else if (key.includes('.')) {
      const path = key.split('.')
      const last = path.pop()
      let target = doc
      for (const p of path) {
        if (!target[p]) target[p] = {}
        target = target[p]
      }
      target[last] = val
    } else {
      doc[key] = val
    }
  }
}

// ===== 创建 db =====
function createMockDb(seed) {
  // 浅克隆所有集合到内存（仅取数组字段，跳过 MY_OPENID 等元数据）
  const collections = {}
  for (const name in seed) {
    if (Array.isArray(seed[name])) collections[name] = seed[name].map(deepClone)
  }
  const meta = { MY_OPENID: seed.MY_OPENID }

  const watchers = {} // gameId 之类的 docId → [callbacks]

  function notify(name, docId) {
    const key = name + '/' + docId
    const cbs = watchers[key] || []
    const doc = (collections[name] || []).find(d => d._id === docId)
    cbs.forEach(cb => {
      try {
        cb({ docs: doc ? [deepClone(doc)] : [], type: 'init' })
      } catch (e) {
        console.error(e)
      }
    })
  }

  function collection(name) {
    if (!collections[name]) collections[name] = []
    return new Query(name)
  }

  class Query {
    constructor(name) {
      this._name = name
      this._where = {}
      this._orderBy = []
      this._limit = 100
      this._skip = 0
      this._docId = null
    }
    doc(id) {
      this._docId = id
      return this
    }
    where(q) {
      this._where = { ...this._where, ...q }
      return this
    }
    orderBy(f, dir = 'asc') {
      this._orderBy.push({ f, dir })
      return this
    }
    limit(n) {
      this._limit = n
      return this
    }
    skip(n) {
      this._skip = n
      return this
    }

    _filter() {
      let list = collections[this._name] || []
      if (this._docId) {
        const d = list.find(x => x._id === this._docId)
        return d ? [d] : []
      }
      list = list.filter(d => matchDoc(d, this._where))
      this._orderBy.forEach(({ f, dir }) => {
        list = list.slice().sort((a, b) => {
          const av = a[f],
            bv = b[f]
          const cmp =
            av instanceof Date && bv instanceof Date ? av - bv : av > bv ? 1 : av < bv ? -1 : 0
          return dir === 'desc' ? -cmp : cmp
        })
      })
      list = list.slice(this._skip, this._skip + this._limit)
      return list
    }

    async get() {
      await new Promise(r => setTimeout(r, 30)) // 模拟网络
      const list = this._filter()
      if (this._docId) {
        if (!list.length) throw new Error('document not found')
        return { data: deepClone(list[0]) }
      }
      return { data: list.map(deepClone) }
    }

    async count() {
      const all = (collections[this._name] || []).filter(d => matchDoc(d, this._where))
      return { total: all.length }
    }

    async add({ data }) {
      const doc = { _id: makeId(), _openid: meta.MY_OPENID || 'mock_me', ...deepClone(data) }
      collections[this._name].push(doc)
      return { _id: doc._id }
    }

    // doc(id).set({data}) — 存在则整体覆盖，不存在则按该 _id 新建（upsert）
    async set({ data }) {
      if (!this._docId) throw new Error('set() requires doc(id)')
      const list = collections[this._name]
      const idx = list.findIndex(d => d._id === this._docId)
      const doc = {
        _id: this._docId,
        _openid: meta.MY_OPENID || 'mock_me',
        ...deepClone(data)
      }
      if (idx >= 0) list[idx] = doc
      else list.push(doc)
      return { _id: this._docId, stats: { updated: idx >= 0 ? 1 : 0, created: idx >= 0 ? 0 : 1 } }
    }

    async update({ data }) {
      const list = this._filter()
      list.forEach(d => applyUpdate(d, deepClone(data)))
      // 通知 watcher
      list.forEach(d => notify(this._name, d._id))
      return { stats: { updated: list.length } }
    }

    async remove() {
      const before = collections[this._name].length
      if (this._docId) {
        collections[this._name] = collections[this._name].filter(d => d._id !== this._docId)
      } else {
        collections[this._name] = collections[this._name].filter(d => !matchDoc(d, this._where))
      }
      const removed = before - collections[this._name].length
      return { stats: { removed } }
    }

    watch({ onChange, onError }) {
      if (!this._docId) {
        if (onError) onError(new Error('mock db only supports doc().watch()'))
        return { close() {} }
      }
      const key = this._name + '/' + this._docId
      if (!watchers[key]) watchers[key] = []
      watchers[key].push(onChange)
      // 立即推一次
      setTimeout(() => notify(this._name, this._docId), 10)
      return {
        close: () => {
          watchers[key] = (watchers[key] || []).filter(c => c !== onChange)
        }
      }
    }
  }

  return {
    collection,
    command,
    _raw: collections,
    _notify: notify
  }
}

module.exports = { createMockDb }
