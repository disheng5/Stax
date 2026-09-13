const messages = {
  SEASON_NOT_FOUND: '赛季不存在或不属于当前积分榜',
  NO_ACTIVE_SEASON: '当前无进行中赛季',
  CALC_FAILED: '重算失败，请稍后重试',
  NOT_MEMBER: '你还未加入这个积分榜',
  NOT_OWNER: '仅榜主可操作',
  NOT_HOST: '仅记录创建者可操作',
  NOT_PLAYER: '参与记录后才可操作',
  PLAYER_OPS_DISABLED: '本记录仅允许创建者操作',
  PROFILE_REQUIRED: '请先填写昵称',
  INVALID_NAME: '请检查名称后重试',
  INVALID_CODE: '邀请信息无效，请让好友重新分享',
  GAME_NOT_FOUND: '记录不存在或已结束',
  GAME_ENDED: '记录已结束',
  NOT_FOUND: '记录不存在或已失效',
  CIRCLE_NOT_FOUND: '积分榜不存在或已解散',
  ALREADY_ENDED: '该记录已结束，无法再修改',
  PLAYER_NOT_FOUND: '该玩家已不在记录中',
  ALREADY_REVOKED: '这笔记录已经撤销',
  CONFLICT_RETRY: '数据刚有更新，请重试',
  INVALID_AMOUNT: '请检查积分数值',
  INVALID_STACK: '请检查结算积分',
  INVALID_EXTRA_COST: '请检查费用数值',
  NOT_AUTHORIZED: '暂无查看权限',
  OWNER_CANNOT_REMOVE: '榜主不能移出自己'
}
function errorMessage(code) {
  return messages[code] || '操作失败，请稍后重试'
}
module.exports = { errorMessage }
