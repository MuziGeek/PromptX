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
          write: repo.permissions?.push || false,
          admin: repo.permissions?.admin || false
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
   * 清理客户端连接
   */
  cleanup() {
    this.clients.clear()
    logger.debug('[GitHubAdapter] 已清理所有GitHub客户端连接')
  }
}

module.exports = GitHubAdapter
