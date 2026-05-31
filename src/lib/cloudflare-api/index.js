import { Hono } from 'hono'
import jwt from 'jsonwebtoken'

import { registerAuthRoutes } from './routes/auth.js'
import { registerPostsRoutes } from './routes/posts.js'
import { registerCategoriesRoutes } from './routes/categories.js'
import { registerCommentsRoutes } from './routes/comments.js'
import { registerEmailRoutes } from './routes/email.js'
import { registerConfigRoutes } from './routes/config.js'
import { registerProfileRoutes } from './routes/profile.js'
import { registerLinksRoutes } from './routes/links.js'
import { registerMediaRoutes } from './routes/media.js'
import { registerDashboardRoutes } from './routes/dashboard.js'
import { registerMusicRoutes } from './routes/music.js'

const app = new Hono()

function setCacheHeaders(c, path, method) {
  if (method !== 'GET' || !c.res) return
  const isAdminPath = path.includes('/admin/')
  if (isAdminPath) {
    c.res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    c.res.headers.set('Pragma', 'no-cache')
    c.res.headers.set('Expires', '0')
  } else {
    const cacheablePaths = ['/api/posts', '/api/categories', '/api/links', '/api/comments', '/api/auth/turnstile-sitekey', '/api/auth/configured']
    if (cacheablePaths.some(p => path === p || path.startsWith(p + '/'))) {
      const isCommentsList = path === '/api/comments' || path.startsWith('/api/comments/')
      const isPostDetail = path.match(/^\/api\/posts\/\d+$/)
      const maxAge = isPostDetail ? 60 : isCommentsList ? 30 : 60
      c.res.headers.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`)
    }
  }
}

app.use('/api/*', async (c, next) => {
  await next()
  if (c.res) {
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('X-XSS-Protection', '1; mode=block')
    c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.res.headers.delete('X-Powered-By')
  }
})

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  const method = c.req.method

  const publicGetPaths = ['/api/posts', '/api/categories', '/api/links', '/api/site', '/api/music']
  const publicExactGetPaths = ['/api/comments', '/api/site/fingerprint']
  const adminSubPaths = ['/stats', '/batch', '/admin/', '/toggle-pin', '/toggle-draft', '/netease', '/qq', '/kugou', '/kuwo', '/add', '/upload', '/update-covers']

  if (method === 'GET') {
    const isPublicExact = publicExactGetPaths.some(p => path === p)
    const isPublicPrefix = publicGetPaths.some(p => path === p || (path.startsWith(p + '/') && !adminSubPaths.some(sp => path.includes(sp))))
    if (isPublicExact || isPublicPrefix) {
      await next()
      setCacheHeaders(c, path, method)
      return
    }
  }

  if (path === '/api/comments' && (method === 'GET' || method === 'POST')) {
    await next()
    setCacheHeaders(c, path, method)
    return
  }
  if (path.startsWith('/api/comments/qq-info')) {
    await next()
    return
  }

  if (path.endsWith('/login') || path.endsWith('/register')) {
    await next()
    return
  }
  if (path.endsWith('/send-code') || path.endsWith('/configured')) {
    await next()
    return
  }
  if (path.endsWith('/turnstile-sitekey')) {
    await next()
    return
  }
  if (path.endsWith('/captcha') || path.endsWith('/verify-captcha')) {
    await next()
    return
  }
  if (path === '/api/dashboard/stream') {
    await next()
    return
  }

  const authHeader = c.req.header('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: '未提供认证令牌' }, 401)
  }

  const token = authHeader.substring(7)
  try {
    const decoded = jwt.verify(token, c.env.JWT_SECRET)
    c.set('user', decoded)
    await next()
    setCacheHeaders(c, path, method)
  } catch {
    return c.json({ error: '令牌无效或已过期' }, 401)
  }
})

registerAuthRoutes(app)
registerPostsRoutes(app)
registerCategoriesRoutes(app)
registerCommentsRoutes(app)
registerEmailRoutes(app)
registerConfigRoutes(app)
registerProfileRoutes(app)
registerLinksRoutes(app)
registerMediaRoutes(app)
registerDashboardRoutes(app)
registerMusicRoutes(app)

export default app
