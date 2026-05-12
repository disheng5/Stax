// cloudfunctions/seedTerms/index.js — 初始化 terms 与 handRanks 集合
// 部署后手动调用一次即可；可重入：会先清空再重新写入
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const terms = require('./seed/terms.json')
const handRanks = require('./seed/handRanks.json')

async function clearCollection(name) {
  // 云数据库单次最多 1000 条，循环删除
  let removed = 0
  for (;;) {
    const list = await db.collection(name).limit(100).get().catch(() => ({ data: [] }))
    if (!list.data.length) break
    for (const doc of list.data) {
      await db.collection(name).doc(doc._id).remove()
      removed++
    }
  }
  return removed
}

async function bulkInsert(name, rows) {
  let inserted = 0
  for (const row of rows) {
    await db.collection(name).add({ data: row })
    inserted++
  }
  return inserted
}

exports.main = async event => {
  const { reset = true } = event || {}
  const result = {}

  if (reset) {
    result.termsCleared = await clearCollection('terms')
    result.handRanksCleared = await clearCollection('handRanks')
  }

  result.termsInserted = await bulkInsert('terms', terms)
  result.handRanksInserted = await bulkInsert('handRanks', handRanks)
  result.ok = true
  return result
}
