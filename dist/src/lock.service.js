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
let LockService = exports.LockService = class LockService {
    constructor(config) {
        this.config = config;
        global.lockService = this;
        this.client = new ioredis_1.default({
            host: config.redisHost,
            port: +config.redisPort,
        });
    }
    onApplicationBootstrap() {
        setInterval(() => this.runHealthCheck(), this.config.healthCheckInterval);
        this.runHealthCheck();
    }
    async auto(lockTags, cb) {
        const tags = typeof lockTags === 'string'
            ? [lockTags]
            : Array.isArray(lockTags)
                ? lockTags.map((t) => String(t))
                : [String(lockTags)];
        const { remove } = await this.getWriteLockWithPriority(tags);
        return cb().finally(remove);
    }
    encodeValue(data) {
        return JSON.stringify(data);
    }
    decodeValue(data) {
        return JSON.parse(data);
    }
    async fetchIndexes(values) {
        const res = [];
        for (const val of values) {
            const setKey = this.generateListKey(this.decodeValue(val).tag);
            res.push(await this.client.lpos(setKey, val));
        }
        return res;
    }
    async runHealthCheck() {
        const allListKeys = await this.getAllLists();
        const now = Date.now();
        for (const listKey of allListKeys) {
            const list = await this.client.lrange(listKey, 0, -1);
            for (const listVal of list) {
                const value = this.decodeValue(listVal);
                if (now - value.createdAt >= this.config.lockMaxTTL) {
                    await this.deleteLocks([listVal]);
                }
            }
        }
    }
    generateListKey(tag) {
        return `:lock-queue-list:${tag}`;
    }
    async getAllLists() {
        return this.client.keys(':lock-queue-list:*');
    }
    async deleteLocks(values) {
        for (const listVal of values) {
            const value = this.decodeValue(listVal);
            const listKey = this.generateListKey(value.tag);
            await this.client.lrem(listKey, 1, listVal);
        }
    }
    async getWriteLockWithPriority(tags) {
        const values = [];
        for (const tag of tags) {
            const value = this.encodeValue({
                tag,
                createdAt: Date.now(),
                clientToken: (0, crypto_1.randomUUID)(),
            });
            await this.client.rpush(this.generateListKey(tag), value);
            values.push(value);
        }
        while (true) {
            const indexes = await this.fetchIndexes(values);
            if (indexes.some((i) => i === null)) {
                throw new Error(`Error when trying to get locks for ${tags} , lock request got deleted before acquiring`);
            }
            if (!indexes.some((i) => i !== 0)) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, this.config.lockAcquireInterval));
        }
        return {
            remove: async () => this.deleteLocks(values),
        };
    }
    async onApplicationShutdown() {
        return this.client.quit();
    }
};
exports.LockService = LockService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], LockService);
