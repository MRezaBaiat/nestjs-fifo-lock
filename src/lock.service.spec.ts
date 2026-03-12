import { LockService } from './lock.service';

jest.setTimeout(30000);

const config = {
  redisHost: '127.0.0.1',
  redisPort: 6379,
  lockAcquireInterval: 20,
  lockMaxTTL: 100,
  maxExtensions: 2,
  healthCheckInterval: 50,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LockService', () => {
  let service: LockService;
  let client: any;

  beforeEach(async () => {
    service = new LockService(config as any);
    await service.onApplicationBootstrap();
    client = (service as any).client;
    await client.flushdb();
  });

  afterEach(async () => {
    await client.flushdb();
    await service.onApplicationShutdown();
    jest.clearAllMocks();
  });

  it('acquires and releases a single-tag lock', async () => {
    let executed = false;

    await service.auto('A', async () => {
      executed = true;
    });

    expect(executed).toBe(true);
    expect(await client.llen('lock:queue:A')).toBe(0);
  });

  it('acquires and releases multi-tag locks', async () => {
    await service.auto(['A', 'B'], async () => {
      expect(await client.llen('lock:queue:A')).toBe(1);
      expect(await client.llen('lock:queue:B')).toBe(1);
    });

    expect(await client.llen('lock:queue:A')).toBe(0);
    expect(await client.llen('lock:queue:B')).toBe(0);
  });

  it('serializes access for the same tag', async () => {
    const order: number[] = [];

    const first = service.auto('A', async () => {
      order.push(1);
      await sleep(50);
    });

    const second = service.auto('A', async () => {
      order.push(2);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it('allows parallel execution for different tags', async () => {
    const started: number[] = [];

    await Promise.all([
      service.auto('A', async () => {
        started.push(1);
        await sleep(30);
      }),
      service.auto('B', async () => {
        started.push(2);
      }),
    ]);

    expect(started.sort()).toEqual([1, 2]);
  });

  it('extends an acquired lock while the callback is running', async () => {
    const spy = jest.spyOn<any, any>(service as any, 'extendLocks');

    await service.auto('A', async () => {
      await sleep(config.lockMaxTTL * 2);
    });

    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('removes an expired lock entry', async () => {
    const expired = JSON.stringify({
      id: 'dead',
      tags: ['A'],
      date: Date.now() - 1000,
      extensions: 0,
    });

    await client.rpush('lock:queue:A', expired);

    const removed = await service.runHealthCheck();

    expect(removed).toBe(1);
    expect(await client.llen('lock:queue:A')).toBe(0);
  });

  it('does not remove fresh locks', async () => {
    await client.rpush(
      'lock:queue:A',
      JSON.stringify({
        id: 'live',
        tags: ['A'],
        date: Date.now(),
        extensions: 0,
      }),
    );

    const removed = await service.runHealthCheck();

    expect(removed).toBe(0);
    expect(await client.llen('lock:queue:A')).toBe(1);
  });

  it('can run a health check while a fresh lock is active', async () => {
    const hcService = new LockService({
      ...config,
      lockMaxTTL: 120,
      maxExtensions: 10,
      healthCheckInterval: 10_000,
    } as any);

    await hcService.onApplicationBootstrap();
    const hcClient = (hcService as any).client;
    await hcClient.flushdb();

    try {
      const task = hcService.auto('A', async () => {
        await sleep(150);
      });

      await sleep(20);
      const removed = await hcService.runHealthCheck();

      expect(removed).toBe(0);
      await task;
      expect(await hcClient.llen('lock:queue:A')).toBe(0);
    } finally {
      await hcClient.flushdb();
      await hcService.onApplicationShutdown();
    }
  });

  it('waits correctly for a tag held by an extending multi-tag lock', async () => {
    const waitService = new LockService({
      ...config,
      lockMaxTTL: 10_000,
      healthCheckInterval: 10_000,
      lockAcquireInterval: 50,
      maxExtensions: 5,
    } as any);

    await waitService.onApplicationBootstrap();
    const waitClient = (waitService as any).client;
    await waitClient.flushdb();
    const order: string[] = [];

    try {
      const holder = waitService.auto(['1', '2', '3'], async () => {
        order.push('holder:start');
        await sleep(1_500);
        order.push('holder:end');
      });

      await sleep(10);

      const waiter = waitService.auto(['1'], async () => {
        order.push('waiter:start');
        await sleep(10);
        order.push('waiter:end');
      });

      const parallel = waitService.auto(['4'], async () => {
        order.push('parallel:start');
        await sleep(10);
        order.push('parallel:end');
      });

      await Promise.all([holder, waiter, parallel]);

      expect(order).toContain('holder:start');
      expect(order).toContain('holder:end');
      expect(order).toContain('waiter:start');
      expect(order).toContain('waiter:end');
      expect(order).toContain('parallel:start');
      expect(order).toContain('parallel:end');
      expect(order.indexOf('parallel:start')).toBeLessThan(
        order.indexOf('holder:end'),
      );
      expect(order.indexOf('waiter:start')).toBeGreaterThan(
        order.indexOf('holder:end'),
      );
    } finally {
      await waitClient.flushdb();
      await waitService.onApplicationShutdown();
    }
  });
});
