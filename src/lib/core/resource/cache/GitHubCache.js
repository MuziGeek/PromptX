const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')
const logger = require('../../../utils/logger')

/**
 * GitHub资源缓存管理器
 * 负责GitHub文件的本地缓存，支持TTL和版本管理
 */
class GitHubCache {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(process.cwd(), '.promptx', 'cache', 'github')
    this.ttl = options.ttl || 3600 // 默认1小时TTL
    this.maxSize = options.maxSize || 100 // 最大缓存文件数
    this.enabled = options.enabled !== false
    this.memoryCache = new Map() // 内存缓存
    this.initialized = false
  }

  /**
   * 初始化缓存管理器
   */
  async initialize() {
    if (!this.enabled) {
      logger.debug('[GitHubCache] 缓存已禁用')
      return
    }

    try {
      await fs.ensureDir(this.cacheDir)
      await this._cleanupExpiredCache()
      this.initialized = true
      logger.debug(`[GitHubCache] 缓存初始化完成: ${this.cacheDir}`)
    } catch (error) {
      logger.error(`[GitHubCache] 缓存初始化失败: ${error.message}`)
      this.enabled = false
    }
  }

  /**
   * 生成缓存键
   * @param {string} owner - 仓库所有者
   * @param {string} repo - 仓库名称
   * @param {string} path - 文件路径
   * @param {string} branch - 分支名称
   * @returns {string} 缓存键
   */
  _generateCacheKey(owner, repo, path, branch = 'main') {
    const content = `${owner}/${repo}@${branch}:${path}`
    return crypto.createHash('md5').update(content).digest('hex')
  }

  /**
   * 获取缓存文件路径
   * @param {string} cacheKey - 缓存键
   * @returns {string} 缓存文件路径
   */
  _getCacheFilePath(cacheKey) {
    return path.join(this.cacheDir, `${cacheKey}.json`)
  }

  /**
   * 获取缓存项
   * @param {string} owner - 仓库所有者
   * @param {string} repo - 仓库名称
   * @param {string} filePath - 文件路径
   * @param {string} branch - 分支名称
   * @returns {Promise<Object|null>} 缓存项或null
   */
  async get(owner, repo, filePath, branch = 'main') {
    if (!this.enabled) {
      return null
    }

    const cacheKey = this._generateCacheKey(owner, repo, filePath, branch)
    
    // 先检查内存缓存
    if (this.memoryCache.has(cacheKey)) {
      const item = this.memoryCache.get(cacheKey)
      if (this._isValidCacheItem(item)) {
        logger.debug(`[GitHubCache] 内存缓存命中: ${owner}/${repo}@${branch}:${filePath}`)
        return item
      } else {
        this.memoryCache.delete(cacheKey)
      }
    }

    // 检查磁盘缓存
    try {
      const cacheFilePath = this._getCacheFilePath(cacheKey)
      if (await fs.pathExists(cacheFilePath)) {
        const item = await fs.readJSON(cacheFilePath)
        if (this._isValidCacheItem(item)) {
          // 加载到内存缓存
          this.memoryCache.set(cacheKey, item)
          logger.debug(`[GitHubCache] 磁盘缓存命中: ${owner}/${repo}@${branch}:${filePath}`)
          return item
        } else {
          // 删除过期的缓存文件
          await fs.remove(cacheFilePath)
        }
      }
    } catch (error) {
      logger.warn(`[GitHubCache] 读取缓存失败 ${owner}/${repo}@${branch}:${filePath}: ${error.message}`)
    }

    return null
  }

  /**
   * 设置缓存项
   * @param {string} owner - 仓库所有者
   * @param {string} repo - 仓库名称
   * @param {string} filePath - 文件路径
   * @param {string} branch - 分支名称
   * @param {string} content - 内容
   * @param {Object} metadata - 元数据
   */
  async set(owner, repo, filePath, branch = 'main', content, metadata = {}) {
    if (!this.enabled) {
      return
    }

    const cacheKey = this._generateCacheKey(owner, repo, filePath, branch)
    const now = Date.now()
    
    const cacheItem = {
      owner,
      repo,
      filePath,
      branch,
      content,
      metadata,
      cachedAt: now,
      expiresAt: now + (this.ttl * 1000),
      sha: metadata.sha,
      lastCommitDate: metadata.lastCommitDate
    }

    try {
      // 保存到内存缓存
      this.memoryCache.set(cacheKey, cacheItem)

      // 保存到磁盘缓存
      const cacheFilePath = this._getCacheFilePath(cacheKey)
      await fs.writeJSON(cacheFilePath, cacheItem)

      logger.debug(`[GitHubCache] 缓存已保存: ${owner}/${repo}@${branch}:${filePath}`)

      // 检查缓存大小限制
      await this._enforceMaxSize()
    } catch (error) {
      logger.error(`[GitHubCache] 保存缓存失败 ${owner}/${repo}@${branch}:${filePath}: ${error.message}`)
    }
  }

  /**
   * 检查缓存是否有效（基于SHA或提交时间）
   * @param {string} owner - 仓库所有者
   * @param {string} repo - 仓库名称
   * @param {string} filePath - 文件路径
   * @param {string} branch - 分支名称
   * @param {Object} remoteMetadata - 远程文件元数据
   * @returns {Promise<boolean>} 是否有效
   */
  async isValid(owner, repo, filePath, branch = 'main', remoteMetadata) {
    const cacheItem = await this.get(owner, repo, filePath, branch)
    if (!cacheItem) {
      return false
    }

    // 检查SHA
    if (remoteMetadata.sha && cacheItem.sha) {
      return remoteMetadata.sha === cacheItem.sha
    }

    // 检查提交时间
    if (remoteMetadata.lastCommitDate && cacheItem.lastCommitDate) {
      return new Date(remoteMetadata.lastCommitDate).getTime() <= new Date(cacheItem.lastCommitDate).getTime()
    }

    // 如果没有元数据比较，检查TTL
    return this._isValidCacheItem(cacheItem)
  }

  /**
   * 删除缓存项
   * @param {string} owner - 仓库所有者
   * @param {string} repo - 仓库名称
   * @param {string} filePath - 文件路径
   * @param {string} branch - 分支名称
   */
  async delete(owner, repo, filePath, branch = 'main') {
    if (!this.enabled) {
      return
    }

    const cacheKey = this._generateCacheKey(owner, repo, filePath, branch)
    
    // 从内存缓存删除
    this.memoryCache.delete(cacheKey)

    // 从磁盘缓存删除
    try {
      const cacheFilePath = this._getCacheFilePath(cacheKey)
      await fs.remove(cacheFilePath)
      logger.debug(`[GitHubCache] 缓存已删除: ${owner}/${repo}@${branch}:${filePath}`)
    } catch (error) {
      logger.warn(`[GitHubCache] 删除缓存失败 ${owner}/${repo}@${branch}:${filePath}: ${error.message}`)
    }
  }

  /**
   * 清空指定仓库的所有缓存
   * @param {string} owner - 仓库所有者
   * @param {string} repo - 仓库名称
   * @param {string} branch - 分支名称（可选）
   */
  async clearRepository(owner, repo, branch = null) {
    if (!this.enabled) {
      return
    }

    const prefix = branch ? `${owner}/${repo}@${branch}:` : `${owner}/${repo}@`
    let clearedCount = 0

    // 清理内存缓存
    for (const [key, item] of this.memoryCache.entries()) {
      const itemKey = `${item.owner}/${item.repo}@${item.branch}:${item.filePath}`
      if (itemKey.startsWith(prefix)) {
        this.memoryCache.delete(key)
        clearedCount++
      }
    }

    // 清理磁盘缓存
    try {
      if (await fs.pathExists(this.cacheDir)) {
        const files = await fs.readdir(this.cacheDir)
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(this.cacheDir, file)
            try {
              const item = await fs.readJSON(filePath)
              const itemKey = `${item.owner}/${item.repo}@${item.branch}:${item.filePath}`
              if (itemKey.startsWith(prefix)) {
                await fs.remove(filePath)
                clearedCount++
              }
            } catch (error) {
              // 删除损坏的缓存文件
              await fs.remove(filePath)
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`[GitHubCache] 清理仓库缓存失败: ${error.message}`)
    }

    logger.info(`[GitHubCache] 已清理仓库缓存 ${owner}/${repo}: ${clearedCount} 个文件`)
  }

  /**
   * 清空所有缓存
   */
  async clear() {
    if (!this.enabled) {
      return
    }

    try {
      // 清空内存缓存
      this.memoryCache.clear()

      // 清空磁盘缓存
      await fs.emptyDir(this.cacheDir)
      logger.info('[GitHubCache] 所有缓存已清空')
    } catch (error) {
      logger.error(`[GitHubCache] 清空缓存失败: ${error.message}`)
    }
  }

  /**
   * 获取缓存统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    const stats = {
      enabled: this.enabled,
      memoryCache: {
        size: this.memoryCache.size,
        items: []
      },
      diskCache: {
        size: 0,
        totalSize: 0,
        items: []
      }
    }

    // 内存缓存统计
    for (const [key, item] of this.memoryCache.entries()) {
      stats.memoryCache.items.push({
        key,
        repository: `${item.owner}/${item.repo}`,
        branch: item.branch,
        path: item.filePath,
        cachedAt: item.cachedAt,
        expiresAt: item.expiresAt
      })
    }

    // 磁盘缓存统计
    if (this.enabled && await fs.pathExists(this.cacheDir)) {
      try {
        const files = await fs.readdir(this.cacheDir)
        stats.diskCache.size = files.length

        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(this.cacheDir, file)
            try {
              const stat = await fs.stat(filePath)
              const item = await fs.readJSON(filePath)
              
              stats.diskCache.totalSize += stat.size
              stats.diskCache.items.push({
                file,
                size: stat.size,
                mtime: stat.mtime,
                repository: `${item.owner}/${item.repo}`,
                branch: item.branch,
                path: item.filePath
              })
            } catch (error) {
              // 忽略损坏的缓存文件
            }
          }
        }
      } catch (error) {
        logger.warn(`[GitHubCache] 获取缓存统计失败: ${error.message}`)
      }
    }

    return stats
  }

  /**
   * 检查缓存项是否有效
   * @private
   */
  _isValidCacheItem(item) {
    if (!item || !item.expiresAt) {
      return false
    }
    return Date.now() < item.expiresAt
  }

  /**
   * 清理过期缓存
   * @private
   */
  async _cleanupExpiredCache() {
    if (!await fs.pathExists(this.cacheDir)) {
      return
    }

    try {
      const files = await fs.readdir(this.cacheDir)
      let cleanedCount = 0

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.cacheDir, file)
          try {
            const item = await fs.readJSON(filePath)
            if (!this._isValidCacheItem(item)) {
              await fs.remove(filePath)
              cleanedCount++
            }
          } catch (error) {
            // 删除损坏的缓存文件
            await fs.remove(filePath)
            cleanedCount++
          }
        }
      }

      if (cleanedCount > 0) {
        logger.debug(`[GitHubCache] 清理过期缓存: ${cleanedCount} 个文件`)
      }
    } catch (error) {
      logger.warn(`[GitHubCache] 清理过期缓存失败: ${error.message}`)
    }
  }

  /**
   * 强制执行最大缓存大小限制
   * @private
   */
  async _enforceMaxSize() {
    if (!await fs.pathExists(this.cacheDir)) {
      return
    }

    try {
      const files = await fs.readdir(this.cacheDir)
      const cacheFiles = files.filter(f => f.endsWith('.json'))

      if (cacheFiles.length <= this.maxSize) {
        return
      }

      // 获取文件信息并按修改时间排序
      const fileInfos = []
      for (const file of cacheFiles) {
        const filePath = path.join(this.cacheDir, file)
        const stat = await fs.stat(filePath)
        fileInfos.push({ file, path: filePath, mtime: stat.mtime })
      }

      // 按修改时间升序排序（最旧的在前）
      fileInfos.sort((a, b) => a.mtime - b.mtime)

      // 删除最旧的文件
      const toDelete = fileInfos.slice(0, fileInfos.length - this.maxSize)
      for (const { path: filePath } of toDelete) {
        await fs.remove(filePath)
      }

      logger.debug(`[GitHubCache] 强制清理缓存: 删除 ${toDelete.length} 个最旧文件`)
    } catch (error) {
      logger.warn(`[GitHubCache] 强制清理缓存失败: ${error.message}`)
    }
  }
}

module.exports = GitHubCache
