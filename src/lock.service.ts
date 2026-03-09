import {
  OnApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
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

  constructor(private config: ConfigType) {
    global.lockService = this;
    this.client = new Client({
      host: config.redisHost,
      port: +config.redisPort,
    });
  }

  onApplicationBootstrap(): any {
    this.healthCheckIntervalId = setInterval(
      () => this.runHealthCheck(),
      this.config.healthCheckInterval,
    );
    this.runHealthCheck();
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

    const { release } = await this.acquire(tags);

    try {
      return await cb();
    } finally {
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

    return totalRemoved;
  }

  private generateQueueKey(tag: string) {
    return `lock:queue:${tag}`;
  }

  private async deleteLocks(id: string, tags: string[]) {
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
    return removedCount as number;
  }

  private async extendLocks(id: string, tags: string[]) {
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

    const updatedCount = await this.client.eval(
      luaScript,
      tags.length,
      ...tags.map((t) => this.generateQueueKey(t)),
      id,
      now,
      this.config.maxExtensions + 1, // +1 because we always extend once
    );

    if (updatedCount !== tags.length) {
      throw new Error(
        `Error when trying to extend the lock , they seems to be deleted (${updatedCount} vs ${
          tags.length
        }) : ${JSON.stringify(tags)}`,
      );
    }
  }

  private async acquire(tags: string[]) {
    const id = randomUUID();
    const entryString = JSON.stringify({
      id,
      tags,
      date: Date.now(),
      extensions: 0,
    } as QueueEntry);

    await Promise.all(
      tags.map(async (tag) =>
        this.client.rpush(this.generateQueueKey(tag), entryString),
      ),
    );

    while (true) {
      const indexes = await Promise.all(
        tags.map(async (tag) =>
          this.client.lpos(this.generateQueueKey(tag), entryString),
        ),
      );

      if (indexes.some((h) => h === null)) {
        throw new Error(
          `Error when trying to get locks for ${tags} , lock request got deleted before acquiring`,
        );
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
      } catch (e) {
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

  public async onApplicationShutdown(): Promise<any> {
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
