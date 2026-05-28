export function registerDashboardRoutes(app) {
  app.get('/api/dashboard/stats', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const totalPostsRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM posts').first()
      const totalCommentsRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM comments').first()
      const pendingCommentsRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM comments WHERE approved = 0').first()
      const totalCategoriesRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM categories').first()
      const totalMediaRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM media').first()

      const { results: recentPosts } = await c.env.DB.prepare(
        'SELECT id, title, slug_id, draft, created_at FROM posts ORDER BY created_at DESC LIMIT 5'
      ).all()

      const { results: recentComments } = await c.env.DB.prepare(
        `SELECT c.id, c.post_id, c.username, c.content, c.approved, c.created_at, p.title as post_title
         FROM comments c LEFT JOIN posts p ON c.post_id = p.id
         ORDER BY c.created_at DESC LIMIT 5`
      ).all()

      return c.json({
        totalPosts: totalPostsRow.count,
        totalComments: totalCommentsRow.count,
        pendingComments: pendingCommentsRow.count,
        totalCategories: totalCategoriesRow.count,
        totalMedia: totalMediaRow.count,
        recentPosts,
        recentComments
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.get('/api/dashboard/stream', async (c) => {
    const url = new URL(c.req.url)
    const token = url.searchParams.get('token') || (c.req.header('authorization') || '').replace('Bearer ', '')
    if (!token) {
      return c.json({ error: '未认证' }, 401)
    }
    const jwt = await import('jsonwebtoken')
    let user
    try {
      user = jwt.default.verify(token, c.env.JWT_SECRET)
    } catch {
      return c.json({ error: '令牌无效' }, 401)
    }

    const db = c.env.DB
    let lastSnapshot = null
    let closed = false

    async function getSnapshot() {
      const lastPost = await db.prepare('SELECT MAX(updated_at) as t FROM posts').first()
      const lastComment = await db.prepare('SELECT MAX(created_at) as t FROM comments').first()
      const lastCategory = await db.prepare('SELECT MAX(created_at) as t FROM categories').first()
      const lastLink = await db.prepare('SELECT MAX(created_at) as t FROM friend_links').first()
      const lastMedia = await db.prepare('SELECT MAX(created_at) as t FROM media').first()
      const commentCount = await db.prepare('SELECT COUNT(*) as c FROM comments WHERE approved = 0 AND deleted = 0').first()
      return {
        posts: lastPost?.t || null,
        comments: lastComment?.t || null,
        categories: lastCategory?.t || null,
        links: lastLink?.t || null,
        media: lastMedia?.t || null,
        pendingComments: commentCount?.c || 0
      }
    }

    function getChangedResources(oldSnap, newSnap) {
      const changes = []
      if (!oldSnap) return ['posts', 'comments', 'categories', 'links', 'media']
      if (oldSnap.posts !== newSnap.posts) changes.push('posts')
      if (oldSnap.comments !== newSnap.comments) changes.push('comments')
      if (oldSnap.categories !== newSnap.categories) changes.push('categories')
      if (oldSnap.links !== newSnap.links) changes.push('links')
      if (oldSnap.media !== newSnap.media) changes.push('media')
      if (oldSnap.pendingComments !== newSnap.pendingComments) changes.push('pendingComments')
      return changes
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()

        function send(event, data) {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          } catch {}
        }

        send('connected', { time: Date.now() })

        getSnapshot().then(snap => { lastSnapshot = snap })

        const pollInterval = setInterval(async () => {
          if (closed) return
          try {
            const snap = await getSnapshot()
            if (lastSnapshot) {
              const changed = getChangedResources(lastSnapshot, snap)
              if (changed.length > 0) {
                send('changes', { resources: changed })
              }
            }
            lastSnapshot = snap
          } catch {}
        }, 2000)

        c.req.raw.signal.addEventListener('abort', () => {
          closed = true
          clearInterval(pollInterval)
          try { controller.close() } catch {}
        })
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      }
    })
  })

  app.get('/api/dashboard/changes', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: '未认证' }, 401)

    try {
      const db = c.env.DB
      const lastPost = await db.prepare('SELECT MAX(updated_at) as t FROM posts').first()
      const lastComment = await db.prepare('SELECT MAX(created_at) as t FROM comments').first()
      const lastCategory = await db.prepare('SELECT MAX(created_at) as t FROM categories').first()
      const lastLink = await db.prepare('SELECT MAX(created_at) as t FROM friend_links').first()
      const lastMedia = await db.prepare('SELECT MAX(created_at) as t FROM media').first()
      const commentCount = await db.prepare('SELECT COUNT(*) as c FROM comments WHERE approved = 0 AND deleted = 0').first()

      return c.json({
        posts: lastPost?.t || null,
        comments: lastComment?.t || null,
        categories: lastCategory?.t || null,
        links: lastLink?.t || null,
        media: lastMedia?.t || null,
        pendingComments: commentCount?.c || 0
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })

  app.get('/api/site/fingerprint', async (c) => {
    try {
      const db = c.env.DB
      const lastPost = await db.prepare('SELECT MAX(updated_at) as t FROM posts').first()
      const lastComment = await db.prepare('SELECT MAX(created_at) as t FROM comments').first()
      const lastCategory = await db.prepare('SELECT MAX(created_at) as t FROM categories').first()
      const lastLink = await db.prepare('SELECT MAX(created_at) as t FROM friend_links').first()

      const data = {
        p: lastPost?.t || null,
        c: lastComment?.t || null,
        cat: lastCategory?.t || null,
        l: lastLink?.t || null
      }

      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'CDN-Cache-Control': 'no-cache, no-store, must-revalidate',
        }
      })
    } catch (err) {
      return c.json({ error: '服务器内部错误' }, 500)
    }
  })
}
