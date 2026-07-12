// cloudfunctions/getGameView/index.js —— 记录详情按身份裁剪（只读）
// 供新分享直达详情：参与者/受分享人可见；同赛季但未参与未分享者拒绝。
// 旧 game-join / 旧直读路径保留兼容，不删除。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 可展示快照：完整返回牌局字段（参与者/受分享人本就有权查看这局）。
function toGameSnapshot(game) {
  return { ...game }
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { gameId, inviteCode } = event || {}
  if (!gameId) return { ok: false, error: 'INVALID_PARAMS' }

  const got = await db
    .collection('games')
    .doc(gameId)
    .get()
    .catch(() => null)
  if (!got || !got.data) return { ok: false, error: 'GAME_NOT_FOUND' }
  const game = got.data

  const isPlayer = game.hostOpenid === OPENID || (game.players || []).some(p => p.openid === OPENID)
  const codeMatches =
    !!inviteCode && !!game.inviteCode && String(inviteCode).toUpperCase() === game.inviteCode
  const ended = game.status === 'ended'

  if (isPlayer) {
    return { ok: true, role: 'player', game: toGameSnapshot(game), canJoin: false }
  }
  if (codeMatches) {
    // 持邀请码的受分享人：进行中可加入，已结束仅观看
    return {
      ok: true,
      role: ended ? 'viewerEnded' : 'viewer',
      game: toGameSnapshot(game),
      canJoin: !ended
    }
  }
  return { ok: false, error: 'NOT_AUTHORIZED' }
}
