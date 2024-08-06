import { DynamicModule, Global, Module } from '@nestjs/common';
import { LockService } from './lock.service';

export interface ConfigType {
  redisHost: string;
  redisPort: string | number;
  lockMaxTTL?: number;
  healthCheckInterval?: number;
  lockAcquireInterval?: number;
  maxExtensions?: number;
}

@Global()
@Module({})
export class LockModule {
  static register(config: ConfigType): DynamicModule {
    config.lockMaxTTL = config.lockMaxTTL || 60 * 1000;
    config.healthCheckInterval = config.healthCheckInterval || 60 * 1000;
    config.lockAcquireInterval = config.lockAcquireInterval || 500;
    config.maxExtensions = config.maxExtensions || 5;
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
