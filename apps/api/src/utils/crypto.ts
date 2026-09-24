import crypto from 'node:crypto'

export function gen32Token() {
    const c = crypto.randomBytes(32).toString('hex')
    return c
}

export function hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex')
}

