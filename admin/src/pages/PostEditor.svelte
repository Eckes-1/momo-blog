<script>
import { posts, categories, media } from '../api.js'
import Icon from '@iconify/svelte'
import { addToast } from '../stores.svelte.js'
import { marked } from 'marked'
import { onSSE } from '../lib/sse.js'
import { onMount, onDestroy } from 'svelte'

marked.use({
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start(src) { return src.indexOf('==') },
      tokenizer(src) {
        const match = src.match(/^==([^=]+)==/)
        if (match) return { type: 'highlight', raw: match[0], text: match[1] }
      },
      renderer(token) { return `<mark>${token.text}</mark>` }
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      start(src) { return src.indexOf('[^') },
      tokenizer(src) {
        const match = src.match(/^\[\^(\d+)\]/)
        if (match) return { type: 'footnoteRef', raw: match[0], id: match[1] }
      },
      renderer(token) { return `<sup><a href="#fn-${token.id}" id="fnref-${token.id}">[${token.id}]</a></sup>` }
    },
    {
      name: 'footnoteDef',
      level: 'block',
      start(src) { return src.indexOf('[^') },
      tokenizer(src) {
        const match = src.match(/^\[\^(\d+)\]:\s+(.+)(?:\n|$)/)
        if (match) return { type: 'footnoteDef', raw: match[0], id: match[1], text: match[2] }
      },
      renderer(token) { return `<p id="fn-${token.id}">[${token.id}] ${token.text}</p>` }
    }
  ]
})

let { routeParams, route } = $props()

let isEdit = $derived(route.includes('/edit'))
let postId = $derived(routeParams?.id || null)

let title = $state('')
let slug = $state('')
let categoryId = $state('')
let description = $state('')
let cover = $state('')
let content = $state('')
let pin = $state(0)
let draft = $state(true)
let pubDate = $state('')
let tags = $state('')
let categoryList = $state([])
let loading = $state(false)
let saving = $state(false)
let showPreview = $state(false)
let splitView = $state(true)
let showMediaPicker = $state(false)
let mediaList = $state([])
let mediaLoading = $state(false)
let lastSavedContent = $state('')
let autoSaveTimer = null
let hasUnsavedChanges = $state(false)
let showSeoPreview = $state(false)
let showShortcuts = $state(false)
let textareaEl = $state(null)

let htmlPreview = $state('')
let previewDebounce = null

let fullscreen = $state(false)
let showInsertMedia = $state(false)
let insertMediaList = $state([])
let insertMediaLoading = $state(false)
let insertMediaSearch = $state('')
let wordGoal = $state(parseInt(localStorage.getItem('word-goal') || '0'))
let showToc = $state(false)
let revisionHistory = $state([])
let showRevisions = $state(false)
let lastAutoSaveTime = $state(null)

let wordCount = $derived(content ? content.replace(/\s+/g, '').length : 0)
let readingTime = $derived(Math.max(1, Math.ceil(wordCount / 500)))
let charCount = $derived(content.length)
let paragraphCount = $derived(content ? content.split(/\n\s*\n/).filter(p => p.trim()).length : 0)
let headingCount = $derived((content.match(/^#{1,6}\s/gm) || []).length)
let imageCount = $derived((content.match(/!\[.*?\]\(.*?\)/g) || []).length)
let linkCount = $derived((content.match(/\[.*?\]\(.*?\)/g) || []).length - imageCount)
let wordGoalProgress = $derived(wordGoal > 0 ? Math.min(100, Math.round(wordCount / wordGoal * 100)) : 0)

let tocItems = $derived.by(() => {
  const headings = []
  const regex = /^(#{1,6})\s+(.+)$/gm
  let match
  while ((match = regex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].replace(/[*_~`]/g, ''),
      id: match[2].toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '')
    })
  }
  return headings
})

$effect(() => {
  const c = content
  if (previewDebounce) clearTimeout(previewDebounce)
  previewDebounce = setTimeout(() => {
    htmlPreview = c ? marked(c) : ''
  }, 100)
})

$effect(() => {
  hasUnsavedChanges = content !== lastSavedContent || title !== lastSavedTitle
})

let lastSavedTitle = $state('')

async function loadCategories() {
  try {
    const data = await categories.list()
    categoryList = data.data || data || []
  } catch (e) {}
}

async function loadPost() {
  if (!postId) return
  loading = true
  try {
    const data = await posts.get(postId)
    title = data.title || ''
    slug = data.slug_id || data.slug || ''
    categoryId = data.category || ''
    description = data.description || ''
    cover = data.image || data.cover || ''
    content = data.content || ''
    pin = data.pin_top ?? data.pin ?? 0
    draft = data.draft === 1 || data.draft === true
    pubDate = data.pub_date || ''
    tags = data.tags || ''
    lastSavedContent = content
    lastSavedTitle = title
  } catch (e) {
    addToast('加载文章失败', 'error')
  } finally {
    loading = false
  }
}

onMount(() => {
  loadCategories()
  loadPost()
  const off = onSSE((data) => {
    if (data.resources.includes('categories')) loadCategories()
  })
  startAutoSave()
  return () => { off(); stopAutoSave() }
})

function startAutoSave() {
  stopAutoSave()
  autoSaveTimer = setInterval(() => {
    if (hasUnsavedChanges && isEdit && postId && title && content) {
      handleSave(true)
      lastAutoSaveTime = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
  }, 30000)
}

function stopAutoSave() {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null }
}

async function handleSave(silent = false) {
  if (!title) { if (!silent) addToast('请输入标题', 'error'); return }
  if (!content) { if (!silent) addToast('请输入内容', 'error'); return }
  if (!slug) generateSlug()
  if (!slug) { if (!silent) addToast('无法生成有效的 slug，请手动输入', 'error'); return }

  saving = true
  try {
    const data = {
      title,
      slug_id: slug,
      category: categoryId,
      description,
      image: cover,
      content,
      pin_top: pin || 0,
      draft: draft ? 1 : 0,
      pub_date: pubDate || '',
      tags: tags || ''
    }
    if (isEdit && postId) {
      await posts.update(postId, data)
      saveRevision()
      lastSavedContent = content
      lastSavedTitle = title
      hasUnsavedChanges = false
      if (!silent) addToast('保存成功', 'success')
    } else {
      await posts.create(data)
      addToast('创建成功', 'success')
      location.hash = '#/posts'
    }
  } catch (e) {
    if (!silent) addToast(e.message || '保存失败', 'error')
  } finally {
    saving = false
  }
}

function saveRevision() {
  const key = `revisions-${postId}`
  const revs = JSON.parse(localStorage.getItem(key) || '[]')
  revs.unshift({
    time: new Date().toISOString(),
    title,
    content,
    wordCount
  })
  if (revs.length > 20) revs.length = 20
  localStorage.setItem(key, JSON.stringify(revs))
  revisionHistory = revs
}

function loadRevisions() {
  if (!postId) return
  const key = `revisions-${postId}`
  revisionHistory = JSON.parse(localStorage.getItem(key) || '[]')
}

function restoreRevision(rev) {
  if (!confirm('确定恢复到此版本？当前未保存的内容将丢失。')) return
  title = rev.title
  content = rev.content
  showRevisions = false
  addToast('已恢复版本', 'success')
}

function generateSlug() {
  if (slug && isEdit) return
  slug = title.toLowerCase()
    .replace(/[\u4e00-\u9fa5]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function insertMarkdown(prefix, suffix = '', placeholder = '') {
  if (!textareaEl) return
  const start = textareaEl.selectionStart
  const end = textareaEl.selectionEnd
  const selected = content.substring(start, end)
  const text = selected || placeholder
  const before = content.substring(0, start)
  const after = content.substring(end)
  content = before + prefix + text + suffix + after
  textareaEl.focus()
  const newPos = start + prefix.length + text.length
  requestAnimationFrame(() => {
    textareaEl.setSelectionRange(newPos, newPos)
  })
}

function insertAtCursor(text) {
  if (!textareaEl) return
  const start = textareaEl.selectionStart
  const before = content.substring(0, start)
  const after = content.substring(start)
  content = before + text + after
  textareaEl.focus()
  requestAnimationFrame(() => {
    textareaEl.setSelectionRange(start + text.length, start + text.length)
  })
}

function wrapLine(prefix) {
  if (!textareaEl) return
  const start = textareaEl.selectionStart
  const val = content
  let lineStart = val.lastIndexOf('\n', start - 1) + 1
  let lineEnd = val.indexOf('\n', start)
  if (lineEnd === -1) lineEnd = val.length
  const line = val.substring(lineStart, lineEnd)
  if (line.startsWith(prefix)) {
    content = val.substring(0, lineStart) + line.substring(prefix.length) + val.substring(lineEnd)
    requestAnimationFrame(() => {
      textareaEl.focus()
      const newStart = Math.max(lineStart, start - prefix.length)
      textareaEl.setSelectionRange(newStart, newStart)
    })
  } else {
    content = val.substring(0, lineStart) + prefix + line + val.substring(lineEnd)
    requestAnimationFrame(() => {
      textareaEl.focus()
      const newStart = start + prefix.length
      textareaEl.setSelectionRange(newStart, newStart)
    })
  }
}

let showFindReplace = $state(false)
let findText = $state('')
let replaceText = $state('')
let findResults = $state([])
let findIndex = $state(-1)

const toolbarActions = [
  { icon: 'mdi:format-header-1', title: '一级标题', action: () => wrapLine('# ') },
  { icon: 'mdi:format-header-2', title: '二级标题', action: () => wrapLine('## ') },
  { icon: 'mdi:format-header-3', title: '三级标题', action: () => wrapLine('### ') },
  { icon: 'mdi:format-header-4', title: '四级标题', action: () => wrapLine('#### ') },
  { type: 'separator' },
  { icon: 'mdi:format-bold', title: '加粗 (Ctrl+B)', action: () => insertMarkdown('**', '**', '粗体文字') },
  { icon: 'mdi:format-italic', title: '斜体 (Ctrl+I)', action: () => insertMarkdown('_', '_', '斜体文字') },
  { icon: 'mdi:format-strikethrough', title: '删除线', action: () => insertMarkdown('~~', '~~', '删除线文字') },
  { icon: 'mdi:format-color-highlight', title: '高亮', action: () => insertMarkdown('==', '==', '高亮文字') },
  { icon: 'mdi:format-superscript', title: '上标', action: () => insertMarkdown('^', '^', '上标') },
  { icon: 'mdi:format-subscript', title: '下标', action: () => insertMarkdown('~', '~', '下标') },
  { type: 'separator' },
  { icon: 'mdi:code-tags', title: '行内代码', action: () => insertMarkdown('`', '`', 'code') },
  { icon: 'mdi:code-braces', title: '代码块', action: () => insertMarkdown('\n```\n', '\n```\n', '代码') },
  { icon: 'mdi:function-variant', title: '数学公式(行内)', action: () => insertMarkdown('$', '$', 'E=mc^2') },
  { icon: 'mdi:sigma', title: '数学公式(块)', action: () => insertMarkdown('\n$$\n', '\n$$\n', 'E = mc^2') },
  { type: 'separator' },
  { icon: 'mdi:link-variant', title: '链接 (Ctrl+K)', action: () => {
    if (!textareaEl) return
    const start = textareaEl.selectionStart
    const end = textareaEl.selectionEnd
    const selected = content.substring(start, end)
    if (selected) {
      insertMarkdown('[', '](url)', selected)
    } else {
      insertMarkdown('[', '](url)', '链接文字')
    }
    requestAnimationFrame(() => {
      const urlStart = content.indexOf('](url)', start)
      if (urlStart !== -1) {
        textareaEl.setSelectionRange(urlStart + 2, urlStart + 5)
      }
    })
  }},
  { icon: 'mdi:image-outline', title: '插入图片', action: () => { showInsertMedia = true; loadInsertMedia() } },
  { icon: 'mdi:video-outline', title: '插入视频', action: () => insertAtCursor('\n<video src="" controls width="100%"></video>\n') },
  { type: 'separator' },
  { icon: 'mdi:format-list-bulleted', title: '无序列表', action: () => wrapLine('- ') },
  { icon: 'mdi:format-list-numbered', title: '有序列表', action: () => wrapLine('1. ') },
  { icon: 'mdi:checkbox-marked-outline', title: '任务列表', action: () => wrapLine('- [ ] ') },
  { icon: 'mdi:format-indent-increase', title: '增加缩进', action: () => wrapLine('  ') },
  { icon: 'mdi:format-indent-decrease', title: '减少缩进', action: () => {
    if (!textareaEl) return
    const start = textareaEl.selectionStart
    const val = content
    let lineStart = val.lastIndexOf('\n', start - 1) + 1
    const line = val.substring(lineStart)
    if (line.startsWith('  ')) {
      content = val.substring(0, lineStart) + line.substring(2)
      requestAnimationFrame(() => {
        textareaEl.focus()
        textareaEl.setSelectionRange(Math.max(lineStart, start - 2), Math.max(lineStart, start - 2))
      })
    }
  }},
  { icon: 'mdi:format-quote-close', title: '引用', action: () => wrapLine('> ') },
  { type: 'separator' },
  { icon: 'mdi:minus', title: '分割线', action: () => insertAtCursor('\n---\n') },
  { icon: 'mdi:table', title: '表格', action: () => insertAtCursor('\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n') },
  { icon: 'mdi:chevron-down-box-outline', title: '折叠块', action: () => insertAtCursor('\n<details>\n<summary>点击展开</summary>\n\n折叠内容\n\n</details>\n') },
  { icon: 'mdi:superscript', title: '脚注', action: () => {
    const refs = content.match(/\[\^(\d+)\](?!:)/g) || []
    const num = refs.length + 1
    insertAtCursor(`[^${num}]`)
    setTimeout(() => {
      content += `\n[^${num}]: 脚注内容`
    }, 10)
  }},
  { icon: 'mdi:keyboard-return', title: '换行', action: () => insertAtCursor('  \n') },
  { icon: 'mdi:comment-outline', title: 'HTML注释', action: () => insertMarkdown('<!-- ', ' -->', '注释内容') },
  { icon: 'mdi:find-replace', title: '查找替换 (Ctrl+H)', action: () => { showFindReplace = !showFindReplace; if (showFindReplace) findInContent() } },
]

function handleKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    handleSave()
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault()
    showPreview = !showPreview
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault()
    insertMarkdown('**', '**', '粗体文字')
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault()
    insertMarkdown('_', '_', '斜体文字')
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    if (!textareaEl) return
    const start = textareaEl.selectionStart
    const end = textareaEl.selectionEnd
    const selected = content.substring(start, end)
    if (selected) {
      insertMarkdown('[', '](url)', selected)
    } else {
      insertMarkdown('[', '](url)', '链接文字')
    }
    requestAnimationFrame(() => {
      const urlStart = content.indexOf('](url)', start)
      if (urlStart !== -1) {
        textareaEl.setSelectionRange(urlStart + 2, urlStart + 5)
      }
    })
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
    e.preventDefault()
    showFindReplace = !showFindReplace
    if (showFindReplace) findInContent()
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
    e.preventDefault()
    showInsertMedia = true
    loadInsertMedia()
  }
  if (e.key === 'Tab' && textareaEl === document.activeElement) {
    e.preventDefault()
    insertAtCursor('  ')
  }
  if (e.key === 'Escape') {
    if (fullscreen) { fullscreen = false; return }
    if (showInsertMedia) { showInsertMedia = false; return }
    if (showRevisions) { showRevisions = false; return }
    if (showFindReplace) { showFindReplace = false; return }
  }
}

function findInContent() {
  findResults = []
  findIndex = -1
  if (!findText || !textareaEl) return
  const lower = content.toLowerCase()
  const query = findText.toLowerCase()
  let pos = 0
  while (true) {
    const idx = lower.indexOf(query, pos)
    if (idx === -1) break
    findResults.push(idx)
    pos = idx + 1
  }
  if (findResults.length > 0) {
    findIndex = 0
    highlightFindResult()
  }
}

function highlightFindResult() {
  if (findIndex < 0 || findIndex >= findResults.length || !textareaEl) return
  const pos = findResults[findIndex]
  textareaEl.focus()
  textareaEl.setSelectionRange(pos, pos + findText.length)
}

function findNext() {
  if (findResults.length === 0) return
  findIndex = (findIndex + 1) % findResults.length
  highlightFindResult()
}

function findPrev() {
  if (findResults.length === 0) return
  findIndex = (findIndex - 1 + findResults.length) % findResults.length
  highlightFindResult()
}

function replaceCurrent() {
  if (findIndex < 0 || findIndex >= findResults.length || !textareaEl) return
  const pos = findResults[findIndex]
  content = content.substring(0, pos) + replaceText + content.substring(pos + findText.length)
  findInContent()
}

function replaceAll() {
  if (!findText) return
  const count = (content.match(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
  content = content.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceText)
  addToast(`已替换 ${count} 处`, 'success')
  findInContent()
}

function handleImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.md,.markdown,.txt'
  input.onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const text = await file.text()
      if (!content) {
        const lines = text.split('\n')
        if (lines[0]?.startsWith('# ')) {
          title = lines[0].replace(/^# /, '')
          content = lines.slice(1).join('\n').trim()
        } else {
          content = text
        }
      } else {
        content += '\n\n' + text
      }
      addToast(`已导入 ${file.name}`, 'success')
    } catch {
      addToast('导入失败', 'error')
    }
  }
  input.click()
}

function handleExport() {
  const md = `# ${title}\n\n${content}`
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug || 'post'}.md`
  a.click()
  URL.revokeObjectURL(url)
  addToast('已导出 Markdown', 'success')
}

async function loadMedia() {
  mediaLoading = true
  try {
    const data = await media.list({ pageSize: 30 })
    mediaList = data.media || data.data || []
  } catch {}
  mediaLoading = false
}

function selectMedia(item) {
  cover = item.path || item.url || ''
  showMediaPicker = false
  addToast('已选择封面', 'success')
}

async function uploadCover() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      addToast('上传中...', 'info')
      const data = await media.upload(file)
      cover = data.url
      addToast('封面上传成功', 'success')
    } catch (err) {
      addToast(err.message || '上传失败', 'error')
    }
  }
  input.click()
}

async function loadInsertMedia() {
  insertMediaLoading = true
  try {
    const params = { pageSize: 50 }
    if (insertMediaSearch) params.search = insertMediaSearch
    const data = await media.list(params)
    insertMediaList = (data.media || data.data || []).filter(m => (m.mime_type || '').startsWith('image/'))
  } catch {}
  insertMediaLoading = false
}

function insertMediaToContent(item) {
  const url = item.path || item.url || ''
  const alt = item.alt_text || item.filename || ''
  insertAtCursor(`![${alt}](${url})`)
  showInsertMedia = false
  addToast('已插入图片', 'success')
}

async function handleEditorUpload(file) {
  try {
    addToast('上传图片中...', 'info')
    const data = await media.upload(file)
    const url = data.url || data.path || ''
    insertAtCursor(`![${file.name}](${url})`)
    addToast('图片已上传并插入', 'success')
  } catch (err) {
    addToast(err.message || '上传失败', 'error')
  }
}

function handleEditorPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) {
        const ext = file.type.split('/')[1] || 'png'
        const namedFile = new File([file], `paste-${Date.now()}.${ext}`, { type: file.type })
        handleEditorUpload(namedFile)
      }
      return
    }
  }
}

function handleEditorDrop(e) {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
  if (imageFiles.length > 0) {
    e.preventDefault()
    imageFiles.forEach(f => handleEditorUpload(f))
  }
}

function handleBeforeUnload(e) {
  if (hasUnsavedChanges) {
    e.preventDefault()
    e.returnValue = ''
  }
}

function setWordGoal(val) {
  wordGoal = val
  if (val > 0) {
    localStorage.setItem('word-goal', String(val))
  } else {
    localStorage.removeItem('word-goal')
  }
}

function toggleFullscreen() {
  fullscreen = !fullscreen
  if (fullscreen) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
}

onMount(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  loadRevisions()
})

onDestroy(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  stopAutoSave()
  document.body.style.overflow = ''
})

let seoTitle = $derived(title || '文章标题')
let seoDesc = $derived(description || content.substring(0, 160).replace(/[#*`\n]/g, ' ').trim() || '文章描述...')
let seoUrl = $derived(`momo-blog.pages.dev/blog/${slug || 'post-slug'}`)
</script>

<svelte:window onkeydown={handleKeydown} />

{#if loading}
  <div class="flex items-center justify-center h-64">
    <div class="text-gray-400 dark:text-gray-500">加载中...</div>
  </div>
{:else}
  <div class="{fullscreen ? 'fixed inset-0 z-[100] bg-white/95 dark:bg-gray-900/95 backdrop-blur-2xl p-4 overflow-y-auto' : ''} space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div class="flex items-center gap-3">
        {#if fullscreen}
          <button onclick={toggleFullscreen} class="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
            <Icon icon="mdi:fullscreen-exit" width="16" height="16" />
            退出全屏
          </button>
        {:else}
          <a href="#/posts" class="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
            <Icon icon="mdi:arrow-left" width="16" height="16" />
            返回列表
          </a>
        {/if}
        {#if hasUnsavedChanges}
          <span class="text-xs text-amber-500 dark:text-amber-400 flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500 animate-pulse"></span>
            未保存
          </span>
        {/if}
        {#if lastAutoSaveTime}
          <span class="text-xs text-gray-400 dark:text-gray-500">上次自动保存 {lastAutoSaveTime}</span>
        {/if}
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button onclick={handleImport} title="导入 Markdown" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <Icon icon="mdi:import" width="18" height="18" />
        </button>
        <button onclick={handleExport} title="导出 Markdown" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <Icon icon="mdi:export" width="18" height="18" />
        </button>
        <button onclick={toggleFullscreen} title="全屏编辑" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <Icon icon={fullscreen ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'} width="18" height="18" />
        </button>
        <button onclick={() => showShortcuts = !showShortcuts} title="快捷键" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <Icon icon="mdi:keyboard" width="18" height="18" />
        </button>
        {#if isEdit && postId}
          <button onclick={() => { loadRevisions(); showRevisions = true }} title="版本历史" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <Icon icon="mdi:history" width="18" height="18" />
          </button>
        {/if}
        <div class="w-px h-5 bg-gray-200 dark:bg-gray-700"></div>
        <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span>{draft ? '草稿' : '已发布'}</span>
          <button
            onclick={() => draft = !draft}
            class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors {draft ? 'bg-yellow-400 dark:bg-yellow-500' : 'bg-green-500 dark:bg-green-400'}"
          >
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {draft ? 'translate-x-1' : 'translate-x-6'}"></span>
          </button>
        </label>
        <button
          onclick={() => handleSave()}
          disabled={saving}
          class="px-5 py-2 rounded-full bg-gray-900/80 dark:bg-gray-100/80 backdrop-blur hover:bg-gray-800/80 dark:hover:bg-gray-200/80 disabled:bg-gray-600/60 dark:disabled:bg-gray-500/60 text-white dark:text-gray-900 text-sm font-medium transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>

    {#if showShortcuts}
      <div class="bg-blue-50/80 dark:bg-blue-900/30 backdrop-blur border border-blue-200/50 dark:border-blue-800/50 rounded-xl p-4 text-sm">
        <div class="flex items-center justify-between mb-2">
          <span class="font-medium text-blue-800 dark:text-blue-300">快捷键</span>
          <button onclick={() => showShortcuts = false} class="text-blue-400 dark:text-blue-500 hover:text-blue-600 dark:hover:text-blue-400">
            <Icon icon="mdi:close" width="16" height="16" />
          </button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-blue-700 dark:text-blue-400">
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Ctrl+S</kbd> 保存</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Ctrl+B</kbd> 加粗</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Ctrl+I</kbd> 斜体</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Ctrl+K</kbd> 链接</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Ctrl+P</kbd> 预览</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Ctrl+H</kbd> 查找替换</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Ctrl+Shift+I</kbd> 插入图片</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Tab</kbd> 缩进</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Esc</kbd> 退出全屏</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Enter</kbd> 下一个查找</div>
          <div><kbd class="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded text-xs border border-gray-200 dark:border-gray-700">Shift+Enter</kbd> 上一个查找</div>
        </div>
      </div>
    {/if}

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="lg:col-span-2 space-y-3">
        <input
          type="text"
          bind:value={title}
          onblur={generateSlug}
          placeholder="文章标题"
          class="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none text-xl font-semibold"
        />

        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex gap-1">
            <button
              onclick={() => { showPreview = false; splitView = false }}
              class="px-3 py-1.5 rounded-lg text-sm {!showPreview && !splitView ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'} transition-colors"
            >
              <Icon icon="mdi:pencil" width="16" height="16" class="inline-block mr-1 -mt-0.5" />编辑
            </button>
            <button
              onclick={() => { showPreview = false; splitView = true }}
              class="px-3 py-1.5 rounded-lg text-sm {!showPreview && splitView ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'} transition-colors"
            >
              <Icon icon="mdi:split-vertical" width="16" height="16" class="inline-block mr-1 -mt-0.5" />分屏
            </button>
            <button
              onclick={() => { showPreview = true; splitView = false }}
              class="px-3 py-1.5 rounded-lg text-sm {showPreview ? 'bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'} transition-colors"
            >
              <Icon icon="mdi:eye" width="16" height="16" class="inline-block mr-1 -mt-0.5" />预览
            </button>
          </div>

          {#if !showPreview}
            <div class="flex items-center gap-0.5 flex-wrap max-w-full">
              {#each toolbarActions as btn}
                {#if btn.type === 'separator'}
                  <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5 shrink-0"></div>
                {:else}
                  <button
                    onclick={btn.action}
                    title={btn.title}
                    class="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300 transition-colors shrink-0"
                  >
                    <Icon icon={btn.icon} width="18" height="18" />
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>

        {#if showFindReplace}
          <div class="bg-amber-50/80 dark:bg-amber-900/20 backdrop-blur border border-amber-200/50 dark:border-amber-800/50 rounded-xl p-3 flex items-center gap-2 flex-wrap">
            <div class="relative flex-1 min-w-[120px]">
              <input
                type="text"
                placeholder="查找..."
                bind:value={findText}
                oninput={findInContent}
                onkeydown={(e) => { if (e.key === 'Enter') { e.shiftKey ? findPrev() : findNext() } }}
                class="w-full px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-700 bg-white/50 dark:bg-gray-800/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-600"
              />
            </div>
            <div class="relative flex-1 min-w-[120px]">
              <input
                type="text"
                placeholder="替换为..."
                bind:value={replaceText}
                class="w-full px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-700 bg-white/50 dark:bg-gray-800/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-600"
              />
            </div>
            <span class="text-xs text-amber-600 dark:text-amber-400 shrink-0">
              {#if findResults.length > 0}{findIndex + 1}/{findResults.length}{:else}0 结果{/if}
            </span>
            <button onclick={findPrev} class="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/50 transition-colors" title="上一个 (Shift+Enter)">
              <Icon icon="mdi:chevron-up" width="16" height="16" class="text-amber-600 dark:text-amber-400" />
            </button>
            <button onclick={findNext} class="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/50 transition-colors" title="下一个 (Enter)">
              <Icon icon="mdi:chevron-down" width="16" height="16" class="text-amber-600 dark:text-amber-400" />
            </button>
            <button onclick={replaceCurrent} disabled={findIndex < 0} class="px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-xs hover:bg-amber-200 dark:hover:bg-amber-700/50 disabled:opacity-50 transition-colors shrink-0">
              替换
            </button>
            <button onclick={replaceAll} disabled={findResults.length === 0} class="px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-xs hover:bg-amber-200 dark:hover:bg-amber-700/50 disabled:opacity-50 transition-colors shrink-0">
              全部替换
            </button>
            <button onclick={() => showFindReplace = false} class="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-800/50 transition-colors">
              <Icon icon="mdi:close" width="14" height="14" class="text-amber-500 dark:text-amber-400" />
            </button>
          </div>
        {/if}

        {#if showPreview}
          <div class="min-h-[500px] p-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur prose max-w-none overflow-y-auto">
            {#if htmlPreview}
              {@html htmlPreview}
            {:else}
              <p class="text-gray-400 dark:text-gray-500">暂无内容可预览</p>
            {/if}
          </div>
        {:else if splitView}
          <div class="grid grid-cols-2 gap-0 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden" style="min-height: 500px">
            <textarea
              bind:this={textareaEl}
              bind:value={content}
              onpaste={handleEditorPaste}
              ondrop={handleEditorDrop}
              ondragover={(e) => e.preventDefault()}
              placeholder="在此输入 Markdown 内容...&#10;&#10;支持粘贴图片、拖拽图片上传"
              class="w-full h-full min-h-[500px] px-4 py-3 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-0 focus:outline-none font-mono text-sm leading-relaxed resize-none border-r border-gray-200 dark:border-gray-700"
            ></textarea>
            <div class="h-full min-h-[500px] p-4 bg-white/30 dark:bg-gray-800/30 backdrop-blur prose max-w-none overflow-y-auto text-sm">
              {#if htmlPreview}
                {@html htmlPreview}
              {:else}
                <p class="text-gray-400 dark:text-gray-500">预览区域</p>
              {/if}
            </div>
          </div>
        {:else}
          <textarea
            bind:this={textareaEl}
            bind:value={content}
            onpaste={handleEditorPaste}
            ondrop={handleEditorDrop}
            ondragover={(e) => e.preventDefault()}
            placeholder="在此输入 Markdown 内容...&#10;&#10;支持粘贴图片、拖拽图片上传"
            class="w-full min-h-[500px] px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none font-mono text-sm leading-relaxed resize-y"
          ></textarea>
        {/if}

        <div class="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500 flex-wrap">
          <span>{charCount} 字符</span>
          <span>{wordCount} 字</span>
          <span>约 {readingTime} 分钟阅读</span>
          <span>{paragraphCount} 段落</span>
          <span>{headingCount} 标题</span>
          <span>{imageCount} 图片</span>
          <span>{linkCount} 链接</span>
          <span>{content.split('\n').length} 行</span>
        </div>

        {#if wordGoal > 0}
          <div class="flex items-center gap-3">
            <div class="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                class="h-full rounded-full transition-all {wordGoalProgress >= 100 ? 'bg-green-500' : wordGoalProgress >= 60 ? 'bg-blue-500' : 'bg-amber-500'}"
                style="width: {wordGoalProgress}%"
              ></div>
            </div>
            <span class="text-xs {wordGoalProgress >= 100 ? 'text-green-500' : 'text-gray-400 dark:text-gray-500'} shrink-0">
              {wordCount}/{wordGoal} 字 {wordGoalProgress >= 100 ? '🎉' : `(${wordGoalProgress}%)`}
            </span>
          </div>
        {/if}
      </div>

      <div class="space-y-4">
        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <Icon icon="mdi:cog" width="16" height="16" />
            发布设置
          </h3>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Slug ID</label>
            <input
              type="text"
              bind:value={slug}
              placeholder="url-friendly-id"
              class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">分类</label>
            <select
              bind:value={categoryId}
              class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 text-sm outline-none"
            >
              <option value="">未分类</option>
              {#each categoryList as cat}
                <option value={cat.name}>{cat.name}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">标签</label>
            <input
              type="text"
              bind:value={tags}
              placeholder="用逗号分隔，如：技术,前端,教程"
              class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">发布日期</label>
            <input
              type="date"
              bind:value={pubDate}
              class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">置顶排序</label>
            <input
              type="number"
              bind:value={pin}
              min="0"
              placeholder="0 = 不置顶，数字越大越靠前"
              class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">字数目标</label>
            <div class="flex gap-2">
              <input
                type="number"
                value={wordGoal}
                onchange={(e) => setWordGoal(parseInt(e.target.value) || 0)}
                min="0"
                placeholder="0 = 不设目标"
                class="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
              />
              {#if wordGoal > 0}
                <button
                  onclick={() => setWordGoal(0)}
                  class="px-2 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="清除目标"
                >
                  <Icon icon="mdi:close" width="14" height="14" />
                </button>
              {/if}
            </div>
          </div>
        </div>

        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 p-4 space-y-4">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <Icon icon="mdi:text" width="16" height="16" />
            文章描述
          </h3>
          <textarea
            bind:value={description}
            placeholder="文章简短描述，用于 SEO 和摘要展示"
            rows="3"
            maxlength="300"
            class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none resize-y"
          ></textarea>
          <div class="text-xs text-gray-400 dark:text-gray-500 text-right">{(description || '').length}/300</div>
        </div>

        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <Icon icon="mdi:image" width="16" height="16" />
            封面图片
          </h3>
          <input
            type="text"
            bind:value={cover}
            placeholder="https://..."
            class="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 backdrop-blur text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent outline-none"
          />
          <div class="flex gap-2">
            <button
              onclick={uploadCover}
              class="flex-1 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-sm hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
            >
              <Icon icon="mdi:upload" width="14" height="14" class="inline-block mr-1 -mt-0.5" />上传
            </button>
            <button
              onclick={() => { showMediaPicker = !showMediaPicker; if (showMediaPicker) loadMedia() }}
              class="flex-1 py-2 rounded-xl bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-sm hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
            >
              <Icon icon="mdi:folder-image" width="14" height="14" class="inline-block mr-1 -mt-0.5" />媒体库
            </button>
            {#if cover}
              <button
                onclick={() => { cover = '' }}
                class="py-2 px-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 text-sm hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              >
                <Icon icon="mdi:delete" width="14" height="14" />
              </button>
            {/if}
          </div>
          {#if cover}
            <img src={cover} alt="封面预览" class="w-full rounded-xl max-h-40 object-cover border border-gray-100 dark:border-gray-800" onerror={() => {}} />
          {/if}

          {#if showMediaPicker}
            <div class="border border-gray-200 dark:border-gray-700 rounded-xl p-3 max-h-48 overflow-y-auto bg-white/50 dark:bg-gray-800/50">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-medium text-gray-600 dark:text-gray-400">选择文件</span>
                <button onclick={() => showMediaPicker = false} class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                  <Icon icon="mdi:close" width="14" height="14" />
                </button>
              </div>
              {#if mediaLoading}
                <div class="text-center text-xs text-gray-400 dark:text-gray-500 py-4">加载中...</div>
              {:else if mediaList.length === 0}
                <div class="text-center text-xs text-gray-400 dark:text-gray-500 py-4">暂无媒体文件</div>
              {:else}
                <div class="grid grid-cols-3 gap-2">
                  {#each mediaList as item}
                    <button
                      onclick={() => selectMedia(item)}
                      class="aspect-square rounded-lg overflow-hidden border-2 hover:border-blue-400 dark:hover:border-blue-300 transition-colors {cover === (item.path || item.url) ? 'border-blue-500 dark:border-blue-400' : 'border-transparent'} bg-gray-50 dark:bg-gray-800 flex items-center justify-center"
                    >
                      {#if (item.mime_type || '').startsWith('image/')}
                        <img src={item.path || item.url} alt="" class="w-full h-full object-cover" />
                      {:else}
                        <div class="flex flex-col items-center gap-1 p-1">
                          <Icon icon="mdi:file" width="20" height="20" class="text-gray-400 dark:text-gray-500" />
                          <span class="text-[9px] text-gray-500 dark:text-gray-400 truncate w-full text-center">{item.filename || '文件'}</span>
                        </div>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <Icon icon="mdi:format-list-bulleted" width="16" height="16" />
              文章大纲
            </h3>
            <button
              onclick={() => showToc = !showToc}
              class="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showToc ? '收起' : '展开'}
            </button>
          </div>
          {#if showToc}
            {#if tocItems.length > 0}
              <div class="space-y-0.5 max-h-48 overflow-y-auto">
                {#each tocItems as item}
                  <div
                    class="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer truncate transition-colors"
                    style="padding-left: {(item.level - 1) * 12}px"
                    title={item.text}
                  >
                    <Icon icon="mdi:circle-small" width="14" height="14" class="inline-block -mt-0.5" />
                    {item.text}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-xs text-gray-400 dark:text-gray-500">暂无标题</p>
            {/if}
          {/if}
        </div>

        <div class="bg-white/60 dark:bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <Icon icon="mdi:magnify" width="16" height="16" />
              SEO 预览
            </h3>
            <button
              onclick={() => showSeoPreview = !showSeoPreview}
              class="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showSeoPreview ? '收起' : '展开'}
            </button>
          </div>
          {#if showSeoPreview}
            <div class="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
              <div class="text-blue-700 dark:text-blue-400 text-base font-medium truncate hover:underline cursor-pointer">{seoTitle}</div>
              <div class="text-green-700 dark:text-green-400 text-xs mt-0.5">{seoUrl}</div>
              <div class="text-gray-500 dark:text-gray-400 text-xs mt-1 line-clamp-2">{seoDesc}</div>
            </div>
            <div class="text-xs text-gray-400 dark:text-gray-500">
              标题 {(seoTitle || '').length}/60 · 描述 {(seoDesc || '').length}/160
              {#if (seoTitle || '').length > 60}
                <span class="text-amber-500 ml-1">标题过长</span>
              {/if}
              {#if (seoDesc || '').length > 160}
                <span class="text-amber-500 ml-1">描述过长</span>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showInsertMedia}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center z-50" onclick={() => showInsertMedia = false}>
    <div class="bg-white/90 dark:bg-gray-800/90 backdrop-blur-2xl rounded-t-2xl sm:rounded-2xl shadow-lg p-4 sm:p-5 max-w-lg w-full sm:mx-3 border border-white/20 dark:border-gray-700/20 max-h-[80vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">插入图片</h3>
        <button onclick={() => showInsertMedia = false} class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          <Icon icon="mdi:close" width="18" height="18" />
        </button>
      </div>
      <div class="relative mb-3">
        <Icon icon="mdi:magnify" width="14" height="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder="搜索图片..."
          bind:value={insertMediaSearch}
          oninput={() => loadInsertMedia()}
          class="w-full pl-7 pr-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600"
        />
      </div>
      {#if insertMediaLoading}
        <div class="text-center text-sm text-gray-400 dark:text-gray-500 py-8">加载中...</div>
      {:else if insertMediaList.length === 0}
        <div class="text-center text-sm text-gray-400 dark:text-gray-500 py-8">暂无图片</div>
      {:else}
        <div class="grid grid-cols-3 gap-2">
          {#each insertMediaList as item}
            <button
              onclick={() => insertMediaToContent(item)}
              class="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-blue-400 dark:hover:border-blue-300 transition-colors bg-gray-50 dark:bg-gray-800"
            >
              <img src={item.path || item.url} alt={item.filename || ''} class="w-full h-full object-cover" />
            </button>
          {/each}
        </div>
      {/if}
      <div class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
        <button
          onclick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            input.onchange = async (e) => {
              const file = e.target.files[0]
              if (file) {
                showInsertMedia = false
                await handleEditorUpload(file)
              }
            }
            input.click()
          }}
          class="w-full py-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-sm hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors flex items-center justify-center gap-1"
        >
          <Icon icon="mdi:upload" width="14" height="14" />
          上传新图片
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showRevisions}
  <div class="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center z-50" onclick={() => showRevisions = false}>
    <div class="bg-white/90 dark:bg-gray-800/90 backdrop-blur-2xl rounded-t-2xl sm:rounded-2xl shadow-lg p-4 sm:p-5 max-w-md w-full sm:mx-3 border border-white/20 dark:border-gray-700/20 max-h-[80vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">版本历史</h3>
        <button onclick={() => showRevisions = false} class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
          <Icon icon="mdi:close" width="18" height="18" />
        </button>
      </div>
      {#if revisionHistory.length === 0}
        <p class="text-sm text-gray-400 dark:text-gray-500 text-center py-8">暂无保存记录</p>
      {:else}
        <div class="space-y-2">
          {#each revisionHistory as rev, idx}
            <button
              onclick={() => restoreRevision(rev)}
              class="w-full text-left p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(rev.time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span class="text-xs text-gray-400 dark:text-gray-500">{rev.wordCount || 0} 字</span>
              </div>
              <p class="text-sm text-gray-700 dark:text-gray-300 truncate mt-0.5">{rev.title || '无标题'}</p>
              {#if idx === 0}
                <span class="text-[10px] text-green-500 mt-0.5 inline-block">当前版本</span>
              {:else}
                <span class="text-[10px] text-blue-500 mt-0.5 inline-block">点击恢复</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
