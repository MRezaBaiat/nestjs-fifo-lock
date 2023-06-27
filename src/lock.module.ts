import { DynamicModule, Global, Module } from '@nestjs/common';
import { LockService } from './lock.service';

@Global()
@Module({})
export class LockModule {
  static register(config: {
    redisHost: string;
    redisPort: string | number;
    lockMaxTTL?: number;
    healthCheckInterval?: number;
    lockAcquireInterval?: number;
  }): DynamicModule {
    config.lockMaxTTL = config.lockMaxTTL || 60 * 1000;
    config.healthCheckInterval = config.healthCheckInterval || 60 * 1000;
    config.lockAcquireInterval = config.lockAcquireInterval || 500;
    return {
      global: true,
      imports: [],
      module: LockModule,
      providers: [
        {
          provide: LockService,
          useValue: new LockService(config),
        },
      ],
      exports: [LockService],
    };
  }
}
