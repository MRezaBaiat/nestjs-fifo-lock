import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { LockService } from './lock.service';
import { ModuleMetadata } from '@nestjs/common/interfaces/modules/module-metadata.interface';

export interface ConfigType {
  redisHost: string;
  redisPort: string | number;
  lockMaxTTL?: number;
  healthCheckInterval?: number;
  lockAcquireInterval?: number;
  maxExtensions?: number;
}

export interface LockOptionsFactory {
  createLockOptions(): Promise<ConfigType> | ConfigType;
}

export interface LockModuleAsyncOptions {
  useFactory?: (...args: any[]) => Promise<ConfigType> | ConfigType;
  inject?: any[];
  useClass?: Type<LockOptionsFactory>;
  useExisting?: Type<LockOptionsFactory>;
  imports?: ModuleMetadata['imports'];
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

  static registerAsync(options: LockModuleAsyncOptions): DynamicModule {
    const providers = this.createAsyncProviders(options);
    return {
      global: true,
      module: LockModule,
      imports: options.imports || [],
      providers: [
        ...providers,
        {
          provide: LockService,
          useFactory: (config: ConfigType) => new LockService(config),
          inject: ['LOCK_MODULE_CONFIG'],
        },
      ],
      exports: [LockService],
    };
  }

  private static createAsyncProviders(
    options: LockModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: 'LOCK_MODULE_CONFIG',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    const useClass = options.useClass || options.useExisting;
    if (useClass) {
      return [
        {
          provide: 'LOCK_MODULE_CONFIG',
          useFactory: async (optionsFactory: LockOptionsFactory) =>
            await optionsFactory.createLockOptions(),
          inject: [useClass],
        },
        useClass,
      ];
    }

    throw new Error('Invalid LockModuleAsyncOptions');
  }
}
