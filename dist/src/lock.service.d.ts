import { OnApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigType } from './lock.module';
declare global {
    var lockService: LockService;
}
export declare class LockService implements OnApplicationBootstrap, OnApplicationShutdown {
    private config;
    private readonly client;
    private healthCheckIntervalId;
    private readonly logger;
    constructor(config: ConfigType);
    private debugLog;
    onApplicationBootstrap(): any;
    auto<T>(lockTags: string | string[], cb: () => Promise<T>): Promise<T>;
    runHealthCheck(): Promise<number>;
    private generateQueueKey;
    private deleteLocks;
    private extendLocks;
    listQueuedLocks(tags: string[]): Promise<{
        tag: string;
        key: string;
        entries: any;
    }[]>;
    private acquire;
    onApplicationShutdown(): Promise<any>;
}
