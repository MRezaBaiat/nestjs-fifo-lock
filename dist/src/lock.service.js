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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
const crypto_1 = require("crypto");
const lodash_1 = require("lodash");
let LockService = class LockService {
    constructor(config) {
        this.config = config;
        global.lockService = this;
        this.client = new ioredis_1.default({
            host: config.redisHost,
            port: +config.redisPort,
        });
    }
    onApplicationBootstrap() {
        this.healthCheckIntervalId = setInterval(() => this.runHealthCheck(), this.config.healthCheckInterval);
        this.runHealthCheck();
    }
    async auto(lockTags, cb) {
        const tags = (0, lodash_1.uniq)(typeof lockTags === 'string'
            ? [lockTags]
            : Array.isArray(lockTags)
                ? lockTags.map((t) => String(t))
                : [String(lockTags)]);
        const { release } = await this.acquire(tags);
        try {
            return await cb();
        }
        finally {
            await release();
        }
    }
    async runHealthCheck() {
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
        return totalRemoved;
    }
    generateQueueKey(tag) {
        return `lock:queue:${tag}`;
    }
    async deleteLocks(id, tags) {
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
        return removedCount;
    }
    async extendLocks(id, tags) {
        const now = Date.now();
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
            throw new Error(`Error when trying to extend the lock , they seems to be deleted (${updatedCount} vs ${tags.length}) : ${JSON.stringify(tags)}`);
        }
    }
    async acquire(tags) {
        const id = (0, crypto_1.randomUUID)();
        const entryString = JSON.stringify({
            id,
            tags,
            date: Date.now(),
            extensions: 0,
        });
        await Promise.all(tags.map(async (tag) => this.client.rpush(this.generateQueueKey(tag), entryString)));
        while (true) {
            const indexes = await Promise.all(tags.map(async (tag) => this.client.lpos(this.generateQueueKey(tag), entryString)));
            if (indexes.some((h) => h === null)) {
                throw new Error(`Error when trying to get locks for ${tags} , lock request got deleted before acquiring`);
            }
            if (indexes.every((value) => value === 0)) {
                break;
            }
            await sleep(this.config.lockAcquireInterval);
        }
        await this.extendLocks(id, tags);
        const extender = setInterval(async () => {
            try {
                await this.extendLocks(id, tags);
            }
            catch (e) {
                clearInterval(extender);
            }
        }, (this.config.lockMaxTTL * 3) / 4);
        return {
            release: () => {
                clearInterval(extender);
                return this.deleteLocks(id, tags);
            },
        };
    }
    async onApplicationShutdown() {
        if (this.healthCheckIntervalId != null)
            clearInterval(this.healthCheckIntervalId);
        return this.client.quit();
    }
};
exports.LockService = LockService;
exports.LockService = LockService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], LockService);
async function sleep(milliseconds) {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
