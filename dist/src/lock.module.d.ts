import { DynamicModule } from '@nestjs/common';
export declare class LockModule {
    static register(config: {
        redisHost: string;
        redisPort: string | number;
        lockMaxTTL?: number;
        healthCheckInterval?: number;
        lockAcquireInterval?: number;
    }): DynamicModule;
}
