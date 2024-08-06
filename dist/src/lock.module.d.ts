import { DynamicModule, Type } from '@nestjs/common';
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
export declare class LockModule {
    static register(config: ConfigType): DynamicModule;
    static registerAsync(options: LockModuleAsyncOptions): DynamicModule;
    private static createAsyncProviders;
}
