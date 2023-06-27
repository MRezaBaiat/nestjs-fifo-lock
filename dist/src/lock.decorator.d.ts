type LockType = {
    type: string;
    tag: string;
};
export declare function UseLock(lockTags: LockType | LockType[] | ((...args: any[]) => LockType | LockType[])): MethodDecorator;
export {};
