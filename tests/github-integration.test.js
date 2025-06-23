const fs = require('fs-extra')
const path = require('path')
const GitHubConfigManager = require('../src/lib/utils/GitHubConfigManager')
const GitHubProtocol = require('../src/lib/core/resource/protocols/GitHubProtocol')
const GitHubDiscovery = require('../src/lib/core/resource/discovery/GitHubDiscovery')
const GitHubCache = require('../src/lib/core/resource/cache/GitHubCache')

describe('GitHub Integration Tests', () => {
  let tempDir
  let configManager
  let githubProtocol
  let githubDiscovery
  let githubCache

  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(__dirname, 'temp-github-'))
    
    // 初始化组件
    configManager = new GitHubConfigManager()
    githubProtocol = new GitHubProtocol()
    githubDiscovery = new GitHubDiscovery()
    githubCache = new GitHubCache({
      cacheDir: path.join(tempDir, 'cache'),
      ttl: 60,
      maxSize: 10
    })
  })

  afterEach(async () => {
    // 清理临时目录
    await fs.remove(tempDir)
    
    // 清理组件
    if (githubProtocol) {
      githubProtocol.cleanup()
    }
    if (githubDiscovery) {
      githubDiscovery.cleanup()
    }
  })

  describe('GitHubConfigManager', () => {
    test('should create default config when file not exists', async () => {
      const configPath = path.join(tempDir, 'github.config.json')
      await configManager.initialize(configPath)
      
      const config = configManager.getConfig()
      expect(config).toBeDefined()
      expect(config.version).toBe('1.0.0')
      expect(config.enabled).toBe(false)
      expect(config.repositories).toBeInstanceOf(Array)
    })

    test('should validate config structure', async () => {
      const configPath = path.join(tempDir, 'github.config.json')
      const validConfig = {
        version: '1.0.0',
        enabled: true,
        cache: {
          enabled: true,
          ttl: 3600,
          maxSize: 100
        },
        auth: {
          token: 'test-token',
          type: 'token'
        },
        repositories: [
          {
            owner: 'test-owner',
            name: 'test-repo',
            branch: 'main',
            enabled: true,
            rolePrefix: 'roles/',
            priority: 100,
            private: false
          }
        ]
      }

      await fs.writeJSON(configPath, validConfig)
      await configManager.initialize(configPath)
      
      const config = configManager.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.repositories).toHaveLength(1)
      expect(config.repositories[0].owner).toBe('test-owner')
    })

    test('should get enabled repositories only', async () => {
      const configPath = path.join(tempDir, 'github.config.json')
      const config = {
        version: '1.0.0',
        enabled: true,
        repositories: [
          { owner: 'owner1', name: 'repo1', enabled: true },
          { owner: 'owner2', name: 'repo2', enabled: false },
          { owner: 'owner3', name: 'repo3', enabled: true }
        ]
      }

      await fs.writeJSON(configPath, config)
      await configManager.initialize(configPath)
      
      const enabledRepos = configManager.getEnabledRepositories()
      expect(enabledRepos).toHaveLength(2)
      expect(enabledRepos.map(r => r.name)).toEqual(['repo1', 'repo3'])
    })

    test('should get repository config by key', async () => {
      const configPath = path.join(tempDir, 'github.config.json')
      const config = {
        version: '1.0.0',
        enabled: true,
        repositories: [
          { owner: 'test-owner', name: 'test-repo', branch: 'main' }
        ]
      }

      await fs.writeJSON(configPath, config)
      await configManager.initialize(configPath)
      
      const repoConfig = configManager.getRepositoryConfig('test-owner/test-repo')
      expect(repoConfig).toBeDefined()
      expect(repoConfig.owner).toBe('test-owner')
      expect(repoConfig.name).toBe('test-repo')
      
      const nonExistentRepo = configManager.getRepositoryConfig('non/existent')
      expect(nonExistentRepo).toBeNull()
    })

    test('should get access token correctly', async () => {
      const configPath = path.join(tempDir, 'github.config.json')
      const config = {
        version: '1.0.0',
        enabled: true,
        auth: { token: 'global-token' },
        repositories: [
          { owner: 'owner1', name: 'repo1', token: 'repo-specific-token' },
          { owner: 'owner2', name: 'repo2', token: '' }
        ]
      }

      await fs.writeJSON(configPath, config)
      await configManager.initialize(configPath)
      
      const repo1Config = configManager.getRepositoryConfig('owner1/repo1')
      const repo2Config = configManager.getRepositoryConfig('owner2/repo2')
      
      expect(configManager.getAccessToken(repo1Config)).toBe('repo-specific-token')
      expect(configManager.getAccessToken(repo2Config)).toBe('global-token')
    })
  })

  describe('GitHubCache', () => {
    test('should initialize cache directory', async () => {
      await githubCache.initialize()
      expect(await fs.pathExists(githubCache.cacheDir)).toBe(true)
    })

    test('should cache and retrieve content', async () => {
      await githubCache.initialize()
      
      const owner = 'test-owner'
      const repo = 'test-repo'
      const filePath = 'roles/test-role/test-role.role.md'
      const branch = 'main'
      const content = '# Test Role Content'
      const metadata = { sha: 'test-sha', lastCommitDate: new Date().toISOString() }
      
      // 设置缓存
      await githubCache.set(owner, repo, filePath, branch, content, metadata)
      
      // 获取缓存
      const cached = await githubCache.get(owner, repo, filePath, branch)
      expect(cached).toBeDefined()
      expect(cached.content).toBe(content)
      expect(cached.owner).toBe(owner)
      expect(cached.repo).toBe(repo)
      expect(cached.filePath).toBe(filePath)
      expect(cached.branch).toBe(branch)
    })

    test('should validate cache with SHA', async () => {
      await githubCache.initialize()
      
      const owner = 'test-owner'
      const repo = 'test-repo'
      const filePath = 'test/file.md'
      const branch = 'main'
      const content = '# Test Content'
      const metadata = { sha: 'test-sha', lastCommitDate: new Date().toISOString() }
      
      await githubCache.set(owner, repo, filePath, branch, content, metadata)
      
      // 相同SHA应该有效
      const isValid1 = await githubCache.isValid(owner, repo, filePath, branch, { sha: 'test-sha' })
      expect(isValid1).toBe(true)
      
      // 不同SHA应该无效
      const isValid2 = await githubCache.isValid(owner, repo, filePath, branch, { sha: 'different-sha' })
      expect(isValid2).toBe(false)
    })

    test('should respect TTL expiration', async () => {
      const shortTTLCache = new GitHubCache({
        cacheDir: path.join(tempDir, 'short-cache'),
        ttl: 1, // 1秒TTL
        maxSize: 10
      })
      
      await shortTTLCache.initialize()
      
      const owner = 'test-owner'
      const repo = 'test-repo'
      const filePath = 'test/file.md'
      const branch = 'main'
      const content = '# Test Content'
      
      await shortTTLCache.set(owner, repo, filePath, branch, content)
      
      // 立即获取应该有效
      let cached = await shortTTLCache.get(owner, repo, filePath, branch)
      expect(cached).toBeDefined()
      
      // 等待TTL过期
      await new Promise(resolve => setTimeout(resolve, 1100))
      
      // 过期后应该返回null
      cached = await shortTTLCache.get(owner, repo, filePath, branch)
      expect(cached).toBeNull()
    })

    test('should clear repository cache', async () => {
      await githubCache.initialize()
      
      // 添加多个仓库的缓存
      await githubCache.set('owner1', 'repo1', 'file1.md', 'main', 'content1')
      await githubCache.set('owner1', 'repo1', 'file2.md', 'main', 'content2')
      await githubCache.set('owner2', 'repo2', 'file3.md', 'main', 'content3')
      
      // 清理指定仓库缓存
      await githubCache.clearRepository('owner1', 'repo1')
      
      // 检查缓存状态
      const cached1 = await githubCache.get('owner1', 'repo1', 'file1.md', 'main')
      const cached2 = await githubCache.get('owner1', 'repo1', 'file2.md', 'main')
      const cached3 = await githubCache.get('owner2', 'repo2', 'file3.md', 'main')
      
      expect(cached1).toBeNull()
      expect(cached2).toBeNull()
      expect(cached3).toBeDefined()
    })
  })

  describe('GitHubProtocol', () => {
    test('should parse GitHub URL correctly', () => {
      // 基本格式
      const url1 = '@github://owner/repo/path/to/file.md'
      const parsed1 = githubProtocol.parseUrl(url1)
      
      expect(parsed1.owner).toBe('owner')
      expect(parsed1.repo).toBe('repo')
      expect(parsed1.branch).toBe('main')
      expect(parsed1.filePath).toBe('path/to/file.md')
      expect(parsed1.repoKey).toBe('owner/repo')
      
      // 带分支格式
      const url2 = '@github://owner/repo@develop/path/to/file.md'
      const parsed2 = githubProtocol.parseUrl(url2)
      
      expect(parsed2.owner).toBe('owner')
      expect(parsed2.repo).toBe('repo')
      expect(parsed2.branch).toBe('develop')
      expect(parsed2.filePath).toBe('path/to/file.md')
      expect(parsed2.repoKey).toBe('owner/repo')
    })

    test('should throw error for invalid URL format', () => {
      expect(() => {
        githubProtocol.parseUrl('@github://invalid')
      }).toThrow('无效的GitHub URL格式')
      
      expect(() => {
        githubProtocol.parseUrl('@github://owner/repo')
      }).toThrow('无效的GitHub URL格式')
    })

    test('should handle protocol name correctly', () => {
      expect(githubProtocol.name).toBe('github')
    })
  })

  describe('GitHubDiscovery', () => {
    test('should initialize discovery correctly', async () => {
      await githubDiscovery.initialize()
      expect(githubDiscovery.source).toBe('github')
      expect(githubDiscovery.initialized).toBe(true)
    })

    test('should return empty registry when GitHub disabled', async () => {
      // Mock配置管理器返回禁用状态
      jest.spyOn(githubDiscovery.configManager, 'getConfig').mockReturnValue({
        enabled: false,
        repositories: []
      })
      
      const registry = await githubDiscovery.discoverRegistry()
      expect(registry.source).toBe('github')
      expect(registry.resources).toHaveLength(0)
    })

    test('should group files by role correctly', () => {
      const files = [
        { path: 'roles/java-developer/java-developer.role.md', sha: 'sha1' },
        { path: 'roles/java-developer/thought/java-developer.thought.md', sha: 'sha2' },
        { path: 'roles/frontend-developer/frontend-developer.role.md', sha: 'sha3' },
        { path: 'roles/other-file.txt', sha: 'sha4' } // 应该被忽略
      ]
      
      const roleGroups = githubDiscovery._groupFilesByRole(files, 'roles/')
      
      expect(roleGroups.size).toBe(2)
      expect(roleGroups.has('java-developer')).toBe(true)
      expect(roleGroups.has('frontend-developer')).toBe(true)
      expect(roleGroups.get('java-developer')).toHaveLength(2)
      expect(roleGroups.get('frontend-developer')).toHaveLength(1)
    })

    test('should extract role ID correctly', () => {
      expect(githubDiscovery._extractRoleId('java-developer/java-developer.role.md')).toBe('java-developer')
      expect(githubDiscovery._extractRoleId('frontend-developer/thought/fe.thought.md')).toBe('frontend-developer')
      expect(githubDiscovery._extractRoleId('invalid')).toBeNull()
    })

    test('should determine resource type correctly', () => {
      expect(githubDiscovery._getResourceType('java-developer/java-developer.role.md')).toBe('role')
      expect(githubDiscovery._getResourceType('java-developer/thought/test.thought.md')).toBe('thought')
      expect(githubDiscovery._getResourceType('java-developer/execution/test.execution.md')).toBe('execution')
      expect(githubDiscovery._getResourceType('java-developer/knowledge/test.knowledge.md')).toBe('knowledge')
      expect(githubDiscovery._getResourceType('java-developer/other.txt')).toBeNull()
    })
  })

  describe('Integration Tests', () => {
    test('should work together for complete workflow', async () => {
      // 1. 创建配置
      const configPath = path.join(tempDir, 'github.config.json')
      const config = {
        version: '1.0.0',
        enabled: false, // 禁用以避免实际网络请求
        cache: { enabled: true, ttl: 3600, maxSize: 100 },
        auth: { token: 'test-token', type: 'token' },
        repositories: [
          {
            owner: 'test-owner',
            name: 'test-repo',
            branch: 'main',
            enabled: true,
            rolePrefix: 'roles/',
            priority: 100,
            private: false
          }
        ]
      }
      
      await fs.writeJSON(configPath, config)
      
      // 2. 初始化配置管理器
      await configManager.initialize(configPath)
      expect(configManager.initialized).toBe(false) // 因为enabled=false
      
      // 3. 测试协议解析
      const url = '@github://test-owner/test-repo/roles/java-developer/java-developer.role.md'
      const parsed = githubProtocol.parseUrl(url)
      expect(parsed.owner).toBe('test-owner')
      expect(parsed.repo).toBe('test-repo')
      
      // 4. 测试发现器
      await githubDiscovery.initialize()
      const registry = await githubDiscovery.discoverRegistry()
      expect(registry.source).toBe('github')
      // 因为GitHub禁用，应该返回空注册表
      expect(registry.resources).toHaveLength(0)
    })
  })
})

// Mock GitHub API to avoid actual network calls in tests
jest.mock('@octokit/rest', () => {
  return {
    Octokit: jest.fn().mockImplementation(() => ({
      rest: {
        repos: {
          get: jest.fn().mockResolvedValue({
            data: {
              private: false,
              updated_at: new Date().toISOString(),
              permissions: { push: true, admin: false }
            }
          }),
          getBranch: jest.fn().mockResolvedValue({
            data: { name: 'main' }
          }),
          getContent: jest.fn().mockResolvedValue({
            data: {
              type: 'file',
              content: Buffer.from('# Mock Content').toString('base64'),
              sha: 'mock-sha',
              size: 100,
              path: 'test/path',
              name: 'test.md',
              download_url: 'https://example.com/download',
              html_url: 'https://example.com/view'
            }
          }),
          listCommits: jest.fn().mockResolvedValue({
            data: [{
              sha: 'mock-commit-sha',
              commit: {
                message: 'Mock commit',
                author: {
                  name: 'Test Author',
                  email: 'test@example.com',
                  date: new Date().toISOString()
                }
              },
              html_url: 'https://example.com/commit'
            }]
          }),
          listReleases: jest.fn().mockResolvedValue({
            data: []
          }),
          listBranches: jest.fn().mockResolvedValue({
            data: [
              { name: 'main', commit: { sha: 'main-sha' }, protected: false }
            ]
          })
        },
        users: {
          getAuthenticated: jest.fn().mockResolvedValue({
            data: {
              login: 'testuser',
              name: 'Test User',
              email: 'test@example.com',
              type: 'User'
            }
          })
        }
      }
    }))
  }
})
