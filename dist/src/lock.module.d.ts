import { DynamicModule } from '@nestjs/common';
export interface ConfigType {
    redisHost: string;
    redisPort: string | number;
    lockMaxTTL?: number;
    healthCheckInterval?: number;
    lockAcquireInterval?: number;
    maxExtensions?: number;
}
export declare class LockModule {
    static register(config: ConfigType): DynamicModule;
}
