#!/usr/bin/env node
const { spawn } = require("child_process")
const { join, dirname } = require("path")

const pkg = dirname(__dirname)
const bin = join(pkg, "fourth-spark")
const child = spawn(bin, process.argv.slice(2), { stdio: "inherit" })
child.on("exit", (code) => process.exit(code ?? 1))
