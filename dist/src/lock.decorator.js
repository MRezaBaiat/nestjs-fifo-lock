"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UseLock = void 0;
function UseLock(lockTags) {
    return function (target, propertyKey, descriptor) {
        const { value } = descriptor;
        descriptor.value = async function (...args) {
            const origin = typeof lockTags === 'function' ? lockTags(...args) : lockTags;
            const locks = Array.isArray(origin)
                ? origin.map((t) => `${t.type}-${t.tag}`)
                : `${origin.type}-${origin.tag}`;
            return global.lockService.auto(locks, async () => value.call(this, ...args));
        };
        return descriptor;
    };
}
exports.UseLock = UseLock;
