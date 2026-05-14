# Stax 部署与提审指南

> 面向：第一次接手 Stax 项目的开发者 / 庄家。完成本指南后即可让小程序在你的微信账号下跑起来并提交审核。

---

## 一、准备工作

| 项 | 要求 |
|---|---|
| 微信小程序 AppID | 个人主体即可，[注册入口](https://mp.weixin.qq.com/wxopen/waregister) |
| 开发者工具 | 1.06+ ；[下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) |
| 云开发环境 | 在 mp.weixin.qq.com 后台「开发」→「云开发」→「开通」；记下 **环境 ID** |
| Node.js | ≥ 14（仅本地跑单元测试需要） |

---

## 二、本地启动（5 分钟）

1. **拉取代码**：把仓库克隆到本地。
2. **打开开发者工具**：
   - 「导入项目」→ 选择仓库根目录
   - AppID 填你自己的（个人主体）
   - 确定后会自动识别 `project.config.json`
3. **替换环境 ID**：编辑 `miniprogram/app.js`，把 `env: 'your-env-id'` 改为你的真实环境 ID。
4. **编译预览**：右上角「编译」按钮即可看到首页。

---

## 三、云资源初始化

> 更直接的逐步部署清单见 `docs/CLOUD_SETUP.md`。下面是原始说明。

### 3.1 建库（5 个集合）
打开开发者工具 →「云开发」→「数据库」→「集合管理」→「+」逐个新建：

```
users
games
transactions
terms
handRanks
```

### 3.2 配置权限（Spec §2.6）
对每个集合点「数据权限」，按下表配置：

| 集合 | 推荐权限 |
|---|---|
| `users` | 仅创建者可读写（`only-creator`） |
| `games` | 所有人可读，仅创建者可写（`read-only-creator-write`） |
| `transactions` | 仅创建者可读写 |
| `terms` | 所有人可读，仅管理员可写 |
| `handRanks` | 所有人可读，仅管理员可写 |

> 真正的"庄家可写、玩家可读"细粒度规则由云函数（`recordTransaction` / `settleGame`）在服务端校验 `hostOpenid === OPENID`，无需在 DB 规则里实现。

### 3.3 部署 6 个云函数
对 `cloudfunctions/` 下每个目录右键 → **上传并部署：云端安装依赖**：

```
createGame
joinGame
recordTransaction
settleGame
seedTerms
whoami
```

### 3.4 灌入种子数据
在「云开发」→「云函数」→ `seedTerms` → **云端测试** → 入参留空 `{}` → 调用。
返回 `{ ok: true, termsInserted: 50, handRanksInserted: 169 }` 即成功。

---

## 四、本地测试

```bash
npm install
npm test         # 运行 settle 与 invite-code 单元测试
npm run lint     # （可选）静态检查
```

预期输出：所有用例 ✓，10 万次邀请码碰撞 < 1%。

---

## 五、合规检查

- [ ] 全代码搜索 `赌|赢钱|下注|赌资`，仅在反向声明处出现
- [ ] 首页弹窗「使用须知」可见
- [ ] 关于页含合规声明
- [ ] 类目选 **「工具」→「实用工具」**

```bash
# 自检命令
grep -RIn --exclude-dir=.git -E "赌|赢钱|下注|赌资" .
```

---

## 六、提交审核

1. 开发者工具 → 右上角「上传」→ 填写版本号（首次 `0.1.0`）→ 备注 `Stax MVP`。
2. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) →「版本管理」→「开发版本」→「提交审核」。
3. **必填项**：
   - 类目：`工具 → 实用工具`
   - 简介：示例 — *Stax 长河筹略：朋友局德州扑克筹码记账、盲注计时与战绩统计工具，附扑克术语词典。*
   - 功能页面截图 5 张：建议截 `首页 / 创建 / 牌局详情 / 结算 / 学习首页`
   - 测试账号：可选填庄家与玩家两个微信号，并附文字说明 *"测试时请使用'创建牌局'生成邀请码，再用第二个账号'加入牌局'"*
   - 隐私协议：见 `docs/PRIVACY.md`

4. 审核通过后「发布」即上线。

---

## 七、常见问题

**Q1. `cloud.init` 报 env 错误？**
A：必须把 `your-env-id` 替换为真实环境 ID；环境 ID 在「云开发」控制台左上角可看。

**Q2. 庄家操作返回 `NOT_HOST`？**
A：云函数会比对 `hostOpenid === OPENID`，确认你是用创建者账号在操作。

**Q3. `seedTerms` 重复执行会重复插入吗？**
A：默认 `reset: true` 会先清空再插入；如需追加，调用时传入 `{ "reset": false }`。

**Q4. 计时器在小程序后台被冻结？**
A：盲注剩余时间是基于 `levelStartedAt + pausedAccumMs` 实时换算的，前台一回到就立刻刷新到正确值，无需后台保活。

**Q5. 想换 tab 图标？**
A：替换 `miniprogram/images/tab-*.png` 为你的 PNG（建议 81×81，单色）。当前仓库内是 1×1 透明占位。

---

## 八、版本历史
- v0.1.0（MVP）：P0 全量 + P1 学习模块；6 个云函数；50 条术语 + 169 起手牌种子
