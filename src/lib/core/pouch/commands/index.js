/**
 * 锦囊命令导出
 */

const InitCommand = require('./InitCommand')
const WelcomeCommand = require('./WelcomeCommand')
const ActionCommand = require('./ActionCommand')
const LearnCommand = require('./LearnCommand')
const RecallCommand = require('./RecallCommand')
const RememberCommand = require('./RememberCommand')
const DACPCommand = require('./DACPCommand')
// const COSCommand = require('./COSCommand') // Temporarily disabled due to adapter issue
const GitHubCommand = require('./GitHubCommand')

module.exports = {
  InitCommand,
  WelcomeCommand,
  ActionCommand,
  LearnCommand,
  RecallCommand,
  RememberCommand,
  DACPCommand,
  // COSCommand, // Temporarily disabled
  GitHubCommand
}
