// cloudfunctions/seedTerms/index.js — 初始化 terms 与 handRanks 集合
// 部署后手动调用一次即可；可重入：会先清空再重新写入
// 注意：云端测试默认 3s 容易超时，所以这里全部用并发批处理。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const terms = require('./seed/terms.json')
const handRanks = require('./seed/handRanks.json')

async function clearCollection(name) {
  let removed = 0
  for (;;) {
    const list = await db.collection(name).limit(100).get().catch(() => ({ data: [] }))
    if (!list.data.length) break
    await Promise.all(list.data.map(doc => db.collection(name).doc(doc._id).remove()))
    removed += list.data.length
  }
  return removed
}

async function bulkInsert(name, rows, concurrency = 30) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency)
    await Promise.all(batch.map(row => db.collection(name).add({ data: row })))
    inserted += batch.length
  }
  return inserted
}

exports.main = async event => {
  const { reset = true, only = 'all' } = event || {}
  const result = { ok: true, mode: only }

  if (reset) {
    if (only === 'all' || only === 'terms') result.termsCleared = await clearCollection('terms')
    if (only === 'all' || only === 'handRanks') result.handRanksCleared = await clearCollection('handRanks')
  }

  if (only === 'all' || only === 'terms') result.termsInserted = await bulkInsert('terms', terms)
  if (only === 'all' || only === 'handRanks') result.handRanksInserted = await bulkInsert('handRanks', handRanks)

  return result
}
