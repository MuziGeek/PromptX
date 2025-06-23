const fs = require('fs-extra')
const path = require('path')
const Joi = require('joi')
const logger = require('./logger')

/**
 * GitHub配置管理器
 * 负责GitHub配置的加载、验证和管理
 */
class GitHubConfigManager {
  constructor() {
    this.config = null
    this.configPath = null
    this.initialized = false
  }

  /**
   * 初始化配置管理器
   * @param {string} configPath - 配置文件路径
   */
  async initialize(configPath = null) {
    try {
      this.configPath = configPath || await this._findConfigPath()
      this.config = await this._loadConfig()
      this._validateConfig()
      this.initialized = true
      
      logger.info(`[GitHubConfigManager] 配置加载成功: ${this.configPath}`)
    } catch (error) {
      logger.warn(`[GitHubConfigManager] 配置加载失败: ${error.message}`)
      this.config = this._getDefaultConfig()
      this.initialized = false
    }
  }

  /**
   * 获取GitHub配置
   * @returns {Object} GitHub配置对象
   */
  getConfig() {
    if (!this.config) {
      return this._getDefaultConfig()
    }
    return this.config
  }

  /**
   * 获取指定仓库的配置
   * @param {string} repoKey - 仓库键名（owner/repo格式）
   * @returns {Object|null} 仓库配置
   */
  getRepositoryConfig(repoKey) {
    const config = this.getConfig()
    return config.repositories.find(repo => 
      `${repo.owner}/${repo.name}` === repoKey
    ) || null
  }

  /**
   * 获取所有启用的仓库配置
   * @returns {Array} 启用的仓库配置列表
   */
  getEnabledRepositories() {
    const config = this.getConfig()
    return config.repositories.filter(repo => repo.enabled !== false)
  }

  /**
   * 验证GitHub连接
   * @param {string} repoKey - 仓库键名（可选）
   * @returns {Promise<Object>} 验证结果
   */
  async validateConnection(repoKey = null) {
    try {
      const GitHubAdapter = require('../adapters/GitHubAdapter')
      const githubAdapter = new GitHubAdapter(this.getConfig())

      if (repoKey) {
        const repoConfig = this.getRepositoryConfig(repoKey)
        if (!repoConfig) {
          throw new Error(`仓库配置不存在: ${repoKey}`)
        }

        // 确保仓库配置包含token
        const enrichedRepoConfig = {
          ...repoConfig,
          token: repoConfig.token || this.getAccessToken(repoConfig)
        }

        return await githubAdapter.testConnection(enrichedRepoConfig)
      } else {
        // 测试所有启用的仓库
        const results = {}
        const enabledRepos = this.getEnabledRepositories()
        
        for (const repo of enabledRepos) {
          const repoKey = `${repo.owner}/${repo.name}`
          try {
            results[repoKey] = await githubAdapter.testConnection(repo)
          } catch (error) {
            results[repoKey] = { success: false, error: error.message }
          }
        }
        
        return results
      }
    } catch (error) {
      logger.error(`[GitHubConfigManager] 连接验证失败: ${error.message}`)
      return { success: false, error: error.message }
    }
  }

  /**
   * 查找配置文件路径
   * @private
   */
  async _findConfigPath() {
    const possiblePaths = [
      path.join(process.cwd(), '.promptx', 'github.config.json'),
      path.join(process.cwd(), 'github.config.json'),
      path.join(require('os').homedir(), '.promptx', 'github.config.json')
    ]

    for (const configPath of possiblePaths) {
      if (await fs.pathExists(configPath)) {
        return configPath
      }
    }

    // 如果没有找到配置文件，创建默认配置
    const defaultPath = possiblePaths[0]
    await this._createDefaultConfig(defaultPath)
    return defaultPath
  }

  /**
   * 加载配置文件
   * @private
   */
  async _loadConfig() {
    if (!await fs.pathExists(this.configPath)) {
      throw new Error(`配置文件不存在: ${this.configPath}`)
    }

    const configData = await fs.readJSON(this.configPath)
    return configData
  }

  /**
   * 验证配置格式
   * @private
   */
  _validateConfig() {
    const schema = Joi.object({
      version: Joi.string().default('1.0.0'),
      enabled: Joi.boolean().default(true),
      cache: Joi.object({
        enabled: Joi.boolean().default(true),
        ttl: Joi.number().min(60).default(3600), // 缓存TTL（秒）
        maxSize: Joi.number().min(1).default(100) // 最大缓存文件数
      }).default(),
      auth: Joi.object({
        token: Joi.string().allow('').default(''),
        type: Joi.string().valid('token', 'app').default('token')
      }).default(),
      repositories: Joi.array().items(
        Joi.object({
          owner: Joi.string().required(),
          name: Joi.string().required(),
          branch: Joi.string().default('main'),
          enabled: Joi.boolean().default(true),
          rolePrefix: Joi.string().default('roles/'),
          priority: Joi.number().default(100),
          private: Joi.boolean().default(false),
          token: Joi.string().allow('').default(''), // 仓库特定token
          metadata: Joi.object().default({})
        })
      ).min(0).default([])
    })

    const { error, value } = schema.validate(this.config)
    if (error) {
      throw new Error(`配置验证失败: ${error.details[0].message}`)
    }

    this.config = value
  }

  /**
   * 获取默认配置
   * @private
   */
  _getDefaultConfig() {
    return {
      version: '1.0.0',
      enabled: false,
      cache: {
        enabled: true,
        ttl: 3600,
        maxSize: 100
      },
      auth: {
        token: '',
        type: 'token'
      },
      repositories: []
    }
  }

  /**
   * 创建默认配置文件
   * @private
   */
  async _createDefaultConfig(configPath) {
    const defaultConfig = {
      ...this._getDefaultConfig(),
      repositories: [
        {
          owner: 'your-username',
          name: 'promptx-roles',
          branch: 'main',
          enabled: false,
          rolePrefix: 'roles/',
          priority: 100,
          private: false,
          token: '',
          metadata: {
            description: '示例GitHub角色仓库',
            createdAt: new Date().toISOString()
          }
        }
      ]
    }

    await fs.ensureDir(path.dirname(configPath))
    await fs.writeJSON(configPath, defaultConfig, { spaces: 2 })
    
    logger.info(`[GitHubConfigManager] 已创建默认配置文件: ${configPath}`)
    logger.info(`[GitHubConfigManager] 请编辑配置文件并设置正确的GitHub凭证`)
  }

  /**
   * 获取有效的访问令牌
   * @param {Object} repoConfig - 仓库配置
   * @returns {string} 访问令牌
   */
  getAccessToken(repoConfig) {
    // 优先使用仓库特定的token
    if (repoConfig.token) {
      return repoConfig.token
    }
    
    // 使用全局token
    const config = this.getConfig()
    return config.auth?.token || ''
  }

  /**
   * 检查仓库是否需要认证
   * @param {Object} repoConfig - 仓库配置
   * @returns {boolean} 是否需要认证
   */
  requiresAuth(repoConfig) {
    return repoConfig.private || Boolean(this.getAccessToken(repoConfig))
  }

  /**
   * 保存配置
   * @param {Object} newConfig - 新配置
   */
  async saveConfig(newConfig) {
    // 验证新配置
    const tempConfig = this.config
    this.config = newConfig
    this._validateConfig()
    
    // 保存到文件
    await fs.writeJSON(this.configPath, this.config, { spaces: 2 })
    logger.info(`[GitHubConfigManager] 配置已保存: ${this.configPath}`)
  }

  /**
   * 重新加载配置
   */
  async reloadConfig() {
    await this.initialize(this.configPath)
  }

  /**
   * 添加仓库配置
   * @param {Object} repoConfig - 仓库配置
   */
  async addRepository(repoConfig) {
    const config = this.getConfig()
    const repoKey = `${repoConfig.owner}/${repoConfig.name}`
    
    // 检查是否已存在
    const existingIndex = config.repositories.findIndex(repo => 
      `${repo.owner}/${repo.name}` === repoKey
    )
    
    if (existingIndex >= 0) {
      // 更新现有配置
      config.repositories[existingIndex] = { ...config.repositories[existingIndex], ...repoConfig }
    } else {
      // 添加新配置
      config.repositories.push(repoConfig)
    }
    
    await this.saveConfig(config)
    logger.info(`[GitHubConfigManager] 仓库配置已添加/更新: ${repoKey}`)
  }

  /**
   * 移除仓库配置
   * @param {string} repoKey - 仓库键名
   */
  async removeRepository(repoKey) {
    const config = this.getConfig()
    const originalLength = config.repositories.length
    
    config.repositories = config.repositories.filter(repo => 
      `${repo.owner}/${repo.name}` !== repoKey
    )
    
    if (config.repositories.length < originalLength) {
      await this.saveConfig(config)
      logger.info(`[GitHubConfigManager] 仓库配置已移除: ${repoKey}`)
    } else {
      logger.warn(`[GitHubConfigManager] 仓库配置不存在: ${repoKey}`)
    }
  }
}

module.exports = GitHubConfigManager
