const { Octokit } = require('@octokit/rest')
const logger = require('../utils/logger')

/**
 * GitHub API适配器
 * 封装GitHub API操作，提供统一的接口
 */
class GitHubAdapter {
  constructor(globalConfig = null) {
    this.clients = new Map() // repoKey -> Octokit client 映射
    this.globalConfig = globalConfig

    // 调试信息
    if (globalConfig) {
      logger.debug(`[GitHubAdapter] 构造函数 - 接收到全局配置，token: ${globalConfig.auth?.token ? '***' : 'none'}`)
    } else {
      logger.debug(`[GitHubAdapter] 构造函数 - 没有全局配置`)
    }
  }

  /**
   * 获取或创建GitHub客户端
   * @param {Object} repoConfig - 仓库配置
   * @returns {Object} Octokit客户端实例
   */
  getClient(repoConfig) {
    const repoKey = `${repoConfig.owner}/${repoConfig.name}`
    // 优先使用仓库专用token，然后使用全局token
    const globalToken = this.globalConfig?.auth?.token || ''
    const token = repoConfig.token || globalToken || ''
    const clientKey = `${repoKey}-${token ? 'auth' : 'public'}`

    // 调试信息
    logger.debug(`[GitHubAdapter] getClient - repoConfig.token: ${repoConfig.token ? '***' : 'none'}`)
    logger.debug(`[GitHubAdapter] getClient - globalToken: ${globalToken ? '***' : 'none'}`)
    logger.debug(`[GitHubAdapter] getClient - final token: ${token ? '***' : 'none'}`)
    
    if (!this.clients.has(clientKey)) {
      const clientOptions = {
        userAgent: 'PromptX/1.0.0',
        timeZone: 'Asia/Shanghai',
        request: {
          timeout: 30000,
          retries: 3
        }
      }
      
      if (token) {
        clientOptions.auth = token
      }
      
      const client = new Octokit(clientOptions)
      this.clients.set(clientKey, client)
      
      logger.debug(`[GitHubAdapter] 创建GitHub客户端: ${clientKey}`)
    }
    
    return this.clients.get(clientKey)
  }

  /**
   * 测试GitHub连接
   * @param {Object} repoConfig - 仓库配置
   * @returns {Promise<Object>} 测试结果
   */
  async testConnection(repoConfig) {
    try {
      const client = this.getClient(repoConfig)
      
      // 尝试获取仓库信息
      const { data: repo } = await client.rest.repos.get({
        owner: repoConfig.owner,
        repo: repoConfig.name
      })
      
      // 检查分支是否存在
      const { data: branch } = await client.rest.repos.getBranch({
        owner: repoConfig.owner,
        repo: repoConfig.name,
        branch: repoConfig.branch || 'main'
      })
      
      return {
        success: true,
        repository: `${repoConfig.owner}/${repoConfig.name}`,
        branch: branch.name,
        private: repo.private,
        permissions: {
          read: true,
          // GitHub API中push权限表示可以推送代码（写入权限）
          write: Boolean(repo.permissions?.push || repo.permissions?.maintain || repo.permissions?.admin),
          admin: Boolean(repo.permissions?.admin),
          // 添加详细权限信息用于调试
          details: repo.permissions,
          owner: repo.owner.login
        },
        lastUpdated: repo.updated_at
      }
    } catch (error) {
      logger.error(`[GitHubAdapter] 连接测试失败 ${repoConfig.owner}/${repoConfig.name}: ${error.message}`)
      return {
        success: false,
        repository: `${repoConfig.owner}/${repoConfig.name}`,
        error: error.message,
        status: error.status
      }
    }
  }

  /**
   * 获取仓库内容列表
   * @param {Object} repoConfig - 仓库配置
   * @param {string} path - 目录路径
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 内容列表
   */
  async getContents(repoConfig, path = '', options = {}) {
    try {
      const client = this.getClient(repoConfig)
      const branch = options.branch || repoConfig.branch || 'main'

      // 清理路径：移除尾部斜杠，确保符合GitHub API格式
      const cleanPath = path.replace(/\/$/, '')

      const { data } = await client.rest.repos.getContent({
        owner: repoConfig.owner,
        repo: repoConfig.name,
        path: cleanPath,
        ref: branch
      })
      
      // 确保返回数组格式
      const contents = Array.isArray(data) ? data : [data]
      
      logger.debug(`[GitHubAdapter] 获取内容 ${repoConfig.owner}/${repoConfig.name}/${path}: ${contents.length} 项`)
      return contents
    } catch (error) {
      if (error.status === 404) {
        logger.debug(`[GitHubAdapter] 路径不存在 ${repoConfig.owner}/${repoConfig.name}/${path}`)
        return []
      }
      logger.error(`[GitHubAdapter] 获取内容失败 ${repoConfig.owner}/${repoConfig.name}/${path}: ${error.message}`)
      throw error
    }
  }

  /**
   * 递归获取目录下所有文件
   * @param {Object} repoConfig - 仓库配置
   * @param {string} path - 目录路径
   * @param {Object} options - 选项
   * @returns {Promise<Array>} 文件列表
   */
  async getFilesRecursively(repoConfig, path = '', options = {}) {
    const allFiles = []
    const maxDepth = options.maxDepth || 10
    const fileExtensions = options.fileExtensions || ['.md']
    
    const processDirectory = async (currentPath, depth = 0) => {
      if (depth > maxDepth) {
        logger.warn(`[GitHubAdapter] 达到最大递归深度: ${currentPath}`)
        return
      }

      try {
        // 清理路径：移除尾部斜杠，确保符合GitHub API格式
        const cleanPath = currentPath.replace(/\/$/, '')
        const contents = await this.getContents(repoConfig, cleanPath, options)
        
        for (const item of contents) {
          if (item.type === 'file') {
            // 检查文件扩展名
            const hasValidExtension = fileExtensions.some(ext => 
              item.name.toLowerCase().endsWith(ext.toLowerCase())
            )
            
            if (hasValidExtension) {
              allFiles.push({
                ...item,
                relativePath: item.path
              })
            }
          } else if (item.type === 'dir') {
            // 递归处理子目录
            await processDirectory(item.path, depth + 1)
          }
        }
      } catch (error) {
        logger.warn(`[GitHubAdapter] 处理目录失败 ${currentPath}: ${error.message}`)
      }
    }
    
    await processDirectory(path)
    return allFiles
  }

  /**
   * 获取文件内容
   * @param {Object} repoConfig - 仓库配置
   * @param {string} path - 文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 文件内容和元数据
   */
  async getFileContent(repoConfig, path, options = {}) {
    try {
      const client = this.getClient(repoConfig)
      const branch = options.branch || repoConfig.branch || 'main'
      
      // 清理路径：移除尾部斜杠，确保符合GitHub API格式
      const cleanPath = path.replace(/\/$/, '')

      const { data } = await client.rest.repos.getContent({
        owner: repoConfig.owner,
        repo: repoConfig.name,
        path: cleanPath,
        ref: branch
      })
      
      if (data.type !== 'file') {
        throw new Error(`路径不是文件: ${path}`)
      }
      
      // 解码Base64内容
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      
      return {
        content,
        metadata: {
          sha: data.sha,
          size: data.size,
          path: data.path,
          name: data.name,
          downloadUrl: data.download_url,
          htmlUrl: data.html_url,
          lastModified: null // GitHub API不直接提供文件修改时间
        }
      }
    } catch (error) {
      logger.error(`[GitHubAdapter] 获取文件内容失败 ${repoConfig.owner}/${repoConfig.name}/${path}: ${error.message}`)
      throw error
    }
  }

  /**
   * 获取文件的最后提交信息
   * @param {Object} repoConfig - 仓库配置
   * @param {string} path - 文件路径
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 提交信息
   */
  async getFileLastCommit(repoConfig, path, options = {}) {
    try {
      const client = this.getClient(repoConfig)
      const branch = options.branch || repoConfig.branch || 'main'
      
      const { data: commits } = await client.rest.repos.listCommits({
        owner: repoConfig.owner,
        repo: repoConfig.name,
        path: path,
        sha: branch,
        per_page: 1
      })
      
      if (commits.length === 0) {
        return null
      }
      
      const lastCommit = commits[0]
      return {
        sha: lastCommit.sha,
        message: lastCommit.commit.message,
        author: lastCommit.commit.author,
        date: lastCommit.commit.author.date,
        url: lastCommit.html_url
      }
    } catch (error) {
      logger.warn(`[GitHubAdapter] 获取文件提交信息失败 ${path}: ${error.message}`)
      return null
    }
  }

  /**
   * 检查文件是否存在
   * @param {Object} repoConfig - 仓库配置
   * @param {string} path - 文件路径
   * @param {Object} options - 选项
   * @returns {Promise<boolean>} 是否存在
   */
  async fileExists(repoConfig, path, options = {}) {
    try {
      await this.getFileContent(repoConfig, path, options)
      return true
    } catch (error) {
      if (error.status === 404) {
        return false
      }
      throw error
    }
  }

  /**
   * 获取仓库的releases
   * @param {Object} repoConfig - 仓库配置
   * @param {Object} options - 选项
   * @returns {Promise<Array>} releases列表
   */
  async getReleases(repoConfig, options = {}) {
    try {
      const client = this.getClient(repoConfig)
      
      const { data: releases } = await client.rest.repos.listReleases({
        owner: repoConfig.owner,
        repo: repoConfig.name,
        per_page: options.perPage || 30
      })
      
      return releases.map(release => ({
        id: release.id,
        tagName: release.tag_name,
        name: release.name,
        body: release.body,
        draft: release.draft,
        prerelease: release.prerelease,
        publishedAt: release.published_at,
        htmlUrl: release.html_url
      }))
    } catch (error) {
      logger.error(`[GitHubAdapter] 获取releases失败 ${repoConfig.owner}/${repoConfig.name}: ${error.message}`)
      throw error
    }
  }

  /**
   * 获取仓库的分支列表
   * @param {Object} repoConfig - 仓库配置
   * @returns {Promise<Array>} 分支列表
   */
  async getBranches(repoConfig) {
    try {
      const client = this.getClient(repoConfig)
      
      const { data: branches } = await client.rest.repos.listBranches({
        owner: repoConfig.owner,
        repo: repoConfig.name,
        per_page: 100
      })
      
      return branches.map(branch => ({
        name: branch.name,
        sha: branch.commit.sha,
        protected: branch.protected
      }))
    } catch (error) {
      logger.error(`[GitHubAdapter] 获取分支列表失败 ${repoConfig.owner}/${repoConfig.name}: ${error.message}`)
      throw error
    }
  }

  /**
   * 获取用户信息（用于验证token）
   * @param {string} token - 访问令牌
   * @returns {Promise<Object>} 用户信息
   */
  async getUserInfo(token) {
    try {
      const client = new Octokit({ auth: token })
      const { data: user } = await client.rest.users.getAuthenticated()
      
      return {
        login: user.login,
        name: user.name,
        email: user.email,
        type: user.type,
        company: user.company,
        location: user.location
      }
    } catch (error) {
      logger.error(`[GitHubAdapter] 获取用户信息失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 创建或更新文件
   * @param {Object} repoConfig - 仓库配置
   * @param {string} path - 文件路径
   * @param {string} content - 文件内容
   * @param {string} message - 提交信息
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 操作结果
   */
  async createOrUpdateFile(repoConfig, path, content, message, options = {}) {
    try {
      const client = this.getClient(repoConfig)
      const branch = options.branch || repoConfig.branch || 'main'

      // 清理路径：移除尾部斜杠，确保符合GitHub API格式
      const cleanPath = path.replace(/\/$/, '')

      // 检查文件是否已存在
      let existingFile = null
      try {
        const { data } = await client.rest.repos.getContent({
          owner: repoConfig.owner,
          repo: repoConfig.name,
          path: cleanPath,
          ref: branch
        })
        existingFile = data
      } catch (error) {
        if (error.status !== 404) {
          throw error
        }
        // 文件不存在，继续创建
      }

      // 编码内容为Base64
      const encodedContent = Buffer.from(content, 'utf-8').toString('base64')

      const requestData = {
        owner: repoConfig.owner,
        repo: repoConfig.name,
        path: cleanPath,
        message: message,
        content: encodedContent,
        branch: branch
      }

      // 如果文件已存在，需要提供SHA
      if (existingFile) {
        requestData.sha = existingFile.sha
      }

      const { data } = await client.rest.repos.createOrUpdateFileContents(requestData)

      logger.info(`[GitHubAdapter] ${existingFile ? '更新' : '创建'}文件成功: ${repoConfig.owner}/${repoConfig.name}/${cleanPath}`)

      return {
        success: true,
        action: existingFile ? 'updated' : 'created',
        path: cleanPath,
        sha: data.content.sha,
        commit: {
          sha: data.commit.sha,
          message: data.commit.message,
          url: data.commit.html_url
        }
      }
    } catch (error) {
      logger.error(`[GitHubAdapter] 创建/更新文件失败 ${repoConfig.owner}/${repoConfig.name}/${path}: ${error.message}`)
      throw error
    }
  }

  /**
   * 批量上传文件
   * @param {Object} repoConfig - 仓库配置
   * @param {Array} files - 文件列表 [{path, content, message}]
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 批量操作结果
   */
  async uploadFiles(repoConfig, files, options = {}) {
    const results = {
      success: [],
      failed: [],
      total: files.length
    }

    const branch = options.branch || repoConfig.branch || 'main'
    const baseMessage = options.baseMessage || 'Upload role files via PromptX'

    logger.info(`[GitHubAdapter] 开始批量上传 ${files.length} 个文件到 ${repoConfig.owner}/${repoConfig.name}@${branch}`)

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const progress = `(${i + 1}/${files.length})`

      try {
        logger.debug(`[GitHubAdapter] 上传文件 ${progress}: ${file.path}`)

        const message = file.message || `${baseMessage}: ${file.path}`
        const result = await this.createOrUpdateFile(
          repoConfig,
          file.path,
          file.content,
          message,
          { branch }
        )

        results.success.push({
          path: file.path,
          action: result.action,
          sha: result.sha,
          commit: result.commit
        })

        logger.info(`[GitHubAdapter] 文件上传成功 ${progress}: ${file.path} (${result.action})`)

      } catch (error) {
        logger.error(`[GitHubAdapter] 上传文件失败 ${progress} ${file.path}: ${error.message}`)
        results.failed.push({
          path: file.path,
          error: error.message,
          status: error.status || 'unknown'
        })
      }

      // 添加小延迟避免API限制
      if (i < files.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    logger.info(`[GitHubAdapter] 批量上传完成: ${results.success.length} 成功, ${results.failed.length} 失败`)

    return results
  }

  /**
   * 清理客户端连接
   */
  cleanup() {
    this.clients.clear()
    logger.debug('[GitHubAdapter] 已清理所有GitHub客户端连接')
  }
}

module.exports = GitHubAdapter
