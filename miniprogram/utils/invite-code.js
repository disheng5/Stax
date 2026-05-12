// utils/invite-code.js — 6 位邀请码生成（去掉易混淆字符 0/O/1/I）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateInviteCode(len = 6) {
  let code = ''
  for (let i = 0; i < len; i++) {
    code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length))
  }
  return code
}

module.exports = { generateInviteCode, ALPHABET }
