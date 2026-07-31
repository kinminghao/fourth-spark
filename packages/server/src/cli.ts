import { APP_VERSION } from "./lib/config"

const args = process.argv.slice(2)

if (args.includes("--version") || args.includes("-v")) {
  console.log(`fourth-spark ${APP_VERSION}`)
  process.exit(0)
}

if (args.includes("--help") || args.includes("-h")) {
  printUsage()
  process.exit(0)
}

const command = args[0]

switch (command) {
  case "start": {
    const { startCommand } = await import("./cli/start")
    await startCommand(args.slice(1))
    break
  }
  case "stop": {
    const { stopCommand } = await import("./cli/stop")
    await stopCommand()
    break
  }
  case "status": {
    const { statusCommand } = await import("./cli/status")
    await statusCommand()
    break
  }
  case "upgrade": {
    const { upgradeCommand } = await import("./cli/upgrade")
    await upgradeCommand(args.slice(1))
    break
  }
  case "serve":
  case undefined: {
    const { default: serverConfig } = await import("./index")
    Bun.serve(serverConfig)
    const { checkForUpdates } = await import("./cli/upgrade")
    checkForUpdates()
    break
  }
  default:
    console.error(`Unknown command: ${command}`)
    printUsage()
    process.exit(1)
}

function printUsage() {
  console.log(`fourth-spark ${APP_VERSION}

Usage: fourth-spark [command] [options]

Commands:
  serve     Start server in foreground (default)
  start     Start server in background (with PostgreSQL) [--port PORT]
  stop      Stop background server and all services
  status    Show server and service status
  upgrade   Check for updates and upgrade to latest version

Options:
  -v, --version    Show version
  -h, --help       Show this help`)
}
