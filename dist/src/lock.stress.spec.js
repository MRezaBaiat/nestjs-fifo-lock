"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lock_service_1 = require("./lock.service");
jest.setTimeout(60000);
const baseConfig = {
    redisHost: '127.0.0.1',
    redisPort: 6379,
    lockAcquireInterval: 20,
    lockMaxTTL: 400,
    maxExtensions: 20,
    healthCheckInterval: 200,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
describe('LockService stress tests', () => {
    let service;
    let client;
    beforeEach(async () => {
        service = new lock_service_1.LockService(baseConfig);
        await service.onApplicationBootstrap();
        client = service.client;
        await client.flushdb();
    });
    afterEach(async () => {
        await client.flushdb();
        await service.onApplicationShutdown();
    });
    it('allows many distinct tags in parallel', async () => {
        const started = [];
        await Promise.all(Array.from({ length: 12 }, (_, i) => service.auto(`T-${i + 1}`, async () => {
            started.push(`T-${i + 1}`);
            await sleep(10);
        })));
        expect(started).toHaveLength(12);
        expect(new Set(started).size).toBe(12);
    });
    it('serializes the same tag across multiple service instances', async () => {
        const secondService = new lock_service_1.LockService({
            ...baseConfig,
            healthCheckInterval: 10_000,
            lockMaxTTL: 400,
            maxExtensions: 10,
        });
        await secondService.onApplicationBootstrap();
        const events = [];
        let overlapDetected = false;
        let active = false;
        try {
            const first = service.auto('A', async () => {
                if (active)
                    overlapDetected = true;
                active = true;
                events.push('first:start');
                await sleep(80);
                events.push('first:end');
                active = false;
            });
            await sleep(5);
            const second = secondService.auto('A', async () => {
                if (active)
                    overlapDetected = true;
                active = true;
                events.push('second:start');
                await sleep(40);
                events.push('second:end');
                active = false;
            });
            await Promise.all([first, second]);
            expect(overlapDetected).toBe(false);
            expect(events).toEqual([
                'first:start',
                'first:end',
                'second:start',
                'second:end',
            ]);
        }
        finally {
            await secondService.onApplicationShutdown();
        }
    });
    it('health check removes partial expired queue entries', async () => {
        const expired = JSON.stringify({
            id: 'partial-dead',
            tags: ['X', 'Y'],
            date: Date.now() - 1000,
            extensions: 0,
        });
        await client.rpush('lock:queue:X', expired);
        const removed = await service.runHealthCheck();
        expect(removed).toBeGreaterThanOrEqual(1);
        expect(await client.llen('lock:queue:X')).toBe(0);
    });
});
