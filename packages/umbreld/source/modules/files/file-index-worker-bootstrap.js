import {register} from 'node:module'

// A Worker resolves its entrypoint before --import hooks run, so a TypeScript
// entrypoint cannot bootstrap tsx itself. Start from plain JavaScript, register
// the same loader used by umbreld, then load the actual worker implementation.
register('tsx/esm', import.meta.url, {data: true})
await import('./file-index-worker.ts')
