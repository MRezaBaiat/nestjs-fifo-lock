"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var LockService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
const crypto_1 = require("crypto");
const lodash_1 = require("lodash");
let LockService = LockService_1 = class LockService {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(LockService_1.name);
        global.lockService = this;
        this.client = new ioredis_1.default({
            host: config.redisHost,
            port: +config.redisPort,
            ...(config.redisSsl ? { tls: {} } : {}),
        });
        this.debugLog('Initialized Redis client for LockService');
    }
    debugLog(message, meta) {
        if (this.config.debug) {
            const metaString = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
            this.logger.debug(`${message}${metaString}`);
        }
    }
    onApplicationBootstrap() {
        this.healthCheckIntervalId = setInterval(() => this.runHealthCheck(), this.config.healthCheckInterval);
        this.runHealthCheck();
        this.debugLog('Application bootstrapped. Health check interval started.');
    }
    async auto(lockTags, cb) {
        const tags = (0, lodash_1.uniq)(typeof lockTags === 'string'
            ? [lockTags]
            : Array.isArray(lockTags)
                ? lockTags.map((t) => String(t))
                : [String(lockTags)]);
        this.debugLog('Requesting auto lock block', { tags });
        const start = performance.now();
        const { release } = await this.acquire(tags);
        this.debugLog(`Took ${performance.now() - start}ms to acquire lock for`, { tags });
        try {
            return await cb();
        }
        finally {
            await release();
        }
    }
    async runHealthCheck() {
        this.debugLog('Running lock health check (cleaning stale locks)...');
        let cursor = '0';
        const batchSize = 100;
        const now = Date.now();
        let totalRemoved = 0;
        const luaScript = `
    local now = tonumber(ARGV[1])
    local lockMaxTTL = tonumber(ARGV[2])
    local removed_total = 0
    for i, key in ipairs(KEYS) do
        local len = redis.call('LLEN', key)
        for j = len-1, 0, -1 do
            local entry = redis.call('LINDEX', key, j)
            if entry then
                local decoded = cjson.decode(entry)
                if now - decoded.date >= lockMaxTTL then
                    redis.call('LREM', key, 1, entry)
                    removed_total = removed_total + 1
                end
            end
        end
    end
    return removed_total
  `;
        do {
            const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', 'lock:queue:*', 'COUNT', batchSize);
            cursor = nextCursor;
            if (keys.length > 0) {
                const removed = await this.client.eval(luaScript, keys.length, ...keys, now, this.config.lockMaxTTL);
                totalRemoved += removed;
            }
        } while (cursor !== '0');
        if (totalRemoved > 0) {
            this.debugLog('Health check removed stale locks', { totalRemoved });
        }
        return totalRemoved;
    }
    generateQueueKey(tag) {
        return `lock:queue:${tag}`;
    }
    async deleteLocks(id, tags) {
        this.debugLog('Releasing locks', { id, tags });
        const luaScript = `
    local removed = 0
    for i, key in ipairs(KEYS) do
        local len = redis.call('LLEN', key)
        for j = 0, len - 1 do
            local entry = redis.call('LINDEX', key, j)
            if entry then
                local decoded = cjson.decode(entry)
                if decoded.id == ARGV[1] then
                    redis.call('LREM', key, 1, entry)
                    removed = removed + 1
                    break
                end
            end
        end
    end
    return removed
  `;
        const removedCount = await this.client.eval(luaScript, tags.length, ...tags.map((t) => this.generateQueueKey(t)), id);
        this.debugLog('Locks successfully released', { id, removedCount });
        return removedCount;
    }
    async extendLocks(id, tags) {
        const now = Date.now();
        this.debugLog('Attempting to extend locks', { id, tags });
        const luaScript = `
        local updated = 0
        
        for i, key in ipairs(KEYS) do
            local len = redis.call('LLEN', key)
        
            for j = 0, len - 1 do
                local entry = redis.call('LINDEX', key, j)
                if entry then
                    local decoded = cjson.decode(entry)
                    if decoded.id == ARGV[1] then
                        if decoded.extensions < tonumber(ARGV[3]) then
                            decoded.date = tonumber(ARGV[2])
                            decoded.extensions = decoded.extensions + 1
                            redis.call('LSET', key, j, cjson.encode(decoded))
                            updated = updated + 1
                        end
                        break
                    end
                end
            end
        end
        
        return updated
`;
        const updatedCount = await this.client.eval(luaScript, tags.length, ...tags.map((t) => this.generateQueueKey(t)), id, now, this.config.maxExtensions + 1);
        if (updatedCount !== tags.length) {
            this.logger.error(`Error when trying to extend the lock, they seem to be deleted (${updatedCount} vs ${tags.length}): ${JSON.stringify(tags)}`);
            throw new Error(`Error when trying to extend the lock , they seems to be deleted (${updatedCount} vs ${tags.length}) : ${JSON.stringify(tags)}`);
        }
        this.debugLog('Locks successfully extended', { id, updatedCount });
    }
    async listQueuedLocks(tags) {
        return Promise.all(tags.map(async (tag) => {
            const key = this.generateQueueKey(tag);
            const entries = await this.client.lrange(key, 0, -1);
            return {
                tag,
                key,
                entries: entries.map((entry, index) => {
                    const decoded = JSON.parse(entry);
                    return {
                        index,
                        id: decoded.id,
                        tags: decoded.tags,
                        date: decoded.date,
                        extensions: decoded.extensions,
                        decoded,
                    };
                }),
            };
        }));
    }
    async acquire(tags) {
        const id = (0, crypto_1.randomUUID)();
        const entryString = JSON.stringify({
            id,
            tags,
            date: Date.now(),
            extensions: 0,
        });
        this.debugLog('Queueing for lock acquisition', { id, tags });
        await Promise.all(tags.map(async (tag) => this.client.rpush(this.generateQueueKey(tag), entryString)));
        let waitCycles = 0;
        while (true) {
            const indexes = await Promise.all(tags.map(async (tag) => this.client.lpos(this.generateQueueKey(tag), entryString)));
            if (indexes.some((h) => h === null)) {
                this.logger.error(`Lock request got deleted before acquiring for tags: ${tags}`);
                throw new Error(`Error when trying to get locks for ${tags} , lock request got deleted before acquiring`);
            }
            if (indexes.every((value) => value === 0)) {
                this.debugLog('Lock successfully acquired', { id, tags, waitCycles });
                break;
            }
            waitCycles++;
            if (waitCycles % 10 === 0) {
                this.debugLog('Still waiting in queue to acquire lock', {
                    id,
                    indexes,
                });
            }
            await sleep(this.config.lockAcquireInterval);
        }
        await this.extendLocks(id, tags);
        const extender = setInterval(async () => {
            try {
                await this.extendLocks(id, tags);
            }
            catch (e) {
                this.logger.warn(`Max extensions exceeded for lock ${id}. Will not extend anymore.`);
                clearInterval(extender);
            }
        }, (this.config.lockMaxTTL * 3) / 4);
        return {
            release: () => {
                this.debugLog('Clearing lock extender interval', { id });
                clearInterval(extender);
                return this.deleteLocks(id, tags);
            },
        };
    }
    async onApplicationShutdown() {
        this.debugLog('Shutting down LockService, clearing intervals and quitting Redis');
        if (this.healthCheckIntervalId != null)
            clearInterval(this.healthCheckIntervalId);
        return this.client.quit();
    }
};
exports.LockService = LockService;
exports.LockService = LockService = LockService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], LockService);
async function sleep(milliseconds) {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
