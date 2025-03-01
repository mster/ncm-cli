'use strict'

const path = require('path')
const analyze = require('../lib/ncm-analyze-tree')
const {
  apiRequest,
  formatAPIURL,
  graphql
} = require('../lib/util')
const config = require('../lib/config')
const {
  SEVERITY_RMAP,
  moduleSort
} = require('../lib/report/util')
const longReport = require('../lib/report/long')
const shortReport = require('../lib/report/short')
const { helpHeader } = require('../lib/help')
const {
  COLORS,
  header,
  failure,
  formatError
} = require('../lib/ncm-style')
const chalk = require('chalk')
const L = console.log
const E = console.error

module.exports = report
module.exports.optionsList = optionsList

async function report (argv, _dir) {
  const {
    long
  } = argv
  let { dir = _dir } = argv
  if (!dir) dir = process.cwd()

  if (argv.help) {
    printHelp()
    return
  }

  /* NCM-Cli Header */
  L()
  L(header(`${path.basename(dir)} Report`))

  let orgId = config.getValue('orgId')

  try {
    const details = await apiRequest(
      'GET',
      formatAPIURL('/accounts/user/details')
    )
    if (typeof details.orgId === 'string') {
      orgId = details.orgId
    }
  } catch (err) {
    E()
    E(formatError('Failed to fetch user info. Have you run `ncm signin`?', err))
    E()
    process.exitCode = 1
    return
  }

  const whitelist = new Set()
  try {
    const data = await graphql(
      formatAPIURL('/ncm2/api/v2/graphql'),
      `query($organizationId: String!) {
        policies(organizationId: $organizationId) {
          whitelist {
            name
            version
          }
        }
      }`,
      { organizationId: orgId }
    )
    for (const policy of data.policies) {
      for (const pkg of policy.whitelist) {
        whitelist.add(`${pkg.name}@${pkg.version}`)
      }
    }
  } catch (err) {
    L()
    L(formatError(`Unable to fetch whitelist.`, err))
    L()
  }

  /* verify */
  let pkgScores = []
  let hasFailures = false

  let data
  try {
    data = await analyze({
      dir,
      url: formatAPIURL('/ncm2/api/v2/graphql')
    })
  } catch (err) {
    if (err.code === 'ENOENT') {
      E()
      E(failure(err.message))
      E(formatError(`Unable to read project at: ${dir}`, err))
      E()
    } else {
      E()
      E(formatError(`Unable to analyze project. ${err.message}.`, err))
      E()
    }
    process.exitCode = 1
    return
  }

  for (let { name, version, scores, published } of data) {
    let maxSeverity = 0
    let license
    const failures = []

    for (const score of scores) {
      const severityValue = SEVERITY_RMAP.indexOf(score.severity)

      if (score.group !== 'compliance' &&
          score.group !== 'security' &&
          score.group !== 'risk') {
        continue
      }

      if (severityValue > maxSeverity) {
        maxSeverity = severityValue
      }

      if (score.pass === false) {
        failures.push(score)
        hasFailures = true
      }

      if (score.name === 'license') {
        license = score
      }
    }

    if (!version) {
      version = '0.0.0-UNKNOWN-VERSION'
    }

    pkgScores.push({
      name,
      version,
      published,
      maxSeverity,
      failures,
      license,
      scores
    })
  }

  pkgScores = moduleSort(pkgScores)

  const whitelisted = pkgScores.filter(pkg => whitelist.has(`${pkg.name}@${pkg.version}`))
  pkgScores = pkgScores.filter(pkg => !whitelist.has(`${pkg.name}@${pkg.version}`))

  if (!long) shortReport(pkgScores, whitelisted, dir, argv)
  if (long) longReport(pkgScores, whitelisted, dir, argv)
  if (hasFailures) process.exitCode = 1
}

function printHelp () {
  helpHeader(
    'report',
    chalk`{${COLORS.light1} ncm} {${COLORS.yellow} report} {${COLORS.teal} [<directory>] [options]}`,
    'ncm report [<directory>] [options]',
    chalk`
Generates a project-wide report of directory risk and quality of installed or specified packages.
The top five riskiest modules detected will be displayed alongside a concise project report.

A report with a list of all modules can be generated by passing {${COLORS.teal} --long}.

Reports may be filtered based on any of the following flags:
  {${COLORS.teal} --compliance}, {${COLORS.teal} --security}
    `
  )

  L(optionsList())
  L()
}

function optionsList () {
  return chalk`
{${COLORS.light1} ncm} {${COLORS.yellow} report}
{${COLORS.light1} ncm} {${COLORS.yellow} report} {${COLORS.teal} <directory>}
  {${COLORS.teal} -d, --dir}               {white Another way to specify <directory>}
  {${COLORS.teal} -l, --long}              {white Full module list output}
  {${COLORS.teal} -c --compliance}         {white Compliance failures only output}
  {${COLORS.teal} -s --security}           {white Security failures only output}
  `.trim()
}
