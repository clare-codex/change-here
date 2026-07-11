#!/usr/bin/env node
import { runCli } from './src/cli.js'

runCli(process.argv.slice(2)).catch((error) => {
  console.error(`changehere: ${error.message}`)
  process.exitCode = 1
})
