import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const loginRateLimit = new Map()
const LOGIN_RATE_WINDOW = 3600000
const LOGIN_RATE_MAX = 2

function checkLoginRateLimit(ip) {
  const now = Date.now()
  const entry = loginRateLimit.get(ip)
  if (!entry || now - entry.startTime > LOGIN_RATE_WINDOW) {
    loginRateLimit.set(ip, { startTime: now, count: 1 })
    return true
  }
  if (entry.count >= LOGIN_RATE_MAX) return false
  entry.count++
  return true
}

function cleanupRateLimits() {
  const now = Date.now()
  for (const [key, entry] of loginRateLimit) {
    if (now - entry.startTime > LOGIN_RATE_WINDOW) loginRateLimit.delete(key)
  }
}

const codeRateLimit = new Map()
const CODE_RATE_WINDOW = 60000
const CODE_RATE_MAX = 1

function checkCodeRateLimit(ip) {
  const now = Date.now()
  const entry = codeRateLimit.get(ip)
  if (!entry || now - entry.startTime > CODE_RATE_WINDOW) {
    codeRateLimit.set(ip, { startTime: now, count: 1 })
    return true
  }
  if (entry.count >= CODE_RATE_MAX) return false
  entry.count++
  return true
}

async function verifyTurnstile(token, secret) {
  if (!token || !secret) return false
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token })
    })
    const data = await resp.json()
    return data.success === true
  } catch {
    return false
  }
}

async function getTurnstileConfig(db) {
  const { results: rows } = await db.prepare(
    "SELECT key, value FROM site_config WHERE key IN ('turnstile.siteKey', 'turnstile.secretKey')"
  ).all()
  const config = {}
  for (const row of rows) {
    config[row.key.replace('turnstile.', '')] = row.value
  }
  return config
}

function generateVerifyCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function storeVerifyCode(db, email, code) {
  await db.prepare(
    `INSERT INTO verify_codes (email, code, expires_at) VALUES (?, ?, datetime('now', '+8 hours', '+5 minutes'))
     ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = datetime('now', '+8 hours', '+5 minutes')`
  ).bind(email, code).run()
}

async function verifyCode(db, email, inputCode) {
  const row = await db.prepare(
    "SELECT code, expires_at FROM verify_codes WHERE email = ? AND expires_at > datetime('now', '+8 hours')"
  ).bind(email).first()
  if (!row) return false
  if (row.code !== inputCode) return false
  await db.prepare('DELETE FROM verify_codes WHERE email = ?').bind(email).run()
  return true
}

async function isEmailConfigured(db, env) {
  const { results: rows } = await db.prepare(
    "SELECT key, value FROM site_config WHERE key LIKE 'email.%'"
  ).all()
  const config = {}
  for (const row of rows) {
    config[row.key.replace('email.', '')] = row.value
  }
  const mode = config.emailMode || 'smtp'
  if (mode === 'smtp') {
    return !!(config.user && config.pass && config.smtpHost)
  }
  return !!(config.resendKey)
}

const captchaStore = new Map()

function generateCaptcha() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let text = ''
  for (let i = 0; i < 6; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  captchaStore.set(id, { text, expires: Date.now() + 300000 })
  setTimeout(() => captchaStore.delete(id), 300000)
  return { id, text }
}

function generateCaptchaSvg(text) {
  const width = 220
  const height = 60
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
  svg += `<rect width="${width}" height="${height}" fill="#e8e8e8" rx="8"/>`
  for (let i = 0; i < 12; i++) {
    const x1 = Math.random() * width
    const y1 = Math.random() * height
    const x2 = Math.random() * width
    const y2 = Math.random() * height
    const sw = Math.random() * 2 + 0.5
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},0.5)" stroke-width="${sw}"/>`
  }
  for (let i = 0; i < 3; i++) {
    const cx = Math.random() * width
    const cy = Math.random() * height
    const rx = Math.random() * 40 + 20
    const ry = Math.random() * 20 + 10
    svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},0.25)" stroke-width="${Math.random()*2+0.5}"/>`
  }
  for (let i = 0; i < 80; i++) {
    const cx = Math.random() * width
    const cy = Math.random() * height
    const r = Math.random() * 2.5 + 0.5
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},0.4)"/>`
  }
  const colors = ['#2d5a8e', '#8e2d5a', '#5a8e2d', '#8e5a2d', '#2d8e5a', '#5a2d8e', '#8e3d2d', '#2d8e8e']
  for (let i = 0; i < text.length; i++) {
    const x = 20 + i * 32
    const y = 38 + (Math.random() - 0.5) * 14
    const rotate = (Math.random() - 0.5) * 30
    const color = colors[Math.floor(Math.random() * colors.length)]
    const skewX = (Math.random() - 0.5) * 10
    svg += `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="${color}" transform="rotate(${rotate} ${x} ${y}) skewX(${skewX})" style="filter: url(#blur)">${text[i]}</text>`
  }
  svg += `<defs><filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="0.5"/></filter></defs>`
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * width
    const y1 = Math.random() * height
    const x2 = Math.random() * width
    const y2 = Math.random() * height
    svg += `<path d="M${x1},${y1} Q${Math.random()*width},${Math.random()*height} ${x2},${y2}" fill="none" stroke="rgba(${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},${Math.floor(Math.random()*200)},0.4)" stroke-width="${Math.random()*2+1}"/>`
  }
  svg += `</svg>`
  return svg
}

export function registerAuthRoutes(app) {
  app.get('/api/auth/captcha', async (c) => {
    const { id, text } = generateCaptcha()
    const svg = generateCaptchaSvg(text)
    return c.json({ captchaId: id, svg })
  })

  app.post('/api/auth/verify-captcha', async (c) => {
    try {
      const { captchaId, captchaAnswer } = await c.req.json()
      if (!captchaId || !captchaAnswer) {
        return c.json({ error: '请输入验证码' }, 400)
      }
      const entry = captchaStore.get(captchaId)
      if (!entry) {
        return c.json({ error: '验证码已过期，请刷新' }, 400)
      }
      if (Date.now() > entry.expires) {
        captchaStore.delete(captchaId)
        return c.json({ error: '验证码已过期，请刷新' }, 400)
      }
      if (entry.text.toUpperCase() !== captchaAnswer.toUpperCase()) {
        captchaStore.delete(captchaId)
        return c.json({ error: '验证码错误' }, 400)
      }
      captchaStore.delete(captchaId)
      const token = jwt.sign({ captcha: true }, c.env.JWT_SECRET, { expiresIn: '5m' })
      return c.json({ success: true, captchaToken: token })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/auth/login', async (c) => {
    try {
      cleanupRateLimits()
      const { username, password, code, email, turnstileToken } = await c.req.json()
      if (!username || !password) {
        return c.json({ error: '用户名和密码不能为空' }, 400)
      }

      const clientIp = c.req.header('cf-connecting-ip') || 'unknown'
      if (!checkLoginRateLimit(clientIp)) {
        return c.json({ error: '登录尝试太频繁，请1小时后再试' }, 429)
      }

      const db = c.env.DB

      const turnstileConfig = await getTurnstileConfig(db)
      if (turnstileConfig.secretKey) {
        if (!turnstileToken) {
          return c.json({ error: '请完成人机验证' }, 400)
        }
        const turnstileValid = await verifyTurnstile(turnstileToken, turnstileConfig.secretKey)
        if (!turnstileValid) {
          return c.json({ error: '人机验证失败，请重试' }, 400)
        }
      }

      const user = await db.prepare('SELECT id, username, password FROM users WHERE username = ?').bind(username).first()
      if (!user) {
        return c.json({ error: '用户名或密码错误' }, 400)
      }

      const valid = await bcrypt.compare(password, user.password)
      if (!valid) {
        return c.json({ error: '用户名或密码错误' }, 400)
      }

      const emailReady = await isEmailConfigured(db, c.env)
      if (emailReady && code && email) {
        const codeValid = await verifyCode(db, email, code)
        if (!codeValid) {
          return c.json({ error: '验证码无效或已过期' }, 400)
        }
      }

      const token = jwt.sign(
        { id: user.id, username: user.username },
        c.env.JWT_SECRET,
        { expiresIn: '1h' }
      )

      return c.json({ token, user: { id: user.id, username: user.username } })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/auth/refresh', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const token = jwt.sign(
        { id: user.id, username: user.username },
        c.env.JWT_SECRET,
        { expiresIn: '1h' }
      )
      return c.json({ token, user: { id: user.id, username: user.username } })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/auth/register', async (c) => {
    try {
      const db = c.env.DB
      const existingUser = await db.prepare('SELECT id FROM users LIMIT 1').first()
      if (existingUser) {
        return c.json({ error: '注册功能已关闭' }, 403)
      }
      const { username, password } = await c.req.json()
      if (!username || !password) {
        return c.json({ error: '用户名和密码不能为空' }, 400)
      }

      if (password.length < 6) {
        return c.json({ error: '密码长度不能少于6位' }, 400)
      }

      if (!/^[a-zA-Z0-9_.@]{3,30}$/.test(username)) {
        return c.json({ error: '用户名格式不正确，只允许字母、数字、下划线、点和@，长度3-30位' }, 400)
      }

      const existing = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()
      if (existing) {
        return c.json({ error: '用户名已存在' }, 409)
      }

      const hashedPassword = await bcrypt.hash(password, 10)
      const result = await db.prepare("INSERT INTO users (username, password, created_at) VALUES (?, ?, datetime('now', '+8 hours'))").bind(username, hashedPassword).run()

      const userId = result.meta.last_row_id
      const token = jwt.sign(
        { id: userId, username },
        c.env.JWT_SECRET,
        { expiresIn: '1h' }
      )

      return c.json({ token, user: { id: userId, username } }, 201)
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.get('/api/auth/me', async (c) => {
    try {
      const db = c.env.DB
      const user = await db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').bind(c.get('user').id).first()
      if (!user) {
        return c.json({ error: '用户不存在' }, 404)
      }
      return c.json(user)
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/auth/change-password', async (c) => {
    try {
      const { oldPassword, newPassword } = await c.req.json()
      if (!oldPassword || !newPassword) {
        return c.json({ error: '旧密码和新密码不能为空' }, 400)
      }

      if (newPassword.length < 6) {
        return c.json({ error: '新密码长度不能少于6位' }, 400)
      }

      const db = c.env.DB
      const user = await db.prepare('SELECT id, username, password FROM users WHERE id = ?').bind(c.get('user').id).first()
      if (!user) {
        return c.json({ error: '用户不存在' }, 404)
      }

      const valid = await bcrypt.compare(oldPassword, user.password)
      if (!valid) {
        return c.json({ error: '旧密码错误' }, 400)
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10)
      await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hashedPassword, c.get('user').id).run()

      return c.json({ message: '密码修改成功' })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.post('/api/auth/send-verify-code', async (c) => {
    try {
      const { email, captchaToken } = await c.req.json()
      if (!email) {
        return c.json({ error: '邮箱不能为空' }, 400)
      }

      if (!captchaToken) {
        return c.json({ error: '请先完成图形验证码' }, 400)
      }

      try {
        const decoded = jwt.verify(captchaToken, c.env.JWT_SECRET)
        if (!decoded.captcha) {
          return c.json({ error: '图形验证码验证无效' }, 400)
        }
      } catch {
        return c.json({ error: '图形验证码已过期，请重新验证' }, 400)
      }

      const clientIp = c.req.header('cf-connecting-ip') || 'unknown'
      if (!checkCodeRateLimit(clientIp)) {
        return c.json({ error: '发送太频繁，请1分钟后再试' }, 429)
      }

      const db = c.env.DB
      const emailReady = await isEmailConfigured(db, c.env)
      if (!emailReady) {
        return c.json({ error: '邮件服务未配置' }, 400)
      }

      const code = generateVerifyCode()
      await storeVerifyCode(db, email, code)

      const emailConfig = {}
      const rows = (await db.prepare("SELECT key, value FROM site_config WHERE key LIKE 'email.%'").bind().all()).results
      for (const row of rows) {
        const key = row.key.replace('email.', '')
        emailConfig[key] = row.value
      }

      const apiKey = emailConfig.resendKey
      const fromEmail = emailConfig.resendFrom || emailConfig.user
      if (!apiKey || !fromEmail) {
        return c.json({ error: '请先配置 Resend API Key 和发件邮箱' }, 400)
      }
      const siteTitleRow = await db.prepare("SELECT value FROM site_config WHERE key = 'site.title'").bind().first()
      const title = siteTitleRow?.value || 'Momo Blog'
      const html = `<div style="max-width:400px;margin:0 auto;padding:20px;font-family:sans-serif;"><div style="background:#f9f9f9;border-radius:12px;padding:24px;text-align:center;"><h2 style="margin:0 0 16px;color:#333;">${title}</h2><p style="color:#666;margin:0 0 20px;">您的登录验证码为：</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#111;background:#fff;border-radius:8px;padding:12px;display:inline-block;">${code}</div><p style="color:#999;font-size:12px;margin:16px 0 0;">验证码5分钟内有效，请勿泄露</p></div></div>`
      const resp = await fetch('https://api.resend.com/email', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: [email], subject: `${title} - 登录验证码`, html })
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.message || 'Resend API 发送失败')
      }

      return c.json({ message: '验证码已发送' })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.get('/api/auth/turnstile-sitekey', async (c) => {
    try {
      const db = c.env.DB
      const row = await db.prepare("SELECT value FROM site_config WHERE key = 'turnstile.siteKey'").first()
      if (!row || !row.value) {
        return c.json({ siteKey: null, enabled: false })
      }
      return c.json({ siteKey: row.value, enabled: true })
    } catch (err) {
      return c.json({ siteKey: null, enabled: false })
    }
  })

  app.get('/api/auth/turnstile-config', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const db = c.env.DB
      const config = await getTurnstileConfig(db)
      const MASK = '••••••'
      return c.json({
        siteKey: config.siteKey || '',
        secretKey: config.secretKey ? MASK : '',
        enabled: !!(config.siteKey && config.secretKey)
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.put('/api/auth/turnstile-config', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const db = c.env.DB
      const { siteKey, secretKey } = await c.req.json()
      const MASK = '••••••'
      const stmts = [
        db.prepare(
          `INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now','+8 hours')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','+8 hours')`
        ).bind('turnstile.siteKey', siteKey || '')
      ]

      if (secretKey && secretKey !== MASK) {
        stmts.push(db.prepare(
          `INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, datetime('now','+8 hours')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','+8 hours')`
        ).bind('turnstile.secretKey', secretKey))
      }

      await db.batch(stmts)

      const config = await getTurnstileConfig(db)
      return c.json({
        siteKey: config.siteKey || '',
        secretKey: config.secretKey ? MASK : '',
        enabled: !!(config.siteKey && config.secretKey)
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })
}
