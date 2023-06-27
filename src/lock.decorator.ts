type LockType = {
  type: string;
  tag: string;
};

export function UseLock(
  lockTags: LockType | LockType[] | ((...args) => LockType | LockType[]),
): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const { value } = descriptor;
    descriptor.value = async function (...args) {
      const origin =
        typeof lockTags === 'function' ? lockTags(...args) : lockTags;
      const locks = Array.isArray(origin)
        ? origin.map((t) => `${t.type}-${t.tag}`)
        : `${origin.type}-${origin.tag}`;
      return global.lockService.auto(locks, async () =>
        value.call(this, ...args),
      );
    };

    return descriptor;
  };
}
