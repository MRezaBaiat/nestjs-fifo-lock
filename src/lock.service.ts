import {
  OnApplicationShutdown,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import Client from 'ioredis';
import { randomUUID } from 'crypto';
import _ from 'lodash';
import { ConfigType } from './lock.module';

declare global {
  // eslint-disable-next-line no-var, vars-on-top, no-use-before-define
  var lockService: LockService;
}

type ValueType = {
  tag: string;
  date: number;
  clientToken: string;
  extensions: number;
};

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
    const tags = _.uniq(
      typeof lockTags === 'string'
        ? [lockTags]
        : Array.isArray(lockTags)
        ? lockTags.map((t) => String(t))
        : [String(lockTags)],
    );

    const { release } = await this.getWriteLockWithPriority(tags);

    try {
      return await cb();
    } finally {
      await release();
    }
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
      const listKey = this.generateListKey(this.decodeValue(val).tag);
      res.push(await this.client.lpos(listKey, val));
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
        if (now - value.date >= this.config.lockMaxTTL) {
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
      await this.client.lrem(listKey, 0, listVal); // 0 will remove all occurrences of listVal
    }
  }

  private async extendLocks(values: string[]) {
    values = [...values];
    for (const val of values) {
      const listKey = this.generateListKey(this.decodeValue(val).tag);
      const index = await this.client.lpos(listKey, val);
      if (index === null) {
        throw new Error(
          `Error when trying to get lock which request got deleted when trying to extend lock`,
        );
      }
      const value = this.decodeValue(val);
      if (value.extensions < this.config.maxExtensions) {
        value.date = Date.now();
        value.extensions += 1;
        values.splice(values.indexOf(val), 1, this.encodeValue(value));
        await this.client.lset(listKey, index, this.encodeValue(value));
      }
    }
    return values;
  }

  private async getWriteLockWithPriority(tags: string[]) {
    let values: string[] = [];
    for (const tag of tags) {
      const value = this.encodeValue({
        tag,
        date: Date.now(),
        clientToken: randomUUID(),
        extensions: 0,
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
      await sleep(this.config.lockAcquireInterval);
    }

    values = await this.extendLocks(values);

    const extender = setInterval(async () => {
      try {
        values = await this.extendLocks(values);
      } catch (e) {
        clearInterval(extender);
      }
    }, this.config.lockMaxTTL / 2);

    return {
      release: () => {
        clearInterval(extender);
        return this.deleteLocks(values);
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
