# Stax 云开发部署清单

> 目标：把当前代码从本地 Demo 模式切到真实云开发模式，让朋友可以通过微信分享加入同一局并实时同步。
>
> 当前已配置环境 ID：`cloud1-d7gykoaktfc01fbf0`

---

## 0. 先确认项目已切到真实云

打开 `miniprogram/app.js`，确认有这一行：

```js
const ENV_ID = 'cloud1-d7gykoaktfc01fbf0'
```

如果是这个值，说明不会再进入 Demo 模式，会直接连你的微信云开发环境。

---

## 1. 打开云开发控制台

1. 打开微信开发者工具
2. 导入项目：`/Users/bytedance/Stax`
3. 顶部点 **云开发**
4. 确认左上角环境为：`cloud1-d7gykoaktfc01fbf0`

---

## 2. 创建数据库集合

云开发控制台 → 左侧 **数据库** → **集合管理** → **新建集合**，依次创建 5 个集合：

```text
users
games
transactions
terms
handRanks
```

不要漏，名字必须完全一致，大小写也要一致。

---

## 3. 配置数据库权限

进入每个集合 → **权限设置 / 安全规则** → 选择 **自定义安全规则**。

### 3.1 users

```json
{
  "read": "doc._openid == auth.openid",
  "write": false
}
```

说明：用户资料由云函数 `whoami` 写入，前端只读自己的资料。

### 3.2 games

```json
{
  "read": "auth.openid != null",
  "write": false
}
```

说明：前端需要读取进行中牌局、历史牌局、详情页实时同步；写入都走云函数。

### 3.3 transactions

```json
{
  "read": "auth.openid != null",
  "write": false
}
```

说明：详情页会读取最近流水；写入、撤销都走云函数。

### 3.4 terms

```json
{
  "read": true,
  "write": false
}
```

### 3.5 handRanks

```json
{
  "read": true,
  "write": false
}
```

说明：术语词典和起手牌表所有用户可读；初始化数据通过 `seedTerms` 云函数写入。

---

## 4. 部署云函数

在微信开发者工具左侧文件树里找到 `cloudfunctions/`，对下面每个目录执行同样操作：

右键目录 → **上传并部署：云端安装依赖**

需要部署 8 个：

```text
whoami
createGame
joinGame
recordTransaction
settleGame
seedTerms
aiReview
termAi
```

建议顺序：

1. `whoami`
2. `createGame`
3. `joinGame`
4. `recordTransaction`
5. `settleGame`
6. `seedTerms`
7. `aiReview`
8. `termAi`

每个部署完成后，控制台应该显示上传成功。

---

## 5. 初始化术语和起手牌数据

1. 云开发控制台 → 左侧 **云函数**
2. 找到 `seedTerms`
3. 点 **云端测试**

为了避免云端测试 3 秒超时，建议分两次执行。

### 5.1 先初始化术语

入参：

```json
{
  "reset": true,
  "only": "terms"
}
```

成功返回应类似：

```json
{
  "ok": true,
  "mode": "terms",
  "termsCleared": 0,
  "termsInserted": 50
}
```

### 5.2 再初始化起手牌表

入参：

```json
{
  "reset": true,
  "only": "handRanks"
}
```

成功返回应类似：

```json
{
  "ok": true,
  "mode": "handRanks",
  "handRanksCleared": 0,
  "handRanksInserted": 169
}
```

也可以一次性跑：

```json
{
  "reset": true,
  "only": "all"
}
```

但如果遇到 3 秒超时，就按上面分两次跑。

然后去数据库里确认：

- `terms` 有 50 条
- `handRanks` 有 169 条

---

## 6. 快速验证云函数

### 6.1 测 whoami

云函数 → `whoami` → 云端测试 → 入参：

```json
{}
```

成功返回：

```json
{
  "ok": true,
  "openid": "...",
  "user": {
    "nickname": "玩家"
  }
}
```

### 6.2 测 aiReview / termAi

`aiReview` 需要已结算牌局才有结果，所以先不用测。

可以先测 `termAi`：

入参：

```json
{
  "termEn": "Button"
}
```

成功返回：

```json
{
  "ok": true,
  "aiText": "..."
}
```

---

## 7. 在小程序里跑一遍真实流程

微信开发者工具点 **编译**。

### 7.1 预期启动状态

- 不应该出现「Demo 模式」金色横幅
- 控制台不应该出现 `[cloud-mock] installed`
- 首页可以正常打开

### 7.2 完整流程

1. 「我的」→ 设置头像和昵称 → 保存
2. 「首页」→ 创建牌局
3. 进入牌局详情页，看到邀请码
4. 用另一个微信号扫码/输入邀请码加入
5. 参与人点「我要补码」
6. 房主看到最近流水，可撤销
7. 房主点「结束并结算」
8. 输入最终筹码，确保 `Σ profit = 0`
9. 输入额外费用，例如 `60`，选择「赢家按比例」
10. 提交结算
11. 点「AI 点评」
12. 回到「我的」→「数据看板」，确认有战绩

---

## 8. 常见问题

### 问题 1：启动报 `env not found`

检查 `miniprogram/app.js`：

```js
const ENV_ID = 'cloud1-d7gykoaktfc01fbf0'
```

以及开发者工具当前登录的小程序 AppID 是否和这个云环境属于同一个小程序。

### 问题 2：`cloud.callFunction:fail function not found`

说明对应云函数没部署。

解决：右键该云函数目录 → **上传并部署：云端安装依赖**。

### 问题 3：术语词典为空

说明没执行 `seedTerms`。

解决：云函数 `seedTerms` → 云端测试：

```json
{
  "reset": true
}
```

### 问题 4：加入牌局后看不到实时更新

优先检查 `games` 集合权限是不是：

```json
{
  "read": "auth.openid != null",
  "write": false
}
```

如果权限过严，参与人读不到牌局文档。

### 问题 5：房主操作返回 `NOT_HOST`

说明当前微信号不是创建牌局的微信号。

只有创建牌局的人是房主，可以：

- 淘汰玩家
- 暂停/恢复
- 手动升盲
- 结束结算
- 撤销补码流水

参与人只能给自己补码。

### 问题 6：AI 点评不是大模型输出

当前 `aiReview` 和 `termAi` 默认走规则模板，已经可用、零成本。

之后如果要接腾讯混元/云开发 AI，只需要配置云函数环境变量：

```text
STAX_AI_PROVIDER=hunyuan
```

再补齐混元 Secret 配置即可。当前阶段不用管。

---

## 9. 最小成功标准

做到下面 5 个，就说明云开发已经部署成功：

- [ ] `whoami` 云端测试返回 openid
- [ ] `seedTerms` 返回 `termsInserted: 50` 和 `handRanksInserted: 169`
- [ ] 小程序能创建牌局并生成邀请码
- [ ] 第二个微信号能加入同一局
- [ ] 房主结算后，数据看板能看到新增战绩

完成这 5 个之后，就可以继续真机体验和准备提审截图。
