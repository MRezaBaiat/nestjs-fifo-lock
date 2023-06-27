import {
  OnApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import Client from 'ioredis';
import { randomUUID } from 'crypto';

declare global {
  // eslint-disable-next-line no-var, vars-on-top, no-use-before-define
  var lockService: LockService;
}

type ValueType = { tag: string; createdAt: number; clientToken: string };

@Injectable()
export class LockService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly client;

  constructor(
    private config: {
      redisHost: string;
      redisPort: string | number;
      lockMaxTTL?: number;
      healthCheckInterval?: number;
      lockAcquireInterval?: number;
    },
  ) {
    global.lockService = this;
    this.client = new Client({
      host: config.redisHost,
      port: +config.redisPort,
    });
  }

  onApplicationBootstrap(): any {
    setInterval(() => this.runHealthCheck(), this.config.healthCheckInterval);
    this.runHealthCheck();
  }

  public async auto<T>(
    lockTags: string | string[],
    cb: () => Promise<T>,
  ): Promise<T> {
    const tags =
      typeof lockTags === 'string'
        ? [lockTags]
        : Array.isArray(lockTags)
        ? lockTags.map((t) => String(t))
        : [String(lockTags)];

    const { remove } = await this.getWriteLockWithPriority(tags);

    return cb().finally(remove);
  }

  private encodeValue(data: ValueType): string {
    return JSON.stringify(data);
  }

  private decodeValue(data: string): ValueType {
    return JSON.parse(data);
  }

  private async fetchIndexes(values: string[]) {
    const res: number[] = [];
    for (const val of values) {
      const setKey = this.generateListKey(this.decodeValue(val).tag);
      res.push(await this.client.lpos(setKey, val));
    }
    return res;
  }

  private async runHealthCheck() {
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

  private generateListKey(tag: string) {
    return `:lock-queue-list:${tag}`;
  }

  private async getAllLists(): Promise<string[]> {
    return this.client.keys(':lock-queue-list:*');
  }

  private async deleteLocks(values: string[]) {
    for (const listVal of values) {
      const value = this.decodeValue(listVal);
      const listKey = this.generateListKey(value.tag);
      await this.client.lrem(listKey, 1, listVal);
    }
  }

  private async getWriteLockWithPriority(tags: string[]) {
    const values: string[] = [];
    for (const tag of tags) {
      const value = this.encodeValue({
        tag,
        createdAt: Date.now(),
        clientToken: randomUUID(),
      });
      await this.client.rpush(this.generateListKey(tag), value);
      values.push(value);
    }
    while (true) {
      const indexes = await this.fetchIndexes(values);
      if (indexes.some((i) => i === null)) {
        throw new Error(
          `Error when trying to get locks for ${tags} , lock request got deleted before acquiring`,
        );
      }
      if (!indexes.some((i) => i !== 0)) {
        break;
      }

      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.lockAcquireInterval),
      );
    }

    return {
      remove: async () => this.deleteLocks(values),
    };
  }

  public async onApplicationShutdown(): Promise<any> {
    return this.client.quit();
  }
}
