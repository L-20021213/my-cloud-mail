# Cloud Mail 前后端分离部署指南

> 本版本已针对 **Vercel 前端 + Cloudflare Workers 后端** 重新整理。
>
> - `mail-vue`：部署到 Vercel
> - `mail-worker`：部署到 Cloudflare Workers
> - D1 / KV / R2 / Workers AI：继续使用 Cloudflare
> - 你的网站域名可以继续由腾讯云 DNS 管理
> - **不要求网站域名接入 Cloudflare Proxy，也不要求把网站域名 NS 修改到 Cloudflare**
>
> 推荐架构：
>
> ```text
> 用户浏览器
>      │
>      ▼
> https://mail.example.com
>      │
>      ▼
>     Vercel
>      │
>      │ HTTPS API
>      ▼
> https://cloud-mail-xxx.workers.dev
>      │
>      ├── D1
>      ├── KV
>      ├── R2（可选）
>      └── Workers AI
> ```
>
> 如果使用腾讯云 DNS，只需要让网站域名解析到 Vercel；前端直接请求 Cloudflare 的 `workers.dev` API 地址即可。

---

## 一、重要说明

### 1. 本版本已经取消 Worker 对 Vue 前端的托管

原项目的 Worker 会在部署时执行：

```text
mail-vue → vite build → mail-worker/dist → Cloudflare Assets
```

本版本已经改为：

```text
mail-vue   → Vercel
mail-worker → Cloudflare Workers
```

因此 `mail-worker/wrangler.toml` 不再包含 `[assets]` 和 `[build]`。

### 2. Cloudflare Worker 的 `workers.dev` 地址即可作为后端地址

你不需要为了前后端分离给 Worker 再绑定一个自定义域名。

例如 Worker 部署后得到：

```text
https://cloud-mail-xxxx.your-subdomain.workers.dev
```

那么：

```text
API 地址：
https://cloud-mail-xxxx.your-subdomain.workers.dev/api

资源地址：
https://cloud-mail-xxxx.your-subdomain.workers.dev
```

Vercel 前端通过环境变量连接它。

### 3. 邮件域名是另一件事

**网站前端域名不需要放到 Cloudflare。**

但是 Cloud Mail 的“Cloudflare Email Workers 收信”功能依赖 Cloudflare 的邮件路由能力。如果你的邮件域名完全无法加入 Cloudflare，那么：

- Vercel + Worker 前后端分离：可以正常使用
- Resend 发信：可以使用
- Cloudflare Email Routing / Email Worker 收信：仍然需要满足 Cloudflare 的邮件路由条件

也就是说，**前后端分离解决的是网站部署问题，不会绕过 Cloudflare 对邮件收信域名的要求。**

如果你无法把邮件域名接入 Cloudflare，需要另外使用支持入站邮件 Webhook/转发的邮件服务，再自行对接本项目。

---

# 二、准备工作

需要：

1. GitHub 账号
2. Vercel 账号
3. Cloudflare 账号
4. 一个域名
5. 一个 Cloudflare Workers 项目
6. Cloudflare D1
7. Cloudflare KV
8. R2（如果需要附件对象存储，推荐）
9. Workers AI（项目默认配置了 AI binding）

---

# 三、部署 Cloudflare Worker 后端

进入：

```text
mail-worker/
```

安装依赖：

```bash
pnpm install
```

如果没有 pnpm：

```bash
npm install -g pnpm
```

建议使用 Node.js 20.19+，推荐 Node.js 22。

---

## 3.1 登录 Cloudflare

```bash
pnpm wrangler login
```

检查：

```bash
pnpm wrangler whoami
```

---

# 四、创建 D1 数据库

执行：

```bash
pnpm wrangler d1 create cloud-mail
```

命令会返回类似：

```text
database_name = "cloud-mail"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

记下 `database_id`。

编辑：

```text
mail-worker/wrangler.toml
```

取消 D1 配置注释：

```toml
[[d1_databases]]
binding = "db"
database_name = "cloud-mail"
database_id = "你的-D1-ID"
```

最终必须保持：

```toml
[[d1_databases]]
binding = "db"
database_name = "cloud-mail"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

---

# 五、创建 KV

执行：

```bash
pnpm wrangler kv namespace create cloud-mail
```

返回：

```text
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

配置：

```toml
[[kv_namespaces]]
binding = "kv"
id = "你的-KV-ID"
```

最终：

```toml
[[kv_namespaces]]
binding = "kv"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

---

# 六、创建 R2（推荐）

如果需要使用 R2 保存附件：

```bash
pnpm wrangler r2 bucket create cloud-mail
```

然后：

```toml
[[r2_buckets]]
binding = "r2"
bucket_name = "cloud-mail"
```

如果暂时不使用 R2，可以删除/注释这一段。

> 项目支持 KV、R2 和 S3 存储。R2 更适合附件等对象数据。

---

# 七、Workers AI

当前配置已经包含：

```toml
[ai]
binding = "ai"
```

不需要自己填写 ID。

如果你不需要验证码 AI 识别，也可以根据自己的使用情况调整相关功能。

---

# 八、配置 Worker 环境变量

编辑：

```text
mail-worker/wrangler.toml
```

在：

```toml
[vars]
```

中配置：

```toml
[vars]
ai_model = "@cf/meta/llama-3.1-8b-instruct-fast"
analysis_cache = false
orm_log = false

domain = ["example.com"]

admin = "admin@example.com"

jwt_secret = "请填写随机字符串"

project_link = true

frontend_origin = "https://mail.example.com"
```

### domain

这是你的**邮件域名**，不是 Vercel 网站域名。

例如你希望创建：

```text
abc@example.com
test@example.com
```

那么：

```toml
domain = ["example.com"]
```

多个域名：

```toml
domain = ["example.com", "example.net"]
```

### admin

管理员邮箱：

```toml
admin = "admin@example.com"
```

建议使用 `domain` 中的邮箱地址。

### jwt_secret

这是数据库初始化密钥，同时也是系统 JWT 密钥。

建议使用至少 32 位随机字符串，例如：

```text
CloudMail-2026-xxxxxxxxxxxxxxxx
```

不要使用示例值。

### frontend_origin

这是 Vercel 前端地址。

例如：

```toml
frontend_origin = "https://mail.example.com"
```

如果还没有绑定自定义域名，可以先填写：

```text
https://你的项目.vercel.app
```

> 本版本前端直接请求 Worker，因此 Worker 已增加 CORS 支持。
>
> 如果不填写 `frontend_origin`，Worker 会按请求 Origin 工作；生产环境建议填写实际前端地址。

---

# 九、部署 Worker

进入：

```bash
cd mail-worker
```

执行：

```bash
pnpm wrangler deploy
```

成功后会得到：

```text
https://cloud-mail-xxxx.xxxxx.workers.dev
```

记下这个地址。

假设：

```text
WORKER_URL=https://cloud-mail-xxxx.xxxxx.workers.dev
```

那么 API 地址就是：

```text
https://cloud-mail-xxxx.xxxxx.workers.dev/api
```

---

# 十、初始化数据库

Worker 部署成功后，在浏览器访问：

```text
https://你的-worker.workers.dev/api/init/你的-jwt_secret
```

例如：

```text
https://cloud-mail-xxxx.xxxxx.workers.dev/api/init/CloudMail-2026-xxxxxxxxxxxxxxxx
```

成功应该返回：

```text
success
```

如果返回：

```text
❌ JWT secret mismatch
```

说明 URL 中的 secret 和 `wrangler.toml` 中的：

```toml
jwt_secret = "..."
```

不一致。

---

# 十一、先测试 Worker 后端

打开：

```text
https://你的-worker.workers.dev/api/
```

如果返回 API 错误或者接口响应，说明 Worker 已经可以访问。

直接访问：

```text
https://你的-worker.workers.dev/
```

返回：

```text
Cloud Mail API Worker
```

是正常的。

**不要把 Worker 根地址当成网站首页。**

本版本的 Worker 只负责后端。

---

# 十二、部署 Vercel 前端

现在进入：

```text
mail-vue/
```

这个目录就是完整的 Vercel 项目。

---

## 12.1 GitHub

把整个项目推送到自己的 GitHub。

推荐保留：

```text
cloud-mail/
├── mail-vue/
└── mail-worker/
```

不要只上传 `mail-vue`，因为后端还需要单独部署。

---

# 十三、Vercel 创建项目

进入 Vercel：

```text
Add New Project
→ Import Git Repository
```

选择你的 Cloud Mail 仓库。

### Root Directory

设置：

```text
mail-vue
```

这是最重要的一步。

不要填写：

```text
/
```

也不要填写：

```text
mail-worker
```

必须是：

```text
mail-vue
```

---

# 十四、Vercel Build 设置

推荐：

```text
Framework Preset:
Vite

Build Command:
pnpm build

Output Directory:
dist

Install Command:
pnpm install --frozen-lockfile
```

Node.js 建议：

```text
22.x
```

项目已经声明：

```json
"engines": {
  "node": ">=20.19.0"
}
```

---

# 十五、配置 Vercel 环境变量

进入：

```text
Vercel
→ Project
→ Settings
→ Environment Variables
```

添加：

### VITE_BASE_URL

填写：

```text
https://你的-worker.workers.dev/api
```

例如：

```text
https://cloud-mail-xxxx.xxxxx.workers.dev/api
```

### VITE_ASSET_BASE_URL

填写：

```text
https://你的-worker.workers.dev
```

例如：

```text
https://cloud-mail-xxxx.xxxxx.workers.dev
```

最终：

```text
VITE_BASE_URL=https://cloud-mail-xxxx.xxxxx.workers.dev/api

VITE_ASSET_BASE_URL=https://cloud-mail-xxxx.xxxxx.workers.dev
```

---

# 十六、为什么需要两个地址？

因为：

```text
VITE_BASE_URL
```

负责 API：

```text
/api/login
/api/email/...
/api/setting/...
```

而：

```text
VITE_ASSET_BASE_URL
```

负责 Worker 提供的资源：

```text
/attachments/...
/static/...
```

这样前后端分离后：

```text
Vercel
    │
    ├── API ──────────────► Worker /api
    │
    └── 图片/附件 ─────────► Worker /attachments
```

如果配置了独立 R2/S3 域名，资源则会直接使用 R2/S3 域名。

---

# 十七、Vercel 部署

点击：

```text
Deploy
```

Vercel 会执行：

```bash
pnpm install
pnpm build
```

最终生成：

```text
mail-vue/dist
```

并由 Vercel 托管。

---

# 十八、Vercel SPA 路由

项目已经包含：

```text
mail-vue/vercel.json
```

用于将 Vue Router 的历史模式路由回退到：

```text
/index.html
```

所以：

```text
https://mail.example.com/login
https://mail.example.com/inbox
https://mail.example.com/settings
```

直接刷新不会出现 Vercel 404。

---

# 十九、给网站绑定自己的域名

例如：

```text
mail.example.com
```

在 Vercel：

```text
Project
→ Settings
→ Domains
→ Add Domain
```

添加：

```text
mail.example.com
```

Vercel 会告诉你需要添加的 DNS 记录。

然后进入腾讯云 DNS：

```text
腾讯云 DNSPod
→ 域名解析
```

按照 Vercel 给出的记录添加。

例如常见情况：

```text
主机记录：mail
记录类型：CNAME
记录值：Vercel 提供的目标
```

具体以 Vercel 当前显示的记录为准。

这样：

```text
mail.example.com
        ↓
     腾讯云 DNS
        ↓
      Vercel
```

Cloudflare 不需要托管这个网站域名。

---

# 二十、最终访问关系

假设：

```text
网站：
https://mail.example.com

前端：
Vercel

Worker：
https://cloud-mail-xxxx.xxxxx.workers.dev
```

那么浏览器工作方式：

```text
https://mail.example.com
        │
        │ Vue
        ▼
      Vercel
        │
        │ Axios
        │
        ▼
https://cloud-mail-xxxx.xxxxx.workers.dev/api
        │
        ├── D1
        ├── KV
        ├── R2
        └── Workers AI
```

---

# 二十一、登录流程

登录请求：

```text
Vercel 前端
    ↓
POST
https://worker.workers.dev/api/login/...
    ↓
Cloudflare Worker
    ↓
D1
```

Worker 返回 Token 后：

```text
localStorage
    ↓
Authorization
    ↓
后续 API 请求
```

本项目使用 Authorization Token，不依赖前后端共享 Cookie，因此前后端分离不需要配置跨站 Cookie。

---

# 二十二、OAuth 登录

GitHub / Google / LinuxDo 等 OAuth 登录时，前端使用：

```js
window.location.origin
```

因此前端部署到：

```text
https://mail.example.com
```

后，OAuth 回调地址也应该使用：

```text
https://mail.example.com/login
```

不要填写 Worker 地址。

例如：

```text
正确：
https://mail.example.com/login

错误：
https://cloud-mail-xxxx.workers.dev/login
```

具体 OAuth 平台的回调地址，需要在对应 OAuth 应用后台修改。

---

# 二十三、Resend 发信

初始化数据库并进入网站后，在管理员设置中配置邮件发送服务。

如果使用 Resend：

1. 创建 Resend API Key
2. 添加并验证你的发信域名
3. 按 Resend 要求在腾讯云 DNS 添加 SPF / DKIM 等 DNS 记录
4. 回到 Cloud Mail 管理页面配置 Resend Token
5. 为对应邮件域配置 Token

例如：

```text
example.com → Resend Token
```

发送：

```text
user@example.com
```

即可通过对应配置发送。

---

# 二十四、Cloudflare Email Worker 收信

本项目的 Worker 入口已经保留：

```js
email: email
```

因此后端代码具备 Cloudflare Email Worker 收信处理能力。

但是要让：

```text
user@example.com
        ↓
Cloudflare
        ↓
Cloud Mail Worker
```

真正工作，需要在 Cloudflare 邮件系统中配置对应邮件路由。

### 重要

如果你的邮件域名不能加入 Cloudflare / 不能满足 Cloudflare Email Routing 的要求，那么仅部署 Worker 并不会自动获得收信能力。

这种情况下：

```text
网站：
腾讯云 DNS → Vercel
```

完全没有问题。

但：

```text
邮件：
example.com → Cloudflare Email Routing
```

仍然需要满足 Cloudflare 的邮件服务要求。

---

# 二十五、附件

项目支持：

```text
KV
R2
S3
```

三种对象存储方式。

推荐：

```text
Cloudflare R2
```

如果没有独立对象存储域名：

```text
VITE_ASSET_BASE_URL
        ↓
Worker
        ↓
/attachments/*
```

如果在 Cloud Mail 设置中配置了：

```text
R2 Domain
```

那么附件和邮件内嵌图片会优先使用该域名。

例如：

```text
https://cdn.example.com/attachments/xxx.jpg
```

这种方式更适合生产环境。

---

# 二十六、部署检查清单

部署完成后按照下面顺序检查。

## 1. Worker

访问：

```text
https://你的-worker.workers.dev/
```

应返回：

```text
Cloud Mail API Worker
```

---

## 2. 数据库初始化

访问：

```text
https://你的-worker.workers.dev/api/init/你的jwt_secret
```

返回：

```text
success
```

---

## 3. Vercel

打开：

```text
https://你的项目.vercel.app
```

应该看到 Cloud Mail 登录页面。

---

## 4. 登录

输入账号密码测试：

```text
登录
→ API
→ Worker
→ D1
```

浏览器开发者工具 Network 中应该看到：

```text
https://你的-worker.workers.dev/api/...
```

而不是：

```text
https://你的-vercel-domain/api/...
```

---

## 5. 收件箱

登录后：

```text
收件箱
→ 邮件列表
→ 邮件详情
```

全部能够加载。

---

## 6. 附件

测试：

```text
上传附件
下载附件
查看图片
```

确认请求进入：

```text
https://你的-worker.workers.dev/attachments/...
```

或者你的独立 R2/S3 域名。

---

## 7. 邮件发送

配置 Resend 后测试：

```text
Cloud Mail
    ↓
Worker
    ↓
Resend
    ↓
目标邮箱
```

---

# 二十七、常见错误

## `Network Error`

首先检查 Vercel：

```text
VITE_BASE_URL
```

是否填写：

```text
https://xxx.workers.dev/api
```

而不是：

```text
https://xxx.workers.dev
```

---

## `404 /api/...`

检查 Worker 是否仍然使用本版本：

```text
mail-worker/src/index.js
```

并确认：

```text
/api/
```

请求会被 Worker 转交给 Hono。

---

## `KV数据库未绑定`

检查：

```toml
[[kv_namespaces]]
binding = "kv"
id = "..."
```

---

## `D1数据库未绑定`

检查：

```toml
[[d1_databases]]
binding = "db"
database_name = "cloud-mail"
database_id = "..."
```

---

## 登录背景 / 附件无法加载

检查 Vercel：

```text
VITE_ASSET_BASE_URL
```

应该是：

```text
https://xxx.workers.dev
```

**不要填写 `/api`。**

---

## 邮件图片无法显示

优先检查 Cloud Mail 后台：

```text
R2 Domain
```

如果没有配置，确保：

```text
VITE_ASSET_BASE_URL
```

正确。

---

# 二十八、推荐的最终配置

### Vercel

```text
Root Directory:
mail-vue

Framework:
Vite

Build Command:
pnpm build

Output Directory:
dist

Node:
22.x
```

环境变量：

```text
VITE_BASE_URL=https://cloud-mail-xxxx.xxxxx.workers.dev/api
VITE_ASSET_BASE_URL=https://cloud-mail-xxxx.xxxxx.workers.dev
```

### Cloudflare Worker

```text
mail-worker
```

绑定：

```text
D1:
db

KV:
kv

R2:
r2

Workers AI:
ai
```

变量：

```text
domain=["example.com"]
admin="admin@example.com"
jwt_secret="随机字符串"
frontend_origin="https://mail.example.com"
```

### DNS

```text
腾讯云 DNS
      │
      └── mail.example.com → Vercel
```

Worker：

```text
Cloudflare workers.dev
```

**不需要把网站域名迁移到 Cloudflare。**

---

# 二十九、自动部署（可选）

项目保留：

```text
.github/workflows/deploy-cloudflare.yml
```

当前版本已经调整为：

```text
GitHub
  │
  └── mail-worker/*
          ↓
     GitHub Actions
          ↓
     Cloudflare Worker
```

`mail-vue` 不再触发 Cloudflare 部署。

前端推荐直接交给 Vercel：

```text
GitHub
  │
  └── mail-vue/*
          ↓
        Vercel
          ↓
       自动部署
```

这样前后端完全独立。

---

# 三十、目录结构

最终项目：

```text
cloud-mail/
│
├── mail-vue/                       # Vercel 前端
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── .env.release
│   └── vercel.json
│
├── mail-worker/                    # Cloudflare Worker 后端
│   ├── src/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── wrangler.toml
│   └── wrangler-action.toml
│
├── .github/
│   └── workflows/
│       └── deploy-cloudflare.yml
│
├── README.md
└── DEPLOY-SEPARATED.md
```

---

## 三十一、最简部署路线

如果你不想看全部说明，只需要按下面做：

```text
① 创建 D1
        ↓
② 创建 KV
        ↓
③ 创建 R2（推荐）
        ↓
④ 修改 mail-worker/wrangler.toml
        ↓
⑤ wrangler deploy
        ↓
⑥ 访问 /api/init/JWT_SECRET
        ↓
⑦ Vercel 导入 GitHub
        ↓
⑧ Root Directory = mail-vue
        ↓
⑨ 设置 VITE_BASE_URL
        ↓
⑩ 设置 VITE_ASSET_BASE_URL
        ↓
⑪ Deploy
        ↓
⑫ 腾讯云 DNS → Vercel
        ↓
⑬ 修改 frontend_origin
        ↓
⑭ 测试登录 / 邮件 / 附件
```

这样就是完整的：

```text
             前后端分离
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
    Vercel              Cloudflare
       │                   Worker
       │                     │
    Vue 3                 Hono
                             │
                   ┌─────────┼─────────┐
                   ▼         ▼         ▼
                  D1        KV        R2
```
