import {
  OnApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
  Logger,
} from '@nestjs/common';
import Client from 'ioredis';
import { randomUUID } from 'crypto';
import { uniq } from 'lodash';
import { ConfigType } from './lock.module';

declare global {
  // eslint-disable-next-line no-var, vars-on-top, no-use-before-define
  var lockService: LockService;
}

interface QueueEntry {
  tags: string[];
  date: number;
  id: string;
  extensions: number;
}

@Injectable()
export class LockService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly client;
  private healthCheckIntervalId;
  private readonly logger = new Logger(LockService.name);

  constructor(private config: ConfigType) {
    global.lockService = this;
    this.client = new Client({
      host: config.redisHost,
      port: +config.redisPort,
      ...(config.redisSsl ? { tls: {} } : {}),
    });
    this.debugLog('Initialized Redis client for LockService');
  }

  /**
   * Helper method to output logs only when DEBUG=true is set in the environment.
   */
  private debugLog(message: string, meta?: Record<string, any>) {
    if (this.config.debug) {
      const metaString = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
      this.logger.debug(`${message}${metaString}`);
    }
  }

  onApplicationBootstrap(): any {
    this.healthCheckIntervalId = setInterval(
      () => this.runHealthCheck(),
      this.config.healthCheckInterval,
    );
    this.runHealthCheck();
    this.debugLog('Application bootstrapped. Health check interval started.');
  }

  public async auto<T>(
    lockTags: string | string[],
    cb: () => Promise<T>,
  ): Promise<T> {
    const tags = uniq(
      typeof lockTags === 'string'
        ? [lockTags]
        : Array.isArray(lockTags)
        ? lockTags.map((t) => String(t))
        : [String(lockTags)],
    );

    this.debugLog('Requesting auto lock block', { tags });
    const start = performance.now();
    const { release } = await this.acquire(tags);
    const duration = performance.now() - start;
    this.debugLog(`Took ${duration.toFixed(0)}ms to acquire lock for`, { tags });
    try {
      return await cb();
    } finally {
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
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        'lock:queue:*',
        'COUNT',
        batchSize,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        const removed = await this.client.eval(
          luaScript,
          keys.length,
          ...keys,
          now,
          this.config.lockMaxTTL,
        );
        totalRemoved += removed as number;
      }
    } while (cursor !== '0');

    if (totalRemoved > 0) {
      this.debugLog('Health check removed stale locks', { totalRemoved });
    }

    return totalRemoved;
  }

  private generateQueueKey(tag: string) {
    return `lock:queue:${tag}`;
  }

  private async deleteLocks(id: string, tags: string[]) {
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

    const removedCount = await this.client.eval(
      luaScript,
      tags.length,
      ...tags.map((t) => this.generateQueueKey(t)),
      id,
    );

    this.debugLog('Locks successfully released', { id, removedCount });
    return removedCount as number;
  }

  private async extendLocks(id: string, tags: string[]) {
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

    const updatedCount = await this.client.eval(
      luaScript,
      tags.length,
      ...tags.map((t) => this.generateQueueKey(t)),
      id,
      now,
      this.config.maxExtensions + 1, // +1 because we always extend once
    );

    if (updatedCount !== tags.length) {
      this.logger.error(
        `Error when trying to extend the lock, they seem to be deleted (${updatedCount} vs ${
          tags.length
        }): ${JSON.stringify(tags)}`,
      );
      throw new Error(
        `Error when trying to extend the lock , they seems to be deleted (${updatedCount} vs ${
          tags.length
        }) : ${JSON.stringify(tags)}`,
      );
    }

    this.debugLog('Locks successfully extended', { id, updatedCount });
  }

  public async listQueuedLocks(tags: string[]) {
    return Promise.all(
      tags.map(async (tag) => {
        const key = this.generateQueueKey(tag);
        const entries = await this.client.lrange(key, 0, -1);
        return {
          tag,
          key,
          entries: entries.map((entry, index) => {
            const decoded = JSON.parse(entry) as QueueEntry;
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
      }),
    );
  }

  private async acquire(tags: string[]) {
    const id = randomUUID();
    const entryString = JSON.stringify({
      id,
      tags,
      date: Date.now(),
      extensions: 0,
    } as QueueEntry);

    this.debugLog('Queueing for lock acquisition', { id, tags });

    await Promise.all(
      tags.map(async (tag) =>
        this.client.rpush(this.generateQueueKey(tag), entryString),
      ),
    );

    let waitCycles = 0;
    while (true) {
      const indexes = await Promise.all(
        tags.map(async (tag) =>
          this.client.lpos(this.generateQueueKey(tag), entryString),
        ),
      );

      if (indexes.some((h) => h === null)) {
        this.logger.error(
          `Lock request got deleted before acquiring for tags: ${tags}`,
        );
        throw new Error(
          `Error when trying to get locks for ${tags} , lock request got deleted before acquiring`,
        );
      }

      if (indexes.every((value) => value === 0)) {
        this.debugLog('Lock successfully acquired', { id, tags, waitCycles });
        break;
      }

      waitCycles++;
      // Optional: Log every 10 cycles to avoid spamming the console while waiting
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
      } catch (e) {
        this.logger.warn(
          `Max extensions exceeded for lock ${id}. Will not extend anymore.`,
        );
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

  public async onApplicationShutdown(): Promise<any> {
    this.debugLog(
      'Shutting down LockService, clearing intervals and quitting Redis',
    );
    if (this.healthCheckIntervalId != null)
      clearInterval(this.healthCheckIntervalId);

    return this.client.quit();
  }
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
