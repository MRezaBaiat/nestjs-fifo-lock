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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  /* ---------------------------------------------------
   * BASIC ACQUIRE / RELEASE
   * --------------------------------------------------- */

  it('acquires and releases a single-tag lock', async () => {
    let executed = false;

    await service.auto('A', async () => {
      executed = true;
    });

    expect(executed).toBe(true);
    expect(await client.llen('lock:queue:A')).toBe(0);
  });

  it('acquires and releases multi-tag lock atomically', async () => {
    await service.auto(['A', 'B'], async () => {
      expect(await client.llen('lock:queue:A')).toBe(1);
      expect(await client.llen('lock:queue:B')).toBe(1);
    });

    expect(await client.llen('lock:queue:A')).toBe(0);
    expect(await client.llen('lock:queue:B')).toBe(0);
  });

  /* ---------------------------------------------------
   * MUTUAL EXCLUSION
   * --------------------------------------------------- */

  it('serializes access for the same tag', async () => {
    const order: number[] = [];

    const t1 = service.auto('A', async () => {
      order.push(1);
      await sleep(50);
    });

    const t2 = service.auto('A', async () => {
      order.push(2);
    });

    await Promise.all([t1, t2]);
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

  /* ---------------------------------------------------
   * EXTENSIONS
   * --------------------------------------------------- */

  it('automatically extends up to maxExtensions', async () => {
    const spy = jest.spyOn<any, any>(service as any, 'extendLocks');

    await service.auto('A', async () => {
      await sleep(config.lockMaxTTL * 2);
    });

    // initial extend + interval extensions
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  /* ---------------------------------------------------
   * HEALTH CHECK
   * --------------------------------------------------- */

  it('removes expired locks across multiple tags', async () => {
    const expired = JSON.stringify({
      id: 'dead',
      tags: ['A', 'B'],
      date: Date.now() - 1000,
      extensions: 0,
    });

    await client.rpush('lock:queue:A', expired);
    await client.rpush('lock:queue:B', expired);

    const removed = await service.runHealthCheck();

    expect(removed).toBe(2);
    expect(await client.llen('lock:queue:A')).toBe(0);
    expect(await client.llen('lock:queue:B')).toBe(0);
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

  /* ---------------------------------------------------
   * FAILURE PATHS
   * --------------------------------------------------- */

  it('throws if queue entry disappears before acquisition', async () => {
    jest
      .spyOn(client, 'lpos')
      .mockResolvedValueOnce(null);

    await expect(
      service.auto('A', async () => {}),
    ).rejects.toThrow(/lock request got deleted/);
  });

  /* ---------------------------------------------------
   * FIFO FAIRNESS
   * --------------------------------------------------- */

  it('preserves FIFO ordering for multiple waiters', async () => {
    const order: any[] = [];

    await Promise.all([1, 2, 3].map((i) =>
      service.auto('A', async () => {
        order.push(i);
        await sleep(10);
      }),
    ));

    expect(order).toEqual([1, 2, 3]);

    order.length = 0;

    [[1], [1,2], [3]].map(async (i) =>
      service.auto(i.map(n => String(n)), async () => {
        order.push(i)
        await sleep(100)
      }),
    );
    await sleep(100)

    expect(order).toEqual([[1],[3]])
  });
});
