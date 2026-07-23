export interface GitRemote {
  host: string
  owner: string
  repo: string
}

// git@git.btsai.work:CloudSystem/backend.git  → { host: "git.btsai.work", owner: "CloudSystem", repo: "backend" }
// https://git.btsai.work/CloudSystem/backend.git → same
// ssh://git@git.btsai.work/CloudSystem/backend.git → same
const SSH_RE = /^[\w.-]+@([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?$/
const HTTPS_RE = /^https?:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/)?$/
const SSH_PROTO_RE = /^ssh:\/\/[\w.-]+@([\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/

export function parseGitUrl(url: string): GitRemote | null {
  for (const re of [SSH_RE, HTTPS_RE, SSH_PROTO_RE]) {
    const m = url.match(re)
    if (m) return { host: m[1], owner: m[2], repo: m[3] }
  }
  return null
}


