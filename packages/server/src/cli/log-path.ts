import { homedir } from "node:os"
import { join } from "node:path"

export const DATA_DIR = join(homedir(), ".fourth-spark")
export const LOG_DIR = join(DATA_DIR, "logs")
export const ACCOUNT_LOG_FILE = join(LOG_DIR, "account.log")
