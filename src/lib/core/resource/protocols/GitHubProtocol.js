const logger = require('../../../utils/logger')
const GitHubAdapter = require('../../../adapters/GitHubAdapter')
const GitHubCache = require('../cache/GitHubCache')
const GitHubConfigManager = require('../../../utils/GitHubConfigManager')

/**
 * GitHub协议解析器
 * 处理 @github://owner/repo/path/file.md 或 @github://owner/repo@branch/path/file.md 格式的资源引用
 */
class GitHubProtocol {
  constructor() {
    this.name = 'github'
    this.githubAdapter = new GitHubAdapter()
    this.githubCache = null
    this.configManager = new GitHubConfigManager()
    this.initialized = false
  }

  /**
   * 初始化协议解析器
   */
  async initialize() {
    if (this.initialized) {
      return
    }

    try {
      // 初始化配置管理器
      await this.configManager.initialize()
      
      // 初始化缓存管理器
      const config = this.configManager.getConfig()
      this.githubCache = new GitHubCache({
        enabled: config.cache?.enabled,
        ttl: config.cache?.ttl,
        maxSize: config.cache?.maxSize
      })
      await this.githubCache.initialize()

      this.initialized = true
      logger.debug('[GitHubProtocol] 协议解析器初始化完成')
    } catch (error) {
      logger.error(`[GitHubProtocol] 初始化失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 解析GitHub路径（不包含协议前缀）
   * @param {string} path - GitHub路径，如 'MuziGeeK/promptX_Role@main/frontend-developer/frontend-developer.role.md'
   * @returns {Object} 解析结果
   */
  parseGitHubPath(path) {
    // 移除可能的协议前缀
    const cleanPath = path.replace(/^@github:\/\//, '')

    // 检查是否包含分支信息
    let owner, repo, branch = null, filePath

    if (cleanPath.includes('@')) {
      // 格式：owner/repo@branch/path/file.md
      // 找到@符号的位置来正确分割
      const atIndex = cleanPath.indexOf('@')
      const beforeAt = cleanPath.substring(0, atIndex)
      const afterAt = cleanPath.substring(atIndex + 1)

      // 分割owner/repo部分
      const [ownerName, repoName] = beforeAt.split('/')

      // 分割branch/path部分
      const slashIndex = afterAt.indexOf('/')
      if (slashIndex === -1) {
        // 只有分支，没有路径
        branch = afterAt
        filePath = ''
      } else {
        branch = afterAt.substring(0, slashIndex)
        filePath = afterAt.substring(slashIndex + 1)
      }

      if (!ownerName || !repoName || !branch) {
        throw new Error(`无效的GitHub路径格式: ${path}`)
      }

      owner = ownerName
      repo = repoName
    } else {
      // 格式：owner/repo/path/file.md
      const parts = cleanPath.split('/')
      if (parts.length < 3) {
        throw new Error(`无效的GitHub路径格式: ${path}`)
      }

      owner = parts[0]
      repo = parts[1]
      filePath = parts.slice(2).join('/')
    }

    return {
      owner,
      repo,
      branch,
      filePath,
      repoKey: `${owner}/${repo}`
    }
  }

  /**
   * 解析GitHub协议URL
   * @param {string} url - GitHub协议URL，格式：@github://owner/repo/path/file.md 或 @github://owner/repo@branch/path/file.md
   * @returns {Object} 解析结果
   */
  parseUrl(url) {
    // 移除协议前缀
    const urlWithoutProtocol = url.replace(/^@github:\/\//, '')

    // 检查是否包含分支信息
    let owner, repo, branch = 'main', filePath

    if (urlWithoutProtocol.includes('@')) {
      // 格式：owner/repo@branch/path/file.md
      // 找到@符号的位置来正确分割
      const atIndex = urlWithoutProtocol.indexOf('@')
      const beforeAt = urlWithoutProtocol.substring(0, atIndex)
      const afterAt = urlWithoutProtocol.substring(atIndex + 1)

      // 分割owner/repo部分
      const [ownerName, repoName] = beforeAt.split('/')

      // 分割branch/path部分
      const slashIndex = afterAt.indexOf('/')
      if (slashIndex === -1) {
        // 只有分支，没有路径
        branch = afterAt
        filePath = ''
      } else {
        branch = afterAt.substring(0, slashIndex)
        filePath = afterAt.substring(slashIndex + 1)
      }

      // 调试信息
      logger.debug(`[GitHubProtocol] 解析URL: ${url}`)
      logger.debug(`[GitHubProtocol] urlWithoutProtocol: ${urlWithoutProtocol}`)
      logger.debug(`[GitHubProtocol] beforeAt: ${beforeAt}, afterAt: ${afterAt}`)
      logger.debug(`[GitHubProtocol] ownerName: ${ownerName}, repoName: ${repoName}`)
      logger.debug(`[GitHubProtocol] branch: ${branch}, filePath: ${filePath}`)

      if (!ownerName || !repoName || !branch) {
        logger.error(`[GitHubProtocol] URL解析失败 - ownerName: ${ownerName}, repoName: ${repoName}, branch: ${branch}`)
        throw new Error(`无效的GitHub URL格式: ${url}`)
      }

      owner = ownerName
      repo = repoName
      // branch和filePath已经在上面设置了
    } else {
      // 格式：owner/repo/path/file.md
      const parts = urlWithoutProtocol.split('/')
      if (parts.length < 3) {
        throw new Error(`无效的GitHub URL格式: ${url}`)
      }

      owner = parts[0]
      repo = parts[1]
      filePath = parts.slice(2).join('/')
    }

    logger.debug(`[GitHubProtocol] 解析结果 - owner: ${owner}, repo: ${repo}, branch: ${branch}, filePath: ${filePath}`)

    return {
      owner,
      repo,
      branch,
      filePath,
      repoKey: `${owner}/${repo}`,
      originalUrl: url
    }
  }

  /**
   * 解析GitHub协议路径（ResourceManager接口）
   * @param {string} path - GitHub路径，如 'MuziGeeK/promptX_Role@main/frontend-developer/frontend-developer.role.md'
   * @param {Object} queryParams - 查询参数（暂未使用）
   * @returns {Promise<string>} 文件内容
   */
  async resolve(path, queryParams = {}) {
    // 直接解析路径，不添加协议前缀
    await this.initialize()

    const { owner, repo, branch, filePath, repoKey } = this.parseGitHubPath(path)

    // 获取仓库配置
    const repoConfig = this.configManager.getRepositoryConfig(repoKey)
    if (!repoConfig) {
      throw new Error(`未找到仓库配置: ${repoKey}`)
    }

    if (!repoConfig.enabled) {
      throw new Error(`仓库已禁用: ${repoKey}`)
    }

    // 使用配置中的分支（如果URL中没有指定）
    const targetBranch = branch || repoConfig.branch || 'main'

    try {
      // 检查缓存
      const cachedItem = await this.githubCache.get(owner, repo, filePath, targetBranch)
      if (cachedItem) {
        // 获取远程文件的最新提交信息来验证缓存
        const lastCommit = await this.githubAdapter.getFileLastCommit(repoConfig, filePath, { branch: targetBranch })
        const remoteMetadata = {
          lastCommitDate: lastCommit?.date
        }

        if (await this.githubCache.isValid(owner, repo, filePath, targetBranch, remoteMetadata)) {
          logger.debug(`[GitHubProtocol] 使用缓存内容: ${path}`)
          return cachedItem.content
        }
      }

      // 从GitHub获取内容
      logger.debug(`[GitHubProtocol] 从GitHub加载内容: ${path}`)
      const result = await this.githubAdapter.getFileContent(repoConfig, filePath, { branch: targetBranch })

      // 获取文件的最后提交信息
      const lastCommit = await this.githubAdapter.getFileLastCommit(repoConfig, filePath, { branch: targetBranch })

      // 更新缓存
      const metadata = {
        ...result.metadata,
        lastCommitDate: lastCommit?.date,
        lastCommitSha: lastCommit?.sha,
        lastCommitMessage: lastCommit?.message
      }

      await this.githubCache.set(owner, repo, filePath, targetBranch, result.content, metadata)

      return result.content
    } catch (error) {
      logger.error(`[GitHubProtocol] 加载内容失败 ${path}: ${error.message}`)

      // 如果网络错误，尝试使用过期缓存
      if (this._isNetworkError(error)) {
        const cachedItem = await this.githubCache.get(owner, repo, filePath, targetBranch)
        if (cachedItem) {
          logger.warn(`[GitHubProtocol] 网络错误，使用过期缓存: ${path}`)
          return cachedItem.content
        }
      }

      throw error
    }
  }

  /**
   * 解析路径为绝对路径（用于兼容现有接口）
   * @param {string} relativePath - 相对路径
   * @returns {Promise<string>} 解析后的内容
   */
  async resolvePath(relativePath) {
    // 构造完整的GitHub URL
    const githubUrl = `@github://${relativePath}`
    return await this.loadContent(githubUrl)
  }

  /**
   * 加载GitHub文件内容
   * @param {string} url - GitHub协议URL
   * @returns {Promise<string>} 文件内容
   */
  async loadContent(url) {
    await this.initialize()

    const { owner, repo, branch, filePath, repoKey } = this.parseUrl(url)
    
    // 获取仓库配置
    const repoConfig = this.configManager.getRepositoryConfig(repoKey)
    if (!repoConfig) {
      throw new Error(`未找到仓库配置: ${repoKey}`)
    }

    if (!repoConfig.enabled) {
      throw new Error(`仓库已禁用: ${repoKey}`)
    }

    // 使用配置中的分支（如果URL中没有指定）
    const targetBranch = branch || repoConfig.branch || 'main'

    try {
      // 检查缓存
      const cachedItem = await this.githubCache.get(owner, repo, filePath, targetBranch)
      if (cachedItem) {
        // 获取远程文件的最新提交信息来验证缓存
        const lastCommit = await this.githubAdapter.getFileLastCommit(repoConfig, filePath, { branch: targetBranch })
        const remoteMetadata = {
          lastCommitDate: lastCommit?.date
        }
        
        if (await this.githubCache.isValid(owner, repo, filePath, targetBranch, remoteMetadata)) {
          logger.debug(`[GitHubProtocol] 使用缓存内容: ${url}`)
          return cachedItem.content
        }
      }

      // 从GitHub获取内容
      logger.debug(`[GitHubProtocol] 从GitHub加载内容: ${url}`)
      const result = await this.githubAdapter.getFileContent(repoConfig, filePath, { branch: targetBranch })
      
      // 获取文件的最后提交信息
      const lastCommit = await this.githubAdapter.getFileLastCommit(repoConfig, filePath, { branch: targetBranch })
      
      // 更新缓存
      const metadata = {
        ...result.metadata,
        lastCommitDate: lastCommit?.date,
        lastCommitSha: lastCommit?.sha,
        lastCommitMessage: lastCommit?.message
      }
      
      await this.githubCache.set(owner, repo, filePath, targetBranch, result.content, metadata)
      
      return result.content
    } catch (error) {
      logger.error(`[GitHubProtocol] 加载内容失败 ${url}: ${error.message}`)
      
      // 如果网络错误，尝试使用过期缓存
      if (this._isNetworkError(error)) {
        const cachedItem = await this.githubCache.get(owner, repo, filePath, targetBranch)
        if (cachedItem) {
          logger.warn(`[GitHubProtocol] 网络错误，使用过期缓存: ${url}`)
          return cachedItem.content
        }
      }
      
      throw error
    }
  }

  /**
   * 检查文件是否存在
   * @param {string} url - GitHub协议URL
   * @returns {Promise<boolean>} 是否存在
   */
  async exists(url) {
    await this.initialize()

    const { owner, repo, branch, filePath, repoKey } = this.parseUrl(url)
    
    const repoConfig = this.configManager.getRepositoryConfig(repoKey)
    if (!repoConfig || !repoConfig.enabled) {
      return false
    }

    const targetBranch = branch || repoConfig.branch || 'main'

    try {
      return await this.githubAdapter.fileExists(repoConfig, filePath, { branch: targetBranch })
    } catch (error) {
      logger.error(`[GitHubProtocol] 检查文件存在性失败 ${url}: ${error.message}`)
      return false
    }
  }

  /**
   * 获取文件元数据
   * @param {string} url - GitHub协议URL
   * @returns {Promise<Object>} 文件元数据
   */
  async getMetadata(url) {
    await this.initialize()

    const { owner, repo, branch, filePath, repoKey } = this.parseUrl(url)
    
    const repoConfig = this.configManager.getRepositoryConfig(repoKey)
    if (!repoConfig) {
      throw new Error(`未找到仓库配置: ${repoKey}`)
    }

    if (!repoConfig.enabled) {
      throw new Error(`仓库已禁用: ${repoKey}`)
    }

    const targetBranch = branch || repoConfig.branch || 'main'

    try {
      const fileResult = await this.githubAdapter.getFileContent(repoConfig, filePath, { branch: targetBranch })
      const lastCommit = await this.githubAdapter.getFileLastCommit(repoConfig, filePath, { branch: targetBranch })
      
      return {
        ...fileResult.metadata,
        branch: targetBranch,
        repository: repoKey,
        lastCommit: lastCommit
      }
    } catch (error) {
      logger.error(`[GitHubProtocol] 获取元数据失败 ${url}: ${error.message}`)
      throw error
    }
  }

  /**
   * 刷新指定文件的缓存
   * @param {string} url - GitHub协议URL
   */
  async refreshCache(url) {
    const { owner, repo, branch, filePath } = this.parseUrl(url)
    await this.githubCache.delete(owner, repo, filePath, branch)
    logger.debug(`[GitHubProtocol] 缓存已刷新: ${url}`)
  }

  /**
   * 清空指定仓库的缓存
   * @param {string} repoKey - 仓库键名（owner/repo）
   * @param {string} branch - 分支名称（可选）
   */
  async clearRepositoryCache(repoKey, branch = null) {
    const [owner, repo] = repoKey.split('/')
    await this.githubCache.clearRepository(owner, repo, branch)
    logger.info(`[GitHubProtocol] 仓库缓存已清空: ${repoKey}${branch ? `@${branch}` : ''}`)
  }

  /**
   * 清空所有缓存
   */
  async clearCache() {
    await this.githubCache.clear()
    logger.info('[GitHubProtocol] 所有GitHub缓存已清空')
  }

  /**
   * 获取协议统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStats() {
    const cacheStats = await this.githubCache.getStats()
    const config = this.configManager.getConfig()
    
    return {
      protocol: this.name,
      initialized: this.initialized,
      config: {
        enabled: config.enabled,
        repositoriesCount: config.repositories?.length || 0,
        enabledRepositoriesCount: this.configManager.getEnabledRepositories().length,
        hasGlobalToken: Boolean(config.auth?.token)
      },
      cache: cacheStats
    }
  }

  /**
   * 验证所有仓库连接
   * @returns {Promise<Object>} 验证结果
   */
  async validateConnections() {
    await this.initialize()
    return await this.configManager.validateConnection()
  }

  /**
   * 获取仓库的分支列表
   * @param {string} repoKey - 仓库键名
   * @returns {Promise<Array>} 分支列表
   */
  async getRepositoryBranches(repoKey) {
    await this.initialize()
    
    const repoConfig = this.configManager.getRepositoryConfig(repoKey)
    if (!repoConfig) {
      throw new Error(`未找到仓库配置: ${repoKey}`)
    }

    return await this.githubAdapter.getBranches(repoConfig)
  }

  /**
   * 获取仓库的releases
   * @param {string} repoKey - 仓库键名
   * @returns {Promise<Array>} releases列表
   */
  async getRepositoryReleases(repoKey) {
    await this.initialize()
    
    const repoConfig = this.configManager.getRepositoryConfig(repoKey)
    if (!repoConfig) {
      throw new Error(`未找到仓库配置: ${repoKey}`)
    }

    return await this.githubAdapter.getReleases(repoConfig)
  }

  /**
   * 判断是否为网络错误
   * @private
   */
  _isNetworkError(error) {
    const networkErrorCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']
    return networkErrorCodes.includes(error.code) || 
           error.message.includes('network') || 
           error.message.includes('timeout') ||
           error.status >= 500 // 服务器错误
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.githubAdapter.cleanup()
    logger.debug('[GitHubProtocol] 协议解析器资源已清理')
  }
}

module.exports = GitHubProtocol
