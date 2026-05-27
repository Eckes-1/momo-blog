import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

mkdirSync(`${__dirname}/data`, { recursive: true })
mkdirSync(`${__dirname}/uploads`, { recursive: true })

const db = new Database(`${__dirname}/data/lihui.db`)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug_id TEXT UNIQUE NOT NULL,
    content TEXT DEFAULT '',
    description TEXT DEFAULT '',
    image TEXT DEFAULT '',
    category TEXT DEFAULT '',
    pin_top INTEGER DEFAULT 0,
    draft INTEGER DEFAULT 0,
    pub_date TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    parent_id INTEGER,
    username TEXT NOT NULL,
    email TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    content TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    approved INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS friend_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    url TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS site_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    mime_type TEXT DEFAULT '',
    alt_text TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`)

const seedConfig = db.prepare('SELECT COUNT(*) as count FROM site_config').get()
if (seedConfig.count === 0) {
  const insertConfig = db.prepare('INSERT OR IGNORE INTO site_config (key, value) VALUES (?, ?)')
  const configs = [
    ['site.title', 'LiHui'],
    ['site.subTitle', 'Blog'],
    ['site.favicon', '/favicon/favicon.ico'],
    ['site.pageSize', '6'],
    ['toc.enable', 'true'],
    ['toc.depth', '3'],
    ['blogNavi.enable', 'true'],
    ['comments.enable', 'true'],
    ['comments.platform', 'default'],
    ['comments.backendUrl', 'https://eckes.de5.net/api'],
    ['theme.AOS', 'true'],
    ['theme.LQIP', 'true'],
    ['theme.PhotoSwipe', 'true'],
    ['profile.avatar', 'assets/Motues.jpg'],
    ['profile.name', 'Motues'],
    ['profile.description', 'Life is colorful!'],
    ['profile.indexPage', 'https://www.motues.top'],
    ['profile.startYear', '2024'],
    ['license.enable', 'true'],
    ['license.name', 'CC BY-NC-SA 4.0'],
    ['license.url', 'https://creativecommons.org/licenses/by-nc-sa/4.0/'],
  ]
  const insertMany = db.transaction((items) => {
    for (const [key, value] of items) {
      insertConfig.run(key, value)
    }
  })
  insertMany(configs)
}

const seedUser = db.prepare('SELECT COUNT(*) as count FROM users').get()
if (seedUser.count === 0) {
  const hashedPassword = bcrypt.hashSync('admin123', 10)
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hashedPassword)
}

const seedLinks = db.prepare('SELECT COUNT(*) as count FROM friend_links').get()
if (seedLinks.count === 0) {
  const insertLink = db.prepare('INSERT INTO friend_links (name, avatar, url, description, sort_order) VALUES (?, ?, ?, ?, ?)')
  const links = [
    ['Motues', 'https://www.motues.top/avatar.jpg', 'https://www.motues.top', 'Like River!', 0],
    ['Astro', 'https://avatars.githubusercontent.com/u/44914786', 'https://astro.build', 'Build fast websites, faster.', 1],
  ]
  const insertMany = db.transaction((items) => {
    for (const [name, avatar, url, description, sort_order] of items) {
      insertLink.run(name, avatar, url, description, sort_order)
    }
  })
  insertMany(links)
}

export default db

try {
  db.exec('ALTER TABLE comments ADD COLUMN deleted INTEGER DEFAULT 0')
} catch (e) {
  if (!e.message.includes('duplicate column')) throw e
}
