import { OnApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigType } from './lock.module';
declare global {
    var lockService: LockService;
}
export declare class LockService implements OnApplicationBootstrap, OnApplicationShutdown {
    private config;
    private readonly client;
    private healthCheckIntervalId;
    constructor(config: ConfigType);
    onApplicationBootstrap(): any;
    auto<T>(lockTags: string | string[], cb: () => Promise<T>): Promise<T>;
    private encodeValue;
    private decodeValue;
    private fetchIndexes;
    private runHealthCheck;
    private generateListKey;
    private getAllLists;
    private deleteLocks;
    private extendLocks;
    private getWriteLockWithPriority;
    onApplicationShutdown(): Promise<any>;
}
