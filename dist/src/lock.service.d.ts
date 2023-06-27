import { OnApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
declare global {
    var lockService: LockService;
}
export declare class LockService implements OnApplicationBootstrap, OnApplicationShutdown {
    private config;
    private readonly client;
    constructor(config: {
        redisHost: string;
        redisPort: string | number;
        lockMaxTTL?: number;
        healthCheckInterval?: number;
        lockAcquireInterval?: number;
    });
    onApplicationBootstrap(): any;
    auto<T>(lockTags: string | string[], cb: () => Promise<T>): Promise<T>;
    private encodeValue;
    private decodeValue;
    private fetchIndexes;
    private runHealthCheck;
    private generateListKey;
    private getAllLists;
    private deleteLocks;
    private getWriteLockWithPriority;
    onApplicationShutdown(): Promise<any>;
}
