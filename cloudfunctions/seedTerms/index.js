// cloudfunctions/seedTerms/index.js — 初始化术语词典 + 起手牌表
// 部署后手动执行一次即可
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  // TODO:
  //   1. 读取 seed/terms.json（50 条）→ 批量写入 terms 集合
  //   2. 读取 seed/handRanks.json（169 条）→ 批量写入 handRanks 集合
  //   3. 返回 { termsInserted, handsInserted }
  return { ok: true, todo: 'seedTerms skeleton — fill 50 terms next' }
}
